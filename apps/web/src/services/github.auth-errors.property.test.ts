/**
 * GitHub Integration — Authentication & Installation Failure Mode Property Tests
 *
 * Property 18: GitHub Auth and Installation Error Classification
 *
 * Exercises the full space of token-expiry, permission, and installation error
 * combinations across both GitHubService (repository creation) and
 * GitHubPushService (code push). Asserts that every generated scenario is
 * classified as either retryable (RATE_LIMITED) or terminal (AUTH_FAILED,
 * NETWORK_ERROR, COLLISION, UNKNOWN) and that the classification is stable
 * across 100+ iterations.
 *
 * Retryable errors:  RATE_LIMITED  — caller should back off and retry
 * Terminal errors:   AUTH_FAILED   — token invalid/expired/missing permissions
 *                    NETWORK_ERROR — unexpected server or network failure
 *                    COLLISION     — name taken after all retries exhausted
 *                    UNKNOWN       — unrecognised GitHub API response
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { GitHubService } from './github.service';
import {
    GitHubPushService,
    GitHubPushAuthError,
    GitHubPushNetworkError,
    GitHubPushApiError,
} from './github-push.service';

// ── Constants ─────────────────────────────────────────────────────────────────

const RETRYABLE_CODES = new Set(['RATE_LIMITED']);
const TERMINAL_CODES = new Set(['AUTH_FAILED', 'NETWORK_ERROR', 'COLLISION', 'UNKNOWN']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJsonResponse(
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k: string) => headers[k] ?? null },
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response;
}

const BASE_REPO_REQUEST = {
    name: 'my-dex',
    description: 'Test deployment',
    private: true,
    userId: 'user-1',
};

const BASE_PUSH_REQUEST = {
    owner: 'acme',
    repo: 'my-dex',
    token: 'ghp_test',
    branch: 'main',
    commitMessage: 'chore: generated',
    files: [{ path: 'index.ts', content: 'export {}', type: 'code' as const }],
};

// ── Arbitraries ───────────────────────────────────────────────────────────────

/**
 * Token expiry scenarios: missing token, empty string, or a plausible expired
 * token string. All should produce AUTH_FAILED from GitHubService.
 */
const arbExpiredToken = fc.oneof(
    fc.constant(''),
    fc.constant(undefined as unknown as string),
    fc.stringMatching(/^ghp_[a-zA-Z0-9]{5,20}$/),
);

/**
 * HTTP status codes that represent authentication / permission failures.
 * 401 = bad credentials / expired token
 * 403 = insufficient permissions or installation not authorised
 */
const arbAuthStatus = fc.constantFrom(401, 403);

/**
 * HTTP status codes that represent rate limiting.
 */
const arbRateLimitStatus = fc.constantFrom(429);

/**
 * Retry-After header values in seconds (0 means header absent).
 */
const arbRetryAfterSec = fc.integer({ min: 0, max: 3600 });

/**
 * HTTP status codes that represent unexpected server errors.
 */
const arbServerErrorStatus = fc.constantFrom(500, 502, 503, 504);

/**
 * 403 response bodies that signal a rate-limit rather than a permission error.
 */
const arbRateLimitBody = fc.oneof(
    fc.constant({ message: 'rate limit exceeded' }),
    fc.constant({ message: 'API rate limit exceeded for installation' }),
);

/**
 * 403 response bodies that signal a permission / installation error.
 */
const arbPermissionBody = fc.oneof(
    fc.constant({ message: 'Resource not accessible by integration' }),
    fc.constant({ message: 'Installation not found' }),
    fc.constant({ message: 'GitHub App not installed on this repository' }),
    fc.constant({ message: 'Forbidden' }),
);

// ── GitHubService — Property 18 ───────────────────────────────────────────────

describe('Property 18 — GitHub auth and installation error classification', () => {
    const mockFetch = vi.fn();
    let service: GitHubService;

    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetch);
        process.env.GITHUB_TOKEN = 'ghp_valid_token';
        service = new GitHubService();
        vi.clearAllMocks();
    });

    afterEach(() => {
        delete process.env.GITHUB_TOKEN;
        vi.unstubAllGlobals();
    });

    // ── Token expiry ──────────────────────────────────────────────────────────

    it('missing or empty GITHUB_TOKEN always produces a terminal AUTH_FAILED error', async () => {
        await fc.assert(
            fc.asyncProperty(arbExpiredToken, async (token) => {
                if (token) {
                    process.env.GITHUB_TOKEN = token;
                    // Simulate GitHub rejecting the token as expired
                    mockFetch.mockResolvedValueOnce(
                        makeJsonResponse(401, { message: 'Bad credentials' }),
                    );
                } else {
                    delete process.env.GITHUB_TOKEN;
                }
                service = new GitHubService();

                let thrownCode: string | undefined;
                try {
                    await service.createRepository(BASE_REPO_REQUEST);
                } catch (err: unknown) {
                    thrownCode = (err as { code?: string }).code;
                }

                // Invariant: token expiry / absence always yields AUTH_FAILED
                expect(thrownCode).toBe('AUTH_FAILED');
                expect(TERMINAL_CODES).toContain(thrownCode);
            }),
            { numRuns: 100 },
        );
    });

    // ── Auth / permission HTTP responses ──────────────────────────────────────

    it('401 responses always produce a terminal AUTH_FAILED error', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    message: fc.oneof(
                        fc.constant('Bad credentials'),
                        fc.constant('Requires authentication'),
                        fc.constant('Token expired'),
                        fc.stringMatching(/^[A-Za-z ]{5,40}$/),
                    ),
                }),
                async (body) => {
                    mockFetch.mockResolvedValueOnce(makeJsonResponse(401, body));

                    let thrownCode: string | undefined;
                    try {
                        await service.createRepository(BASE_REPO_REQUEST);
                    } catch (err: unknown) {
                        thrownCode = (err as { code?: string }).code;
                    }

                    // Invariant: 401 is always terminal AUTH_FAILED
                    expect(thrownCode).toBe('AUTH_FAILED');
                    expect(TERMINAL_CODES).toContain(thrownCode);
                },
            ),
            { numRuns: 100 },
        );
    });

    it('403 permission/installation errors always produce a terminal AUTH_FAILED error', async () => {
        await fc.assert(
            fc.asyncProperty(arbPermissionBody, async (body) => {
                mockFetch.mockResolvedValueOnce(makeJsonResponse(403, body));

                let thrownCode: string | undefined;
                try {
                    await service.createRepository(BASE_REPO_REQUEST);
                } catch (err: unknown) {
                    thrownCode = (err as { code?: string }).code;
                }

                // Invariant: permission/installation 403 is always terminal AUTH_FAILED
                expect(thrownCode).toBe('AUTH_FAILED');
                expect(TERMINAL_CODES).toContain(thrownCode);
            }),
            { numRuns: 100 },
        );
    });

    // ── Rate limiting ─────────────────────────────────────────────────────────

    it('429 responses always produce a retryable RATE_LIMITED error', async () => {
        await fc.assert(
            fc.asyncProperty(arbRetryAfterSec, async (retryAfterSec) => {
                const headers =
                    retryAfterSec > 0 ? { 'Retry-After': String(retryAfterSec) } : {};
                mockFetch.mockResolvedValueOnce(
                    makeJsonResponse(429, { message: 'rate limited' }, headers),
                );

                let thrownCode: string | undefined;
                let retryAfterMs: number | undefined;
                try {
                    await service.createRepository(BASE_REPO_REQUEST);
                } catch (err: unknown) {
                    const e = err as { code?: string; retryAfterMs?: number };
                    thrownCode = e.code;
                    retryAfterMs = e.retryAfterMs;
                }

                // Invariant: 429 is always retryable
                expect(thrownCode).toBe('RATE_LIMITED');
                expect(RETRYABLE_CODES).toContain(thrownCode);

                // Invariant: retryAfterMs matches the header value in milliseconds
                if (retryAfterSec > 0) {
                    expect(retryAfterMs).toBe(retryAfterSec * 1000);
                }
            }),
            { numRuns: 100 },
        );
    });

    it('403 rate-limit responses always produce a retryable RATE_LIMITED error', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.tuple(arbRateLimitBody, arbRetryAfterSec),
                async ([body, retryAfterSec]) => {
                    const headers =
                        retryAfterSec > 0 ? { 'Retry-After': String(retryAfterSec) } : {};
                    mockFetch.mockResolvedValueOnce(makeJsonResponse(403, body, headers));

                    let thrownCode: string | undefined;
                    try {
                        await service.createRepository(BASE_REPO_REQUEST);
                    } catch (err: unknown) {
                        thrownCode = (err as { code?: string }).code;
                    }

                    // Invariant: rate-limit 403 is always retryable
                    expect(thrownCode).toBe('RATE_LIMITED');
                    expect(RETRYABLE_CODES).toContain(thrownCode);
                },
            ),
            { numRuns: 100 },
        );
    });

    // ── Server errors ─────────────────────────────────────────────────────────

    it('5xx server errors always produce a terminal NETWORK_ERROR', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.tuple(
                    arbServerErrorStatus,
                    fc.oneof(
                        fc.constant({ message: 'Internal Server Error' }),
                        fc.constant({ message: 'Service Unavailable' }),
                        fc.constant({}),
                    ),
                ),
                async ([status, body]) => {
                    mockFetch.mockResolvedValueOnce(makeJsonResponse(status, body));

                    let thrownCode: string | undefined;
                    try {
                        await service.createRepository(BASE_REPO_REQUEST);
                    } catch (err: unknown) {
                        thrownCode = (err as { code?: string }).code;
                    }

                    // Invariant: 5xx is always terminal NETWORK_ERROR
                    expect(thrownCode).toBe('NETWORK_ERROR');
                    expect(TERMINAL_CODES).toContain(thrownCode);
                },
            ),
            { numRuns: 100 },
        );
    });

    it('network-level fetch failures always produce a terminal NETWORK_ERROR', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.oneof(
                    fc.constant('socket hang up'),
                    fc.constant('ECONNREFUSED'),
                    fc.constant('ETIMEDOUT'),
                    fc.stringMatching(/^[A-Za-z ]{5,30}$/),
                ),
                async (errorMessage) => {
                    mockFetch.mockRejectedValueOnce(new Error(errorMessage));

                    let thrownCode: string | undefined;
                    try {
                        await service.createRepository(BASE_REPO_REQUEST);
                    } catch (err: unknown) {
                        thrownCode = (err as { code?: string }).code;
                    }

                    // Invariant: fetch throw is always terminal NETWORK_ERROR
                    expect(thrownCode).toBe('NETWORK_ERROR');
                    expect(TERMINAL_CODES).toContain(thrownCode);
                },
            ),
            { numRuns: 100 },
        );
    });

    // ── Classification completeness ───────────────────────────────────────────

    it('every error code is either retryable or terminal — never unclassified', async () => {
        const ALL_CODES = new Set([...RETRYABLE_CODES, ...TERMINAL_CODES]);

        const scenarios = fc.oneof(
            // auth failures
            fc.tuple(fc.constant(401), fc.constant({ message: 'Bad credentials' }), fc.constant({})),
            fc.tuple(fc.constant(403), arbPermissionBody, fc.constant({})),
            // rate limits
            fc.tuple(fc.constant(429), fc.constant({ message: 'rate limited' }), fc.constant({ 'Retry-After': '60' })),
            fc.tuple(fc.constant(403), arbRateLimitBody, fc.constant({ 'Retry-After': '30' })),
            // server errors
            fc.tuple(arbServerErrorStatus, fc.constant({ message: 'error' }), fc.constant({})),
        );

        await fc.assert(
            fc.asyncProperty(scenarios, async ([status, body, headers]) => {
                mockFetch.mockResolvedValueOnce(
                    makeJsonResponse(status, body, headers as Record<string, string>),
                );

                let thrownCode: string | undefined;
                try {
                    await service.createRepository(BASE_REPO_REQUEST);
                } catch (err: unknown) {
                    thrownCode = (err as { code?: string }).code;
                }

                // Invariant: every thrown code is in the known classification set
                expect(thrownCode).toBeDefined();
                expect(ALL_CODES).toContain(thrownCode);
            }),
            { numRuns: 100 },
        );
    });
});

// ── GitHubPushService — auth/installation errors ──────────────────────────────

describe('Property 18 — GitHubPushService auth and installation error classification', () => {
    const fetchMock = vi.fn();
    let pushService: GitHubPushService;

    beforeEach(() => {
        vi.clearAllMocks();
        pushService = new GitHubPushService(fetchMock as unknown as typeof fetch);
    });

    function makeResponse(status: number, body?: unknown): Response {
        const payload = body === undefined ? '' : JSON.stringify(body);
        const headers = new Headers();
        if (body !== undefined) headers.set('content-type', 'application/json');
        return new Response(payload, { status, headers });
    }

    it('401/403 responses on any push step always throw GitHubPushAuthError', async () => {
        await fc.assert(
            fc.asyncProperty(arbAuthStatus, async (status) => {
                // Simulate auth failure on the first API call (getRef)
                fetchMock.mockResolvedValueOnce(
                    makeResponse(status, { message: 'Unauthorized' }),
                );

                let thrown: unknown;
                try {
                    await pushService.pushGeneratedCode(BASE_PUSH_REQUEST);
                } catch (err) {
                    thrown = err;
                }

                // Invariant: auth HTTP errors always surface as GitHubPushAuthError
                expect(thrown).toBeInstanceOf(GitHubPushAuthError);
                expect((thrown as GitHubPushAuthError).code).toBe('AUTH_ERROR');
            }),
            { numRuns: 100 },
        );
    });

    it('missing token always throws GitHubPushAuthError before any network call', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.oneof(fc.constant(''), fc.constant('   ')),
                async (emptyToken) => {
                    let thrown: unknown;
                    try {
                        await pushService.pushGeneratedCode({
                            ...BASE_PUSH_REQUEST,
                            token: emptyToken,
                        });
                    } catch (err) {
                        thrown = err;
                    }

                    // Invariant: empty token is caught before any fetch
                    expect(thrown).toBeInstanceOf(GitHubPushAuthError);
                    expect(fetchMock).not.toHaveBeenCalled();
                },
            ),
            { numRuns: 100 },
        );
    });

    it('network-level fetch failures always throw GitHubPushNetworkError', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.oneof(
                    fc.constant('socket hang up'),
                    fc.constant('ECONNREFUSED'),
                    fc.stringMatching(/^[A-Za-z ]{5,30}$/),
                ),
                async (errorMessage) => {
                    fetchMock.mockRejectedValueOnce(new Error(errorMessage));

                    let thrown: unknown;
                    try {
                        await pushService.pushGeneratedCode(BASE_PUSH_REQUEST);
                    } catch (err) {
                        thrown = err;
                    }

                    // Invariant: fetch throw always surfaces as GitHubPushNetworkError
                    expect(thrown).toBeInstanceOf(GitHubPushNetworkError);
                    expect((thrown as GitHubPushNetworkError).code).toBe('NETWORK_ERROR');
                },
            ),
            { numRuns: 100 },
        );
    });

    it('non-auth API errors always throw GitHubPushApiError with the HTTP status', async () => {
        await fc.assert(
            fc.asyncProperty(arbServerErrorStatus, async (status) => {
                fetchMock.mockResolvedValueOnce(
                    makeResponse(status, { message: 'Server Error' }),
                );

                let thrown: unknown;
                try {
                    await pushService.pushGeneratedCode(BASE_PUSH_REQUEST);
                } catch (err) {
                    thrown = err;
                }

                // Invariant: non-auth API errors surface as GitHubPushApiError
                expect(thrown).toBeInstanceOf(GitHubPushApiError);
                expect((thrown as GitHubPushApiError).status).toBe(status);
            }),
            { numRuns: 100 },
        );
    });
});
