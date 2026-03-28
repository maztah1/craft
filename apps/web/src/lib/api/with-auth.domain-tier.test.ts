/**
 * Tests for withDomainTierCheck middleware.
 * Verifies that free-tier users are blocked from custom-domain endpoints
 * and that pro/enterprise users are allowed through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ auth: { getUser: mockGetUser }, from: mockFrom }),
}));

// Stub pricing so tests don't depend on env vars
vi.mock('@/lib/stripe/pricing', () => ({
    canConfigureCustomDomain: (tier: string) => tier === 'pro' || tier === 'enterprise',
}));

const fakeUser = { id: 'user-1' };
const params = { id: 'dep-1' };

function makeRequest() {
    return new NextRequest('http://localhost/test', { method: 'GET' });
}

type QueryResult = { data: Record<string, unknown> | null; error: { message: string } | null };

function makeSupabaseQuery(results: QueryResult[]) {
    return {
        select: vi.fn(() => ({
            eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(results.shift() ?? { data: null, error: null }),
            })),
        })),
    };
}

describe('withDomainTierCheck', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { withDomainTierCheck } = await import('./with-auth');
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const route = withDomainTierCheck(handler);
        const res = await route(makeRequest(), { params });
        expect(res.status).toBe(401);
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 403 when deployment belongs to another user', async () => {
        mockFrom.mockReturnValue(
            makeSupabaseQuery([{ data: { user_id: 'other-user' }, error: null }]),
        );
        const { withDomainTierCheck } = await import('./with-auth');
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const route = withDomainTierCheck(handler);
        const res = await route(makeRequest(), { params });
        expect(res.status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 403 with upgradeUrl for free-tier users', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { subscription_tier: 'free' }, error: null }]));
        const { withDomainTierCheck } = await import('./with-auth');
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const route = withDomainTierCheck(handler);
        const res = await route(makeRequest(), { params });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.upgradeUrl).toBe('/pricing');
        expect(handler).not.toHaveBeenCalled();
    });

    it('falls back to free tier when profile is missing and blocks access', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: null, error: { message: 'not found' } }]));
        const { withDomainTierCheck } = await import('./with-auth');
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const route = withDomainTierCheck(handler);
        const res = await route(makeRequest(), { params });
        expect(res.status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it('calls handler for pro-tier users', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { subscription_tier: 'pro' }, error: null }]));
        const { withDomainTierCheck } = await import('./with-auth');
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const route = withDomainTierCheck(handler);
        const res = await route(makeRequest(), { params });
        expect(res.status).toBe(200);
        expect(handler).toHaveBeenCalledOnce();
    });

    it('calls handler for enterprise-tier users', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { subscription_tier: 'enterprise' }, error: null }]));
        const { withDomainTierCheck } = await import('./with-auth');
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const route = withDomainTierCheck(handler);
        const res = await route(makeRequest(), { params });
        expect(res.status).toBe(200);
        expect(handler).toHaveBeenCalledOnce();
    });
});
