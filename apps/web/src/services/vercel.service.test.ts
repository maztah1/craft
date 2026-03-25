/**
 * Tests for VercelService
 *
 * Covers:
 *   - createProject: success, auth failure, rate limit, project exists
 *   - triggerDeployment: success, network error
 *   - validateAccess: returns true/false based on API response
 *
 * Issue: #96
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VercelService, VercelApiError } from './vercel.service';

const MOCK_TOKEN = 'test-vercel-token';

function makeService(token = MOCK_TOKEN, teamId?: string) {
    const svc = new VercelService();
    vi.stubEnv('VERCEL_TOKEN', token);
    if (teamId) vi.stubEnv('VERCEL_TEAM_ID', teamId);
    return svc;
}

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
    const responseHeaders = new Headers(headers);
    return vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        headers: responseHeaders,
        json: () => Promise.resolve(body),
    });
}

describe('VercelService', () => {
    beforeEach(() => {
        vi.stubEnv('VERCEL_TOKEN', MOCK_TOKEN);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    describe('createProject', () => {
        it('creates a project and sets env vars', async () => {
            const svc = makeService();

            // First call: create project; second call: set env vars
            const fetchMock = vi
                .fn()
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    headers: new Headers(),
                    json: () =>
                        Promise.resolve({ id: 'prj_1', name: 'craft-app', link: {} }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    headers: new Headers(),
                    json: () => Promise.resolve({ created: [] }),
                });

            vi.stubGlobal('fetch', fetchMock);

            const project = await svc.createProject({
                name: 'craft-app',
                gitRepo: 'org/repo',
                envVars: [
                    { key: 'NEXT_PUBLIC_APP_NAME', value: 'TestApp', target: ['production'], type: 'plain' },
                ],
            });

            expect(project.id).toBe('prj_1');
            expect(project.name).toBe('craft-app');
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('skips env var call when envVars is empty', async () => {
            const svc = makeService();

            const fetchMock = vi.fn().mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers(),
                json: () => Promise.resolve({ id: 'prj_2', name: 'craft-app' }),
            });

            vi.stubGlobal('fetch', fetchMock);

            await svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] });

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('throws VercelApiError with PROJECT_EXISTS on 409', async () => {
            const svc = makeService();
            vi.stubGlobal('fetch', mockFetch(409, { error: { message: 'already exists' } }));

            await expect(
                svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] }),
            ).rejects.toThrow(VercelApiError);

            await expect(
                svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] }),
            ).rejects.toMatchObject({ code: 'PROJECT_EXISTS' });
        });

        it('throws VercelApiError with AUTH_FAILED on 401', async () => {
            const svc = makeService();
            vi.stubGlobal('fetch', mockFetch(401, { message: 'Unauthorized' }));

            await expect(
                svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] }),
            ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
        });

        it('throws VercelApiError with RATE_LIMITED on 429', async () => {
            const svc = makeService();
            vi.stubGlobal(
                'fetch',
                mockFetch(429, { message: 'Rate limited' }, { 'Retry-After': '30' }),
            );

            await expect(
                svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] }),
            ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 30000 });
        });

        it('throws VercelApiError with AUTH_FAILED when token is missing', async () => {
            vi.stubEnv('VERCEL_TOKEN', '');
            const svc = new VercelService();

            await expect(
                svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] }),
            ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
        });
    });

    describe('triggerDeployment', () => {
        it('returns deploymentId and URL on success', async () => {
            const svc = makeService();
            vi.stubGlobal(
                'fetch',
                mockFetch(200, {
                    id: 'dpl_abc',
                    url: 'craft-app.vercel.app',
                    status: 'QUEUED',
                }),
            );

            const result = await svc.triggerDeployment('prj_1', 'org/repo');

            expect(result.deploymentId).toBe('dpl_abc');
            expect(result.deploymentUrl).toBe('https://craft-app.vercel.app');
            expect(result.status).toBe('QUEUED');
        });

        it('throws VercelApiError with NETWORK_ERROR on fetch failure', async () => {
            const svc = makeService();
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));

            await expect(svc.triggerDeployment('prj_1', 'org/repo')).rejects.toMatchObject({
                code: 'NETWORK_ERROR',
            });
        });
    });

    describe('validateAccess', () => {
        it('returns true when API responds ok', async () => {
            const svc = makeService();
            vi.stubGlobal('fetch', mockFetch(200, { uid: 'user_1' }));

            expect(await svc.validateAccess()).toBe(true);
        });

        it('returns false on 401', async () => {
            const svc = makeService();
            vi.stubGlobal('fetch', mockFetch(401, { message: 'Unauthorized' }));

            expect(await svc.validateAccess()).toBe(false);
        });

        it('returns false on network error', async () => {
            const svc = makeService();
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));

            expect(await svc.validateAccess()).toBe(false);
        });
    });
});
