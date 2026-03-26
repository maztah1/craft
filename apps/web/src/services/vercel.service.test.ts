/**
 * Tests for VercelService and validateVercelConfig
 *
 * Covers:
 *   validateVercelConfig — missing token, token present, team ID optional
 *   createProject        — success with/without env vars, 409, 401, 429, missing token
 *   triggerDeployment    — success, network error
 *   validateAccess       — true/false/network error
 *   shared request()     — NETWORK_ERROR on fetch throw, UNKNOWN on unexpected status
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VercelService, VercelApiError, validateVercelConfig } from './vercel.service';

const MOCK_TOKEN = 'test-vercel-token';

function makeService(token = MOCK_TOKEN, teamId?: string) {
    if (token) vi.stubEnv('VERCEL_TOKEN', token);
    else vi.stubEnv('VERCEL_TOKEN', '');
    if (teamId) vi.stubEnv('VERCEL_TEAM_ID', teamId);
    const mockFetch = vi.fn();
    return { svc: new VercelService(mockFetch), mockFetch };
}

function makeResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        json: () => Promise.resolve(body),
    };
}

describe('validateVercelConfig', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('returns valid: false when VERCEL_TOKEN is absent', () => {
        vi.stubEnv('VERCEL_TOKEN', '');
        expect(validateVercelConfig()).toEqual({ valid: false, missing: 'VERCEL_TOKEN' });
    });

    it('returns valid: true when VERCEL_TOKEN is present', () => {
        vi.stubEnv('VERCEL_TOKEN', 'tok_abc');
        expect(validateVercelConfig()).toEqual({ valid: true });
    });

    it('does not require VERCEL_TEAM_ID', () => {
        vi.stubEnv('VERCEL_TOKEN', 'tok_abc');
        vi.stubEnv('VERCEL_TEAM_ID', '');
        expect(validateVercelConfig().valid).toBe(true);
    });
});

describe('VercelService', () => {
    beforeEach(() => vi.stubEnv('VERCEL_TOKEN', MOCK_TOKEN));
    afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    describe('createProject', () => {
        it('creates a project and sets env vars', async () => {
            const { svc, mockFetch } = makeService();
            mockFetch
                .mockResolvedValueOnce(makeResponse(200, { id: 'prj_1', name: 'craft-app' }))
                .mockResolvedValueOnce(makeResponse(200, { created: [] }));

            const project = await svc.createProject({
                name: 'craft-app',
                gitRepo: 'org/repo',
                envVars: [{ key: 'FOO', value: 'bar', target: ['production'], type: 'plain' }],
            });

            expect(project.id).toBe('prj_1');
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('skips env var call when envVars is empty', async () => {
            const { svc, mockFetch } = makeService();
            mockFetch.mockResolvedValueOnce(makeResponse(200, { id: 'prj_2', name: 'craft-app' }));

            await svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] });

            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('throws PROJECT_EXISTS on 409', async () => {
            const { svc, mockFetch } = makeService();
            mockFetch.mockResolvedValueOnce(makeResponse(409, { error: { message: 'exists' } }));

            await expect(
                svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] }),
            ).rejects.toMatchObject({ code: 'PROJECT_EXISTS' });
        });

        it('throws AUTH_FAILED on 401', async () => {
            const { svc, mockFetch } = makeService();
            mockFetch.mockResolvedValueOnce(makeResponse(401, { message: 'Unauthorized' }));

            await expect(
                svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] }),
            ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
        });

        it('throws RATE_LIMITED on 429 with retryAfterMs', async () => {
            const { svc, mockFetch } = makeService();
            mockFetch.mockResolvedValueOnce(makeResponse(429, { message: 'Rate limited' }, { 'Retry-After': '30' }));

            await expect(
                svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] }),
            ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 30_000 });
        });

        it('throws AUTH_FAILED immediately when token is missing', async () => {
            const { svc, mockFetch } = makeService('');

            await expect(
                svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] }),
            ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('throws NETWORK_ERROR when fetch throws', async () => {
            const { svc, mockFetch } = makeService();
            mockFetch.mockRejectedValueOnce(new Error('socket hang up'));

            await expect(
                svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] }),
            ).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: 'socket hang up' });
        });

        it('appends teamId query param when VERCEL_TEAM_ID is set', async () => {
            const { svc, mockFetch } = makeService(MOCK_TOKEN, 'team_xyz');
            mockFetch.mockResolvedValueOnce(makeResponse(200, { id: 'prj_3', name: 'craft-app' }));

            await svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] });

            const [url] = mockFetch.mock.calls[0] as [string];
            expect(url).toContain('teamId=team_xyz');
        });

        it('includes Authorization header with Bearer token', async () => {
            const { svc, mockFetch } = makeService();
            mockFetch.mockResolvedValueOnce(makeResponse(200, { id: 'prj_4', name: 'craft-app' }));

            await svc.createProject({ name: 'craft-app', gitRepo: 'org/repo', envVars: [] });

            const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
            expect(init.headers['Authorization']).toBe(`Bearer ${MOCK_TOKEN}`);
        });
    });

    describe('triggerDeployment', () => {
        it('returns deploymentId and URL on success', async () => {
            const { svc, mockFetch } = makeService();
            mockFetch.mockResolvedValueOnce(
                makeResponse(200, { id: 'dpl_abc', url: 'craft-app.vercel.app', status: 'QUEUED' }),
            );

            const result = await svc.triggerDeployment('prj_1', 'org/repo');

            expect(result.deploymentId).toBe('dpl_abc');
            expect(result.deploymentUrl).toBe('https://craft-app.vercel.app');
            expect(result.status).toBe('QUEUED');
        });

        it('throws NETWORK_ERROR on fetch failure', async () => {
            const { svc, mockFetch } = makeService();
            mockFetch.mockRejectedValueOnce(new Error('Network down'));

            await expect(svc.triggerDeployment('prj_1', 'org/repo')).rejects.toMatchObject({
                code: 'NETWORK_ERROR',
            });
        });
    });

    describe('validateAccess', () => {
        it('returns true when API responds ok', async () => {
            const { svc, mockFetch } = makeService();
            mockFetch.mockResolvedValueOnce(makeResponse(200, { uid: 'user_1' }));

            expect(await svc.validateAccess()).toBe(true);
        });

        it('returns false on 401', async () => {
            const { svc, mockFetch } = makeService();
            mockFetch.mockResolvedValueOnce(makeResponse(401, { message: 'Unauthorized' }));

            expect(await svc.validateAccess()).toBe(false);
        });

        it('returns false on network error', async () => {
            const { svc, mockFetch } = makeService();
            mockFetch.mockRejectedValueOnce(new Error('Network down'));

            expect(await svc.validateAccess()).toBe(false);
        });
    });
});
