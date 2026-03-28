/**
 * POST /api/deployments/[id]/dns/verify
 *
 * Verifies domain ownership for the custom domain attached to a deployment.
 * Supports TXT record and CNAME verification methods.
 *
 * Authentication & ownership:
 *   Requires a valid session (401) and ownership of the deployment (403).
 *
 * Request body:
 *   {
 *     "method": "txt" | "cname"   — verification method
 *     "token":  string            — required for method "txt"; the value the
 *                                   user placed in their TXT record at
 *                                   _craft-verify.<domain>
 *   }
 *
 * Responses:
 *   200 — Verification result (verified: true/false + details)
 *   400 — Invalid request body
 *   404 — Deployment not found or no custom domain configured
 *   401 — Not authenticated
 *   403 — Not authorized for this deployment
 *   500 — Unexpected error
 *
 * Feature: domain-verification
 */

import { NextRequest, NextResponse } from 'next/server';
import { withDomainTierCheck } from '@/lib/api/with-auth';
import { verifyViaTxt, verifyViaCname } from '@/lib/dns/domain-verification';

interface RequestBody {
    method: 'txt' | 'cname';
    token?: string;
}

function normalizeBody(raw: unknown): RequestBody | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const body = raw as Record<string, unknown>;

    if (body.method !== 'txt' && body.method !== 'cname') return null;
    if (body.method === 'txt' && typeof body.token !== 'string') return null;
    if (body.method === 'cname' && 'token' in body && typeof body.token !== 'string') return null;

    return body as RequestBody;
}

export const POST = withDomainTierCheck(async (req: NextRequest, { params, supabase }) => {
    let body: RequestBody;
    try {
        const raw = await req.json();
        const normalized = normalizeBody(raw);
        if (!normalized) {
            return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
        }
        body = normalized;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

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

    try {
        const result =
            body.method === 'txt'
                ? await verifyViaTxt(deployment.custom_domain, body.token!)
                : await verifyViaCname(deployment.custom_domain);

        return NextResponse.json(result);
    } catch (err: unknown) {
        return NextResponse.json(
            { error: (err as Error).message ?? 'Verification failed' },
            { status: 500 },
        );
    }
});
