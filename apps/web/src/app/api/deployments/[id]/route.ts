/**
 * GET /api/deployments/[id]
 *
 * Returns the current state of a deployment record so the UI can poll
 * for status progression.
 *
 * Authentication: requires a valid session + ownership of the deployment.
 *
 * Responses:
 *   200 — Deployment record
 *   401 — Not authenticated
 *   403 — Not authorized
 *   404 — Deployment not found
 *
 * Issue: #96
 * Branch: issue-096-implement-deployment-pipeline-orchestration
 */

import { NextRequest, NextResponse } from 'next/server';
import { withDeploymentAuth } from '@/lib/api/with-auth';

export const GET = withDeploymentAuth(async (_req: NextRequest, { params, supabase }) => {
    const { data: deployment, error } = await supabase
        .from('deployments')
        .select(
            'id, name, status, repository_url, deployment_url, vercel_project_id, vercel_deployment_id, error_message, created_at, updated_at, deployed_at',
        )
        .eq('id', params.id)
        .single();

    if (error || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    return NextResponse.json(deployment);
});
