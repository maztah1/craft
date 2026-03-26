/**
 * Tests for GET /api/auth/github/callback
 *
 * Covers:
 *   - missing code → redirect error missing_code
 *   - state mismatch (no cookie) → redirect error state_mismatch
 *   - state mismatch (wrong value) → redirect error state_mismatch
 *   - GitHub token exchange failure → redirect error token_exchange
 *   - GitHub token exchange network error → redirect error token_exchange
 *   - GitHub user fetch non-ok → redirect error user_fetch
 *   - GitHub user fetch missing login → redirect error user_fetch
 *   - no active Craft session → redirect error unauthenticated
 *   - Supabase profile update failure → redirect error db_error
 *   - success → redirect /app?github=connected, state cookie cleared
 *   - installation_id present → still succeeds (ignored gracefully)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── token-encryption mock ─────────────────────────────────────────────────────
vi.mock('@/lib/github/token-encryption', () => ({
    encryptToken: (t: string) => `encrypted:${t}`,
}));

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: () => ({ update: mockUpdate }),
    }),
}));

mockUpdate.mockReturnValue({ eq: mockEq });

// ── fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_STATE = 'abc123';
const VALID_CODE = 'gh_code_xyz';
const ACCESS_TOKEN = 'ghu_test_token';
const GITHUB_LOGIN = 'octocat';

function makeRequest(params: Record<string, string>, stateCookie?: string): NextRequest {
    const url = new URL('http://localhost/api/auth/github/callback');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const headers = new Headers();
    if (stateCookie !== undefined) {
        headers.set('cookie', `github_oauth_state=${stateCookie}`);
    }

    return new NextRequest(url.toString(), { headers });
}

function tokenResponse(body: unknown, ok = true) {
    return { ok, status: ok ? 200 : 400, json: async () => body };
}

function userResponse(body: unknown, ok = true) {
    return { ok, status: ok ? 200 : 401, json: async () => body };
}

function setupHappyPath() {
    mockFetch
        .mockResolvedValueOnce(tokenResponse({ access_token: ACCESS_TOKEN }))
        .mockResolvedValueOnce(userResponse({ login: GITHUB_LOGIN }));
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockEq.mockResolvedValue({ error: null });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/auth/github/callback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUpdate.mockReturnValue({ eq: mockEq });
    });

    it('redirects with missing_code when code param is absent', async () => {
        const { GET } = await import('./route');
        const res = await GET(makeRequest({ state: VALID_STATE }, VALID_STATE));
        expect(res.status).toBe(307);
        expect(res.headers.get('location')).toContain('reason=missing_code');
    });

    it('redirects with state_mismatch when state cookie is absent', async () => {
        const { GET } = await import('./route');
        const res = await GET(makeRequest({ code: VALID_CODE, state: VALID_STATE }));
        expect(res.status).toBe(307);
        expect(res.headers.get('location')).toContain('reason=state_mismatch');
    });

    it('redirects with state_mismatch when state cookie does not match param', async () => {
        const { GET } = await import('./route');
        const res = await GET(makeRequest({ code: VALID_CODE, state: VALID_STATE }, 'wrong'));
        expect(res.status).toBe(307);
        expect(res.headers.get('location')).toContain('reason=state_mismatch');
    });

    it('redirects with token_exchange when GitHub returns no access_token', async () => {
        mockFetch.mockResolvedValueOnce(tokenResponse({ error: 'bad_verification_code' }));
        const { GET } = await import('./route');
        const res = await GET(makeRequest({ code: VALID_CODE, state: VALID_STATE }, VALID_STATE));
        expect(res.headers.get('location')).toContain('reason=token_exchange');
    });

    it('redirects with token_exchange when fetch throws a network error', async () => {
        mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        const { GET } = await import('./route');
        const res = await GET(makeRequest({ code: VALID_CODE, state: VALID_STATE }, VALID_STATE));
        expect(res.headers.get('location')).toContain('reason=token_exchange');
    });

    it('redirects with user_fetch when GitHub user endpoint returns non-ok', async () => {
        mockFetch
            .mockResolvedValueOnce(tokenResponse({ access_token: ACCESS_TOKEN }))
            .mockResolvedValueOnce(userResponse({}, false));
        const { GET } = await import('./route');
        const res = await GET(makeRequest({ code: VALID_CODE, state: VALID_STATE }, VALID_STATE));
        expect(res.headers.get('location')).toContain('reason=user_fetch');
    });

    it('redirects with user_fetch when GitHub user response has no login', async () => {
        mockFetch
            .mockResolvedValueOnce(tokenResponse({ access_token: ACCESS_TOKEN }))
            .mockResolvedValueOnce(userResponse({ id: 1 }));
        const { GET } = await import('./route');
        const res = await GET(makeRequest({ code: VALID_CODE, state: VALID_STATE }, VALID_STATE));
        expect(res.headers.get('location')).toContain('reason=user_fetch');
    });

    it('redirects with unauthenticated when there is no active Craft session', async () => {
        mockFetch
            .mockResolvedValueOnce(tokenResponse({ access_token: ACCESS_TOKEN }))
            .mockResolvedValueOnce(userResponse({ login: GITHUB_LOGIN }));
        mockGetUser.mockResolvedValue({ data: { user: null } });
        const { GET } = await import('./route');
        const res = await GET(makeRequest({ code: VALID_CODE, state: VALID_STATE }, VALID_STATE));
        expect(res.headers.get('location')).toContain('reason=unauthenticated');
    });

    it('redirects with db_error when the profile update fails', async () => {
        mockFetch
            .mockResolvedValueOnce(tokenResponse({ access_token: ACCESS_TOKEN }))
            .mockResolvedValueOnce(userResponse({ login: GITHUB_LOGIN }));
        mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
        mockEq.mockResolvedValue({ error: { message: 'db failure' } });
        const { GET } = await import('./route');
        const res = await GET(makeRequest({ code: VALID_CODE, state: VALID_STATE }, VALID_STATE));
        expect(res.headers.get('location')).toContain('reason=db_error');
    });

    it('redirects to /app?github=connected on success and clears the state cookie', async () => {
        setupHappyPath();
        const { GET } = await import('./route');
        const res = await GET(makeRequest({ code: VALID_CODE, state: VALID_STATE }, VALID_STATE));

        expect(res.status).toBe(307);
        expect(res.headers.get('location')).toBe('http://localhost/app?github=connected');

        // State cookie must be cleared
        const setCookie = res.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain('github_oauth_state=');
        expect(setCookie).toContain('Max-Age=0');
    });

    it('persists github_connected, github_username, and token on the profile', async () => {
        setupHappyPath();
        const { GET } = await import('./route');
        await GET(makeRequest({ code: VALID_CODE, state: VALID_STATE }, VALID_STATE));

        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                github_connected: true,
                github_username: GITHUB_LOGIN,
                github_token_encrypted: `encrypted:${ACCESS_TOKEN}`,
            }),
        );
        expect(mockEq).toHaveBeenCalledWith('id', 'user-1');
    });

    it('succeeds when installation_id is also present in the callback URL', async () => {
        setupHappyPath();
        const { GET } = await import('./route');
        const res = await GET(
            makeRequest(
                { code: VALID_CODE, state: VALID_STATE, installation_id: '12345', setup_action: 'install' },
                VALID_STATE,
            ),
        );
        expect(res.headers.get('location')).toBe('http://localhost/app?github=connected');
    });
});
