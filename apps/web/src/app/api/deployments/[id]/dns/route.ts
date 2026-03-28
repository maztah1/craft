/**
 * GET /api/deployments/[id]/dns
 *
 * Returns DNS configuration instructions for the custom domain attached to a
 * deployment. Includes A, AAAA, and CNAME records plus per-provider setup
 * guides for Cloudflare, Namecheap, GoDaddy, and Route 53.
 *
 * Authentication & ownership:
 *   Requires a valid session (401) and ownership of the deployment (403).
 *
 * Responses:
 *   200 — DNS configuration generated
 *         { domain, records, providerInstructions, notes }
 *   404 — Deployment not found or no custom domain configured
 *   401 — Not authenticated
 *   403 — Not authorized for this deployment
 *   500 — Unexpected error
 *
 * Feature: dns-configuration-generation
 */

import { NextRequest, NextResponse } from 'next/server';
import { withDomainTierCheck } from '@/lib/api/with-auth';
import { generateDnsConfiguration } from '@/lib/dns/dns-configuration';

export const GET = withDomainTierCheck(async (_req: NextRequest, { params, supabase }) => {
    const { data: deployment, error } = await supabase
        .from('deployments')
        .select('custom_domain')
        .eq('id', params.id)
        .single();

    if (error || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (!deployment.custom_domain) {
        return NextResponse.json(
            { error: 'No custom domain configured for this deployment' },
            { status: 404 },
        );
    }

    const config = generateDnsConfiguration(deployment.custom_domain);
    return NextResponse.json(config);
});
