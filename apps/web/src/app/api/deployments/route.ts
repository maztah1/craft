/**
 * POST /api/deployments
 *
 * Initiates a full deployment pipeline: code generation → GitHub repo →
 * code push → Vercel project → Vercel deployment → persisted record.
 *
 * Authentication: requires a valid Supabase session (401 if missing).
 *
 * Request body:
 * {
 *   "templateId":    string              — UUID of the template to deploy
 *   "name":          string              — human-readable deployment name (used as repo name)
 *   "customization": CustomizationConfig — branding, features, stellar config
 * }
 *
 * Responses:
 *   202 — Pipeline started; returns deploymentId + URLs when complete
 *         { deploymentId, repositoryUrl, deploymentUrl }
 *   400 — Missing or invalid request body
 *   401 — Not authenticated
 *   422 — Pipeline failed (generation, GitHub, or Vercel error)
 *         { error, deploymentId, failedStage }
 *   500 — Unexpected server error
 *
 * The returned deploymentId can be polled via GET /api/deployments/[id]
 * to track status progression.
 *
 * Issue: #96
 * Branch: issue-096-implement-deployment-pipeline-orchestration
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { deploymentPipelineService } from '@/services/deployment-pipeline.service';
import { validateCustomizationConfig } from '@/lib/customization/validate';

export const POST = withAuth(async (req: NextRequest, { user }) => {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const raw = body as Record<string, unknown>;

    // Validate required fields
    if (!raw?.templateId || typeof raw.templateId !== 'string') {
        return NextResponse.json({ error: 'templateId is required' }, { status: 400 });
    }

    if (!raw?.name || typeof raw.name !== 'string' || raw.name.trim().length === 0) {
        return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const validation = validateCustomizationConfig(raw?.customization);
    if (!validation.valid) {
        return NextResponse.json(
            {
                error: 'Invalid customization config',
                details: validation.errors,
            },
            { status: 400 },
        );
    }

    const result = await deploymentPipelineService.deploy({
        userId: user.id,
        templateId: raw.templateId.trim(),
        name: (raw.name as string).trim(),
        customization: raw.customization as import('@craft/types').CustomizationConfig,
    });

    if (!result.success) {
        return NextResponse.json(
            {
                error: result.errorMessage ?? 'Deployment pipeline failed',
                deploymentId: result.deploymentId,
                failedStage: result.failedStage,
            },
            { status: 422 },
        );
    }

    return NextResponse.json(
        {
            deploymentId: result.deploymentId,
            repositoryUrl: result.repositoryUrl,
            deploymentUrl: result.deploymentUrl,
        },
        { status: 202 },
    );
});
