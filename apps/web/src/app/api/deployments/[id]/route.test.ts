import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks — mirror the pattern from deployments/[id]/status/route.test.ts
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
    return new NextRequest('http://localhost/api/deployments/dep-1');
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
    id: 'dep-1',
    user_id: 'user-1',
    name: 'My Deployment',
    status: 'generating',
    template_id: 'template-1',
    vercel_project_id: 'vercel-proj-1',
    deployment_url: null,
    repository_url: 'https://github.com/user/repo',
    customization_config: { theme: 'dark' },
    error_message: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:01:00Z',
    deployed_at: null,
};

const completedDeployment = {
    ...baseDeployment,
    status: 'completed',
    deployment_url: 'https://my-app.vercel.app',
    updated_at: '2024-01-01T00:05:00Z',
    deployed_at: '2024-01-01T00:05:00Z',
};

const failedDeployment = {
    ...baseDeployment,
    status: 'failed',
    error_message: 'GitHub API rate limit exceeded',
    updated_at: '2024-01-01T00:02:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/deployments/[id]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    // 1. Authenticated owner fetches deployment → 200 with deployment details
    it('returns 200 with deployment details for authenticated owner', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, baseDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            id: 'dep-1',
            name: 'My Deployment',
            status: 'generating',
            templateId: 'template-1',
            vercelProjectId: 'vercel-proj-1',
            deploymentUrl: null,
            repositoryUrl: 'https://github.com/user/repo',
            customizationConfig: { theme: 'dark' },
            errorMessage: null,
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
        expect(body).not.toHaveProperty('name');
        expect(body).not.toHaveProperty('status');
        expect(body).not.toHaveProperty('timestamps');
    });

    // 3. Authenticated but non-owner → 404 (not 403), no deployment data
    it('returns 404 (not 403) for authenticated non-owner and leaks no data', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery('other-user', baseDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('Deployment not found');
        expect(body).not.toHaveProperty('name');
        expect(body).not.toHaveProperty('status');
        expect(body).not.toHaveProperty('timestamps');
    });

    // 4. Valid owner, deployment not found → 404
    it('returns 404 when deployment does not exist', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(null));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('Deployment not found');
    });

    // 5. Completed deployment returns correct details and deployment URL
    it('returns completed deployment with deployment URL', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, completedDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            id: 'dep-1',
            name: 'My Deployment',
            status: 'completed',
            deploymentUrl: 'https://my-app.vercel.app',
            templateId: 'template-1',
            vercelProjectId: 'vercel-proj-1',
        });
        expect(body.timestamps.deployed).toBe('2024-01-01T00:05:00Z');
    });

    // 6. Failed deployment returns error message
    it('returns failed deployment with error message', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, failedDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            id: 'dep-1',
            name: 'My Deployment',
            status: 'failed',
            errorMessage: 'GitHub API rate limit exceeded',
        });
    });

    // 7. Deployment with null optional fields returns null values
    it('returns null for optional fields when not set', async () => {
        const deploymentWithNulls = {
            ...baseDeployment,
            vercel_project_id: null,
            deployment_url: null,
            repository_url: null,
            customization_config: null,
            error_message: null,
            deployed_at: null,
        };
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, deploymentWithNulls));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.vercelProjectId).toBeNull();
        expect(body.deploymentUrl).toBeNull();
        expect(body.repositoryUrl).toBeNull();
        expect(body.customizationConfig).toBeNull();
        expect(body.errorMessage).toBeNull();
        expect(body.timestamps.deployed).toBeNull();
    });

    // 8. Database error → 404 (not 500) to prevent existence leakage
    it('returns 404 on database error', async () => {
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

    // 9. Response includes all required fields for deployment detail UI
    it('returns all required fields for deployment detail UI', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, baseDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        
        // Check all required fields are present
        expect(body).toHaveProperty('id');
        expect(body).toHaveProperty('name');
        expect(body).toHaveProperty('status');
        expect(body).toHaveProperty('templateId');
        expect(body).toHaveProperty('vercelProjectId');
        expect(body).toHaveProperty('deploymentUrl');
        expect(body).toHaveProperty('repositoryUrl');
        expect(body).toHaveProperty('customizationConfig');
        expect(body).toHaveProperty('errorMessage');
        expect(body).toHaveProperty('timestamps');
        expect(body.timestamps).toHaveProperty('created');
        expect(body.timestamps).toHaveProperty('updated');
        expect(body.timestamps).toHaveProperty('deployed');
    });
});
