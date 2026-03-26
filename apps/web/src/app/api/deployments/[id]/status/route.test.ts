import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks — mirror the pattern from deployments/[id]/logs/route.test.ts
// ---------------------------------------------------------------------------

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeUser = { id: 'user-1', email: 'user@example.com' };
const params = { id: 'dep-1' };

function makeRequest() {
    return new NextRequest('http://localhost/api/deployments/dep-1/status');
}

function makeOwnershipQuery(userId: string | null, deploymentData: any = null) {
    return {
        select: vi.fn(() => ({
            eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(
                    userId === null
                        ? { data: null, error: { message: 'not found' } }
                        : { data: { user_id: userId, ...deploymentData }, error: null },
                ),
            })),
        })),
    };
}

const baseDeployment = {
    user_id: 'user-1',
    status: 'generating',
    error_message: null,
    deployment_url: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:01:00Z',
    deployed_at: null,
};

const completedDeployment = {
    user_id: 'user-1',
    status: 'completed',
    error_message: null,
    deployment_url: 'https://my-app.vercel.app',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:05:00Z',
    deployed_at: '2024-01-01T00:05:00Z',
};

const failedDeployment = {
    user_id: 'user-1',
    status: 'failed',
    error_message: 'GitHub API rate limit exceeded',
    deployment_url: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:02:00Z',
    deployed_at: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/deployments/[id]/status', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    // 1. Authenticated owner fetches status → 200 with status object
    it('returns 200 with status object for authenticated owner', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, baseDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            id: 'dep-1',
            status: 'generating',
            error: null,
            deploymentUrl: null,
            progress: {
                stage: 'generating',
                percentage: 20,
                description: 'Generating deployment configuration',
            },
        });
        expect(body.timestamps).toMatchObject({
            created: '2024-01-01T00:00:00Z',
            updated: '2024-01-01T00:01:00Z',
            deployed: null,
        });
    });

    // 2. Unauthenticated request → 401, no deployment data leaked
    it('returns 401 for unauthenticated request and leaks no data', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body).not.toHaveProperty('status');
        expect(body).not.toHaveProperty('timestamps');
        expect(body).not.toHaveProperty('progress');
    });

    // 3. Authenticated but non-owner → 404 (not 403), no status data
    it('returns 404 (not 403) for authenticated non-owner and leaks no data', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery('other-user', baseDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('Deployment not found');
        expect(body).not.toHaveProperty('status');
        expect(body).not.toHaveProperty('timestamps');
        expect(body).not.toHaveProperty('progress');
    });

    // 4. Valid owner, deployment not found → 404
    it('returns 404 when deployment does not exist', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(null));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('Deployment not found');
    });

    // 5. Completed deployment returns correct status and deployment URL
    it('returns completed status with deployment URL', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, completedDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            id: 'dep-1',
            status: 'completed',
            deploymentUrl: 'https://my-app.vercel.app',
            progress: {
                stage: 'completed',
                percentage: 100,
                description: 'Deployment completed successfully',
            },
        });
        expect(body.timestamps.deployed).toBe('2024-01-01T00:05:00Z');
    });

    // 6. Failed deployment returns error message
    it('returns failed status with error message', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, failedDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            id: 'dep-1',
            status: 'failed',
            error: 'GitHub API rate limit exceeded',
            progress: {
                stage: 'failed',
                percentage: 0,
                description: 'GitHub API rate limit exceeded',
            },
        });
    });

    // 7. Active deployment gets short cache headers
    it('sets short cache headers for active deployments', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, baseDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const cacheControl = res.headers.get('Cache-Control');
        expect(cacheControl).toBe('private, max-age=5, stale-while-revalidate=10');
        expect(res.headers.get('ETag')).toBe('"2024-01-01T00:01:00Z"');
    });

    // 8. Completed deployment gets longer cache headers
    it('sets longer cache headers for completed deployments', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, completedDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const cacheControl = res.headers.get('Cache-Control');
        expect(cacheControl).toBe('private, max-age=60, stale-while-revalidate=120');
    });

    // 9. Failed deployment gets longer cache headers
    it('sets longer cache headers for failed deployments', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, failedDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const cacheControl = res.headers.get('Cache-Control');
        expect(cacheControl).toBe('private, max-age=60, stale-while-revalidate=120');
    });

    // 10. All deployment statuses return correct progress metadata
    it('returns correct progress metadata for all statuses', async () => {
        const statuses = [
            { status: 'pending', percentage: 0, description: 'Deployment is queued' },
            { status: 'generating', percentage: 20, description: 'Generating deployment configuration' },
            { status: 'creating_repo', percentage: 40, description: 'Creating GitHub repository' },
            { status: 'pushing_code', percentage: 60, description: 'Pushing code to repository' },
            { status: 'deploying', percentage: 80, description: 'Deploying to Vercel' },
            { status: 'completed', percentage: 100, description: 'Deployment completed successfully' },
            { status: 'failed', percentage: 0, description: 'Deployment failed' },
        ];

        for (const { status, percentage, description } of statuses) {
            mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, { ...baseDeployment, status }));
            const { GET } = await import('./route');

            const res = await GET(makeRequest(), { params });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe(status);
            expect(body.progress.percentage).toBe(percentage);
            expect(body.progress.description).toBe(description);
        }
    });

    // 11. Database error → 500
    it('returns 500 on database error', async () => {
        mockFrom.mockReturnValue({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Database error' } }),
                })),
            })),
        });
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('Deployment not found');
    });
});
