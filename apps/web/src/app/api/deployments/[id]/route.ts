/**
 * GET /api/deployments/[id]
 *
 * Returns deployment details for a single deployment.
 * Enforces ownership checks and returns normalized deployment metadata.
 *
 * Authentication: requires a valid Supabase session (401 if missing).
 * Ownership: the authenticated user must own the deployment.
 *            Non-owners and missing deployments both return 404 to prevent
 *            existence leakage.
 *
 * Response includes:
 *   - Normalized deployment metadata (id, name, status, timestamps)
 *   - Provider identifiers (template_id, vercel_project_id)
 *   - URLs (deployment_url, repository_url)
 *   - Customization configuration
 *   - Error message (if failed)
 *
 * Responses:
 *   200 — Deployment details object
 *   401 — Not authenticated
 *   404 — Deployment not found (or not owned by caller)
 *   500 — Unexpected server error
 *
 * Issue: #107
 * Branch: issue-107-create-the-deployment-detail-route
 */

/**
 * DELETE /api/deployments/[id]
 *
 * Deletes a deployment and all associated resources (GitHub repository, Vercel project).
 * Enforces ownership checks and performs safe cleanup of external services.
 *
 * Authentication: requires a valid Supabase session (401 if missing).
 * Ownership: the authenticated user must own the deployment.
 *            Non-owners and missing deployments both return 404 to prevent
 *            existence leakage.
 *
 * Deletion flow:
 *   1. Verify deployment exists and user owns it
 *   2. Delete GitHub repository (if repository_url exists)
 *   3. Delete Vercel project (if vercel_project_id exists)
 *   4. Delete deployment record (cascades to logs and analytics)
 *
 * Responses:
 *   200 — Deployment deleted successfully
 *         { success: true, deploymentId: string }
 *   401 — Not authenticated
 *   404 — Deployment not found (or not owned by caller)
 *   500 — Unexpected server error
 *
 * Issue: #110
 * Branch: issue-110-create-the-deployment-deletion-route
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { githubService } from '@/services/github.service';
import { vercelService } from '@/services/vercel.service';

export const GET = withAuth(async (req: NextRequest, { params, user, supabase }) => {
    const deploymentId = (params as { id: string }).id;

    // Fetch deployment with ownership check — return 404 for both missing and non-owned
    // deployments to prevent existence leakage (issue spec: non-owners receive 404, not 403).
    const { data: deployment, error: fetchError } = await supabase
        .from('deployments')
        .select('*')
        .eq('id', deploymentId)
        .single();

    if (fetchError || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (deployment.user_id !== user.id) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    // Build normalized response with deployment metadata, provider identifiers, and URLs
    const response = {
        id: deployment.id,
        name: deployment.name,
        status: deployment.status,
        templateId: deployment.template_id,
        vercelProjectId: deployment.vercel_project_id,
        deploymentUrl: deployment.deployment_url,
        repositoryUrl: deployment.repository_url,
        customizationConfig: deployment.customization_config,
        errorMessage: deployment.error_message,
        timestamps: {
            created: deployment.created_at,
            updated: deployment.updated_at,
            deployed: deployment.deployed_at,
        },
    };

    return NextResponse.json(response);
});

export const DELETE = withAuth(async (req: NextRequest, { params, user, supabase }) => {
    const deploymentId = (params as { id: string }).id;

    // Fetch deployment with ownership check — return 404 for both missing and non-owned
    // deployments to prevent existence leakage (issue spec: non-owners receive 404, not 403).
    const { data: deployment, error: fetchError } = await supabase
        .from('deployments')
        .select('user_id, repository_url, vercel_project_id')
        .eq('id', deploymentId)
        .single();

    if (fetchError || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (deployment.user_id !== user.id) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    // Best-effort cleanup of external resources before DB deletion.
    // Errors are logged but don't block the deployment record deletion.

    // Delete GitHub repository if it exists
    if (deployment.repository_url) {
        try {
            // Extract owner/repo from GitHub URL (e.g., https://github.com/owner/repo)
            const urlMatch = deployment.repository_url.match(/github\.com\/([^/]+)\/([^/]+)/);
            if (urlMatch) {
                const [, owner, repo] = urlMatch;
                await githubService.deleteRepository(owner, repo);
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[deployment-delete] GitHub cleanup failed for ${deploymentId}:`, message);
            // Continue — DB deletion should succeed regardless
        }
    }

    // Delete Vercel project if it exists
    if (deployment.vercel_project_id) {
        try {
            await vercelService.deleteProject(deployment.vercel_project_id);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[deployment-delete] Vercel cleanup failed for ${deploymentId}:`, message);
            // Continue — DB deletion should succeed regardless
        }
    }

    // Delete deployment record (cascades to deployment_logs and deployment_analytics)
    const { error: deleteError } = await supabase
        .from('deployments')
        .delete()
        .eq('id', deploymentId);

    if (deleteError) {
        console.error(`[deployment-delete] Database deletion failed for ${deploymentId}:`, deleteError.message);
        return NextResponse.json(
            { error: 'Failed to delete deployment' },
            { status: 500 }
        );
    }

    return NextResponse.json({
        success: true,
        deploymentId,
    });
});
