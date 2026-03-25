import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { customizationDraftService } from '@/services/customization-draft.service';
import { validateCustomizationConfig, customizationConfigSchema } from '@/lib/customization/validate';
import type { CustomizationConfig } from '@craft/types';

type Params = { templateId: string };

/**
 * GET /api/drafts/[templateId]
 * Returns the saved draft for the authenticated user and template, or 404.
 */
export const GET = withAuth<Params>(async (_req, { user, params }) => {
    try {
        const draft = await customizationDraftService.getDraft(user.id, params.templateId);
        if (!draft) {
            return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
        }
        return NextResponse.json(draft);
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Failed to get draft' }, { status: 500 });
    }
});

/**
 * POST /api/drafts/[templateId]
 * Creates or overwrites the draft for the authenticated user and template.
 * Returns the saved draft with id and updatedAt.
 */
export const POST = withAuth<Params>(async (req: NextRequest, { user, params }) => {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validation = validateCustomizationConfig(body);
    if (!validation.valid) {
        return NextResponse.json({ error: 'Invalid input', details: validation.errors }, { status: 400 });
    }

    // Schema parse is safe here — validateCustomizationConfig already confirmed shape
    const config = customizationConfigSchema.parse(body) as CustomizationConfig;

    try {
        const draft = await customizationDraftService.saveDraft(user.id, params.templateId, config);
        return NextResponse.json(draft, { status: 200 });
    } catch (error: any) {
        const status = error.message === 'Template not found' ? 404 : 500;
        return NextResponse.json({ error: error.message || 'Failed to save draft' }, { status });
    }
});
