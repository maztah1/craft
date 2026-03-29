import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

vi.mock('@/lib/stripe/pricing', () => ({
    canConfigureCustomDomain: (tier: string) => tier === 'pro' || tier === 'enterprise',
}));

const fakeUser = { id: 'user-1', email: 'user@example.com' };
const params = { id: 'dep-1' };

function makeRequest() {
    return new NextRequest('http://localhost/api/deployments/dep-1/dns', { method: 'GET' });
}

type QueryResult = { data: Record<string, unknown> | null; error: { message: string } | null };

/** Builds a minimal Supabase mock that returns results in call order. */
function makeSupabaseQuery(results: QueryResult[]) {
    return {
        select: vi.fn(() => ({
            eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(results.shift() ?? { data: null, error: null }),
            })),
        })),
    };
}

describe('GET /api/deployments/[id]/dns', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(401);
    });

    it('returns 403 when the deployment belongs to another user', async () => {
        mockFrom.mockReturnValue(
            makeSupabaseQuery([{ data: { user_id: 'other-user' }, error: null }]),
        );
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(403);
    });

    it('returns 403 with upgradeUrl for free-tier users', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { subscription_tier: 'free' }, error: null }]));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.upgradeUrl).toBe('/pricing');
    });

    it('returns 404 when the deployment is not found (pro user)', async () => {
        mockFrom
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { subscription_tier: 'pro' }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: null, error: { message: 'not found' } }]),
            );
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(404);
    });

    it('returns 404 when no custom domain is configured (pro user)', async () => {
        mockFrom
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { subscription_tier: 'pro' }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { custom_domain: null }, error: null }]),
            );
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toMatch(/no custom domain/i);
    });

    it('returns 200 with DNS config for an apex domain (pro user)', async () => {
        mockFrom
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { subscription_tier: 'pro' }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { custom_domain: 'example.com' }, error: null }]),
            );
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.domain).toBe('example.com');
        expect(body.records.some((r: { type: string }) => r.type === 'A')).toBe(true);
        expect(body.records.some((r: { type: string }) => r.type === 'AAAA')).toBe(true);
        expect(body.providerInstructions.length).toBeGreaterThan(0);
        expect(Array.isArray(body.notes)).toBe(true);
    });

    it('returns 200 with a CNAME record for a subdomain (enterprise user)', async () => {
        mockFrom
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { subscription_tier: 'enterprise' }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([
                    { data: { custom_domain: 'www.example.com' }, error: null },
                ]),
            );
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.records.some((r: { type: string }) => r.type === 'CNAME')).toBe(true);
    });

    it('returns 403 with upgrade prompt for free-tier users', async () => {
        const { requireDomainTier } = await import('@/lib/api/require-domain-tier');
        vi.mocked(requireDomainTier).mockResolvedValueOnce(
            new Response(
                JSON.stringify({ error: 'Custom domains require a Pro or Enterprise subscription.', requiredTier: 'pro', upgradeUrl: '/pricing' }),
                { status: 403, headers: { 'Content-Type': 'application/json' } },
            ) as unknown as import('next/server').NextResponse,
        );
        mockFrom.mockReturnValue(
            makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
        );
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiredTier).toBe('pro');
        expect(body.upgradeUrl).toBe('/pricing');
    });
});
