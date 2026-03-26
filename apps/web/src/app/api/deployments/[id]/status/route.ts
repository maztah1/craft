/**
 * GET /api/deployments/[id]/status
 *
 * Returns the current deployment status with timestamps and progress metadata.
 * Optimized for repeated polling with caching headers.
 *
 * Authentication: requires a valid Supabase session (401 if missing).
 * Ownership: the authenticated user must own the deployment.
 *            Non-owners and missing deployments both return 404 to prevent
 *            existence leakage.
 *
 * Response includes:
 *   - Current deployment status
 *   - Timestamps (created, updated, deployed)
 *   - Progress metadata (stage, error message if failed)
 *   - Deployment URL (if completed)
 *
 * Caching:
 *   - Cache-Control: private, max-age=5 (5 seconds for active deployments)
 *   - Cache-Control: private, max-age=60 (60 seconds for completed/failed deployments)
 *
 * Responses:
 *   200 — Deployment status object
 *   401 — Not authenticated
 *   404 — Deployment not found (or not owned by caller)
 *   500 — Unexpected server error
 *
 * Issue: #108
 * Branch: issue-108-create-the-deployment-status-route
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';

export const GET = withAuth(async (req: NextRequest, { params, user, supabase }) => {
    const deploymentId = (params as { id: string }).id;

    // Fetch deployment with ownership check — return 404 for both missing and non-owned
    // deployments to prevent existence leakage (issue spec: non-owners receive 404, not 403).
    const { data: deployment, error: fetchError } = await supabase
        .from('deployments')
        .select('user_id, status, error_message, deployment_url, created_at, updated_at, deployed_at')
        .eq('id', deploymentId)
        .single();

    if (fetchError || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (deployment.user_id !== user.id) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    // Build response with status and timestamps
    const response = {
        id: deploymentId,
        status: deployment.status,
        error: deployment.error_message,
        deploymentUrl: deployment.deployment_url,
        timestamps: {
            created: deployment.created_at,
            updated: deployment.updated_at,
            deployed: deployment.deployed_at,
        },
        // Progress metadata based on status
        progress: getProgressMetadata(deployment.status, deployment.error_message),
    };

    // Set caching headers based on deployment status
    // Active deployments (pending, generating, creating_repo, pushing_code, deploying) get shorter cache
    // Terminal states (completed, failed) get longer cache
    const isActive = !['completed', 'failed'].includes(deployment.status);
    const cacheControl = isActive
        ? 'private, max-age=5, stale-while-revalidate=10'
        : 'private, max-age=60, stale-while-revalidate=120';

    return NextResponse.json(response, {
        headers: {
            'Cache-Control': cacheControl,
            'ETag': `"${deployment.updated_at}"`,
        },
    });
});

/**
 * Returns progress metadata based on deployment status.
 * Provides human-readable stage information and completion percentage.
 */
function getProgressMetadata(status: string, errorMessage: string | null) {
    const stages: Record<string, { stage: string; percentage: number; description: string }> = {
        pending: {
            stage: 'pending',
            percentage: 0,
            description: 'Deployment is queued',
        },
        generating: {
            stage: 'generating',
            percentage: 20,
            description: 'Generating deployment configuration',
        },
        creating_repo: {
            stage: 'creating_repo',
            percentage: 40,
            description: 'Creating GitHub repository',
        },
        pushing_code: {
            stage: 'pushing_code',
            percentage: 60,
            description: 'Pushing code to repository',
        },
        deploying: {
            stage: 'deploying',
            percentage: 80,
            description: 'Deploying to Vercel',
        },
        completed: {
            stage: 'completed',
            percentage: 100,
            description: 'Deployment completed successfully',
        },
        failed: {
            stage: 'failed',
            percentage: 0,
            description: errorMessage || 'Deployment failed',
        },
    };

    return stages[status] || {
        stage: status,
        percentage: 0,
        description: `Unknown status: ${status}`,
    };
}
