import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockAddDomain = vi.fn();
const mockGetCertificate = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

vi.mock('@/services/vercel.service', () => ({
    VercelService: vi.fn().mockImplementation(() => ({
        addDomain: mockAddDomain,
        getCertificate: mockGetCertificate,
    })),
    VercelApiError: class VercelApiError extends Error {
        constructor(message: string, public code: string, public retryAfterMs?: number) {
            super(message);
        }
    },
}));

const fakeUser = { id: 'user-1' };
const params = { id: 'dep-1' };

function makeRequest(method: 'POST' | 'GET') {
    return new NextRequest(`http://localhost/api/deployments/dep-1/https`, { method });
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

const fullDeployment = {
    user_id: fakeUser.id,
    custom_domain: 'example.com',
    vercel_project_id: 'prj_1',
};

describe('POST /api/deployments/[id]/https', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { POST } = await import('./route');
        expect((await POST(makeRequest('POST'), { params })).status).toBe(401);
    });

    it('returns 403 when deployment belongs to another user', async () => {
        mockFrom.mockReturnValue(
            makeSupabaseQuery([{ data: { user_id: 'other' }, error: null }]),
        );
        const { POST } = await import('./route');
        expect((await POST(makeRequest('POST'), { params })).status).toBe(403);
    });

    it('returns 404 when no custom_domain configured', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { custom_domain: null, vercel_project_id: 'prj_1' }, error: null }]));
        const { POST } = await import('./route');
        expect((await POST(makeRequest('POST'), { params })).status).toBe(404);
    });

    it('returns 404 when no vercel_project_id configured', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { custom_domain: 'example.com', vercel_project_id: null }, error: null }]));
        const { POST } = await import('./route');
        expect((await POST(makeRequest('POST'), { params })).status).toBe(404);
    });

    it('returns 409 when domain already added', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: fullDeployment, error: null }]));
        const { VercelApiError } = await import('@/services/vercel.service');
        mockAddDomain.mockRejectedValue(new VercelApiError('exists', 'DOMAIN_EXISTS'));
        const { POST } = await import('./route');
        expect((await POST(makeRequest('POST'), { params })).status).toBe(409);
    });

    it('returns 429 with Retry-After when rate limited', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: fullDeployment, error: null }]));
        const { VercelApiError } = await import('@/services/vercel.service');
        mockAddDomain.mockRejectedValue(new VercelApiError('rate limited', 'RATE_LIMITED', 30_000));
        const { POST } = await import('./route');
        const res = await POST(makeRequest('POST'), { params });
        expect(res.status).toBe(429);
        expect(res.headers.get('Retry-After')).toBe('30');
    });

    it('returns 200 with cert state on success', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: fullDeployment, error: null }]));
        mockAddDomain.mockResolvedValue(undefined);
        mockGetCertificate.mockResolvedValue({ domain: 'example.com', state: 'pending' });
        const { POST } = await import('./route');
        const res = await POST(makeRequest('POST'), { params });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.state).toBe('pending');
        expect(body.domain).toBe('example.com');
    });
});

describe('GET /api/deployments/[id]/https', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 404 when no custom domain configured', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { custom_domain: null, vercel_project_id: 'prj_1' }, error: null }]));
        const { GET } = await import('./route');
        expect((await GET(makeRequest('GET'), { params })).status).toBe(404);
    });

    it('returns 200 with active cert state', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: fullDeployment, error: null }]));
        mockGetCertificate.mockResolvedValue({
            domain: 'example.com',
            state: 'active',
            expiresAt: '2027-01-01T00:00:00Z',
        });
        const { GET } = await import('./route');
        const res = await GET(makeRequest('GET'), { params });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.state).toBe('active');
        expect(body.expiresAt).toBe('2027-01-01T00:00:00Z');
    });
});
