import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import {
  validateCustomizationConfig,
  validateStellarEndpoints,
} from '@/lib/customization/validate';

type RequestBody = {
  templateId: string;
  customizationConfig?: unknown;
  name?: string;
};

function normalizeRequestBody(raw: unknown): RequestBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;

  if (!b.templateId || typeof b.templateId !== 'string') return null;
  if ('name' in b && typeof b.name !== 'string') return null;

  return {
    templateId: b.templateId as string,
    customizationConfig: b.customizationConfig,
    name: typeof b.name === 'string' ? b.name : undefined,
  };
}

export const POST = withAuth(async (req: NextRequest, { supabase, user }) => {
  let body: RequestBody;
  try {
    const raw = await req.json();
    const normalized = normalizeRequestBody(raw);
    if (!normalized) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }
    body = normalized;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Verify template exists and is active
  const { data: template, error: tplErr } = await supabase
    .from('templates')
    .select('id, name')
    .eq('id', body.templateId)
    .eq('is_active', true)
    .single();

  if (tplErr || !template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const customization = body.customizationConfig ?? {};

  // Validate customization config shape and business rules
  const validation = validateCustomizationConfig(customization);
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Invalid customization config', details: validation.errors },
      { status: 422 }
    );
  }

  // Validate stellar endpoints reachability (async). If invalid, return details.
  try {
    const endpointValidation = await validateStellarEndpoints(
      customization as any,
      { timeout: 3000 }
    );
    if (!endpointValidation.valid) {
      return NextResponse.json(
        {
          error: 'Invalid customization endpoints',
          details: endpointValidation.errors,
        },
        { status: 422 }
      );
    }
  } catch (err: any) {
    // Treat connectivity errors as transient server errors
    return NextResponse.json(
      { error: err?.message ?? 'Endpoint validation failed' },
      { status: 500 }
    );
  }

  // Create deployment record
  const deploymentId = crypto.randomUUID();
  const name = body.name ?? (template.name as string);

  const { data: inserted, error: insertErr } = await supabase
    .from('deployments')
    .insert([
      {
        id: deploymentId,
        user_id: user.id,
        template_id: body.templateId,
        name,
        customization_config: customization as any,
        status: 'pending',
      },
    ])
    .select()
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'Failed to create deployment' },
      { status: 500 }
    );
  }

  // Mark deployment as generating to indicate the pipeline has started/enqueued.
  await supabase
    .from('deployments')
    .update({ status: 'generating', updated_at: new Date().toISOString() })
    .eq('id', deploymentId);

  const created = {
    id: inserted.id,
    templateId: inserted.template_id,
    userId: inserted.user_id,
    name: inserted.name,
    customizationConfig: inserted.customization_config,
    status: 'generating',
    createdAt: inserted.created_at,
  };

  return NextResponse.json(created, { status: 201 });
});
