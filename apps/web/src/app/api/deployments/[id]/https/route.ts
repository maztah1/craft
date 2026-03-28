/**
 * POST /api/deployments/[id]/https
 *
 * Enables HTTPS for the custom domain attached to a deployment by adding the
 * domain to the Vercel project and returning the initial certificate state.
 * Callers should poll this endpoint (GET) to track provisioning progress.
 *
 * Authentication & ownership:
 *   Requires a valid session (401) and ownership of the deployment (403).
 *
 * POST — add domain + begin SSL provisioning
 *   Responses:
 *     200 — { domain, state, expiresAt? }
 *     404 — No custom domain or Vercel project configured
 *     409 — Domain already added to the Vercel project
 *     401 / 403 — Auth / ownership
 *     500 — Unexpected error
 *
 * GET — check current certificate state
 *   Responses:
 *     200 — { domain, state, expiresAt?, error? }
 *     404 — No custom domain or Vercel project configured
 *     401 / 403 — Auth / ownership
 *     500 — Unexpected error
 *
 * Feature: https-enablement-for-verified-domains
 */

import { NextRequest, NextResponse } from 'next/server';
import { withDomainTierCheck } from '@/lib/api/with-auth';
import { VercelService, VercelApiError } from '@/services/vercel.service';

const vercel = new VercelService();

/** Fetch the deployment's custom_domain + vercel_project_id in one query. */
async function fetchDeploymentDomainFields(
    supabase: Parameters<Parameters<typeof withDeploymentAuth>[0]>[1]['supabase'],
    deploymentId: string,
) {
    return supabase
        .from('deployments')
        .select('custom_domain, vercel_project_id')
        .eq('id', deploymentId)
        .single();
}

export const POST = withDomainTierCheck(async (_req: NextRequest, { params, supabase }) => {
    const { data: deployment, error } = await fetchDeploymentDomainFields(supabase, params.id);

    if (error || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (!deployment.custom_domain || !deployment.vercel_project_id) {
        return NextResponse.json(
            { error: 'Deployment must have a custom domain and a Vercel project configured' },
            { status: 404 },
        );
    }

    try {
        await vercel.addDomain(deployment.vercel_project_id, deployment.custom_domain);
    } catch (err: unknown) {
        const vercelErr = err as VercelApiError;
        if (vercelErr.code === 'DOMAIN_EXISTS') {
            return NextResponse.json({ error: vercelErr.message }, { status: 409 });
        }
        if (vercelErr.code === 'AUTH_FAILED') {
            return NextResponse.json({ error: vercelErr.message }, { status: 500 });
        }
        if (vercelErr.code === 'RATE_LIMITED') {
            const res = NextResponse.json({ error: vercelErr.message }, { status: 429 });
            if (vercelErr.retryAfterMs) {
                res.headers.set('Retry-After', String(Math.ceil(vercelErr.retryAfterMs / 1000)));
            }
            return res;
        }
        return NextResponse.json(
            { error: (err as Error).message ?? 'Failed to add domain' },
            { status: 500 },
        );
    }

    // Domain added — fetch initial cert state (will be "pending" immediately after add)
    const cert = await vercel.getCertificate(deployment.vercel_project_id, deployment.custom_domain);
    return NextResponse.json(cert);
});

export const GET = withDomainTierCheck(async (_req: NextRequest, { params, supabase }) => {
    const { data: deployment, error } = await fetchDeploymentDomainFields(supabase, params.id);

    if (error || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (!deployment.custom_domain || !deployment.vercel_project_id) {
        return NextResponse.json(
            { error: 'Deployment must have a custom domain and a Vercel project configured' },
            { status: 404 },
        );
    }

    try {
        const cert = await vercel.getCertificate(deployment.vercel_project_id, deployment.custom_domain);
        return NextResponse.json(cert);
    } catch (err: unknown) {
        return NextResponse.json(
            { error: (err as Error).message ?? 'Failed to retrieve certificate status' },
            { status: 500 },
        );
    }
});
