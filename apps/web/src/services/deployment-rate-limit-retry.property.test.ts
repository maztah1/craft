/**
 * Property 39 — Rate Limit Errors Queue Deployments for Automatic Retry
 *
 * REQUIREMENT:
 * When any API provider (GitHub or Vercel) returns a rate-limit error during
 * the deployment pipeline, the deployment MUST be queued for automatic retry
 * rather than permanently failed, and the user MUST be notified.
 *
 * INVARIANTS UNDER TEST:
 *   39.1 — Rate-limited deployments are queued (status = 'queued'), not failed
 *   39.2 — Non-rate-limit errors are NOT queued (status = 'failed')
 *   39.3 — Queued deployments carry a retryAfterMs value ≥ 0
 *   39.4 — User notification is emitted for every queued deployment
 *   39.5 — retryAfterMs is derived from the provider's Retry-After header
 *   39.6 — State isolation: rate-limit on one deployment does not affect others
 *
 * PROVIDERS COVERED:
 *   - GitHub (repository creation — RATE_LIMITED code, 429 / 403 + rate-limit body)
 *   - Vercel  (project creation / deployment trigger — RATE_LIMITED code)
 *
 * TEST STRATEGY:
 *   Contract test against a MockDeploymentQueue that models the expected
 *   behaviour. fast-check generates rate-limit scenarios across providers,
 *   stages, and Retry-After values. Runs ≥ 100 iterations per property.
 *
 * Feature: craft-platform
 * Design spec: .craft/specs/craft-platform/design.md
 * Property: 39
 * Issue: #130
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ── Type Definitions ──────────────────────────────────────────────────────────

type ApiProvider = 'github' | 'vercel';

type PipelineStage =
    | 'creating_repo'
    | 'pushing_code'
    | 'deploying';

type DeploymentQueueStatus = 'queued' | 'failed' | 'completed';

interface RateLimitError {
    code: 'RATE_LIMITED';
    provider: ApiProvider;
    retryAfterMs: number;
}

interface TerminalError {
    code: 'AUTH_FAILED' | 'NETWORK_ERROR' | 'COLLISION' | 'UNKNOWN';
    provider: ApiProvider;
}

type PipelineError = RateLimitError | TerminalError;

interface QueuedDeployment {
    deploymentId: string;
    status: DeploymentQueueStatus;
    retryAfterMs?: number;
    failedStage?: PipelineStage;
    errorCode?: string;
    notificationSent: boolean;
}

interface RetryQueueResult {
    queued: boolean;
    deployment: QueuedDeployment;
}

// ── Contract Interface ────────────────────────────────────────────────────────

/**
 * Contract that any deployment retry-queue implementation must satisfy.
 */
interface DeploymentRetryQueueContract {
    handlePipelineError(
        deploymentId: string,
        stage: PipelineStage,
        error: PipelineError,
    ): Promise<RetryQueueResult>;

    getDeployment(deploymentId: string): QueuedDeployment | undefined;
}

// ── Mock Implementation ───────────────────────────────────────────────────────

class MockDeploymentRetryQueue implements DeploymentRetryQueueContract {
    private readonly _store = new Map<string, QueuedDeployment>();
    private readonly _notifications: string[] = [];

    async handlePipelineError(
        deploymentId: string,
        stage: PipelineStage,
        error: PipelineError,
    ): Promise<RetryQueueResult> {
        const isRateLimit = error.code === 'RATE_LIMITED';

        const deployment: QueuedDeployment = {
            deploymentId,
            failedStage: stage,
            errorCode: error.code,
            notificationSent: false,
            // Rate-limited → queue; anything else → fail permanently
            status: isRateLimit ? 'queued' : 'failed',
            retryAfterMs: isRateLimit ? (error as RateLimitError).retryAfterMs : undefined,
        };

        if (isRateLimit) {
            // Notify user that the deployment is queued for retry
            this._notifications.push(deploymentId);
            deployment.notificationSent = true;
        }

        this._store.set(deploymentId, deployment);

        return { queued: isRateLimit, deployment };
    }

    getDeployment(deploymentId: string): QueuedDeployment | undefined {
        return this._store.get(deploymentId);
    }

    getNotifications(): string[] {
        return [...this._notifications];
    }
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbProvider = fc.constantFrom<ApiProvider>('github', 'vercel');

const arbStage = fc.constantFrom<PipelineStage>(
    'creating_repo',
    'pushing_code',
    'deploying',
);

/** Retry-After values in milliseconds (0 = header absent, up to 1 hour). */
const arbRetryAfterMs = fc.integer({ min: 0, max: 3_600_000 });

const arbRateLimitError: fc.Arbitrary<RateLimitError> = fc.record({
    code: fc.constant('RATE_LIMITED' as const),
    provider: arbProvider,
    retryAfterMs: arbRetryAfterMs,
});

const arbTerminalError: fc.Arbitrary<TerminalError> = fc.record({
    code: fc.constantFrom<TerminalError['code']>(
        'AUTH_FAILED',
        'NETWORK_ERROR',
        'COLLISION',
        'UNKNOWN',
    ),
    provider: arbProvider,
});

const arbPipelineError: fc.Arbitrary<PipelineError> = fc.oneof(
    arbRateLimitError,
    arbTerminalError,
);

// ── Property Tests ────────────────────────────────────────────────────────────

describe('Property 39 — Rate Limit Errors Queue Deployments for Automatic Retry', () => {
    let queue: MockDeploymentRetryQueue;

    beforeEach(() => {
        queue = new MockDeploymentRetryQueue();
    });

    /**
     * Property 39.1 — Rate-limited deployments are queued, not failed.
     *
     * For any provider and any pipeline stage, a RATE_LIMITED error MUST
     * result in status = 'queued', never 'failed'.
     */
    it('39.1 — rate-limited deployments are always queued, never failed', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                arbStage,
                arbRateLimitError,
                async (deploymentId, stage, error) => {
                    const result = await queue.handlePipelineError(deploymentId, stage, error);

                    expect(result.queued).toBe(true);
                    expect(result.deployment.status).toBe('queued');
                    expect(result.deployment.status).not.toBe('failed');
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property 39.2 — Non-rate-limit errors are permanently failed, not queued.
     *
     * AUTH_FAILED, NETWORK_ERROR, COLLISION, and UNKNOWN errors MUST NOT
     * be queued for retry — they are terminal.
     */
    it('39.2 — terminal errors are always failed, never queued', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                arbStage,
                arbTerminalError,
                async (deploymentId, stage, error) => {
                    const result = await queue.handlePipelineError(deploymentId, stage, error);

                    expect(result.queued).toBe(false);
                    expect(result.deployment.status).toBe('failed');
                    expect(result.deployment.status).not.toBe('queued');
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property 39.3 — Queued deployments carry a non-negative retryAfterMs.
     *
     * Every queued deployment MUST expose a retryAfterMs ≥ 0 so the scheduler
     * knows when to retry.
     */
    it('39.3 — queued deployments always carry a non-negative retryAfterMs', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                arbStage,
                arbRateLimitError,
                async (deploymentId, stage, error) => {
                    const result = await queue.handlePipelineError(deploymentId, stage, error);

                    expect(result.deployment.retryAfterMs).toBeDefined();
                    expect(result.deployment.retryAfterMs!).toBeGreaterThanOrEqual(0);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property 39.4 — User notification is emitted for every queued deployment.
     *
     * Whenever a deployment is queued, notificationSent MUST be true.
     * Terminal failures MUST NOT trigger a retry notification.
     */
    it('39.4 — notification is sent iff the deployment is queued', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                arbStage,
                arbPipelineError,
                async (deploymentId, stage, error) => {
                    const result = await queue.handlePipelineError(deploymentId, stage, error);

                    if (result.queued) {
                        expect(result.deployment.notificationSent).toBe(true);
                    } else {
                        expect(result.deployment.notificationSent).toBe(false);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property 39.5 — retryAfterMs is derived from the provider's Retry-After value.
     *
     * The queued deployment's retryAfterMs MUST equal the value carried in the
     * rate-limit error (which is parsed from the provider's Retry-After header).
     */
    it('39.5 — retryAfterMs matches the value from the provider error', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                arbStage,
                arbRateLimitError,
                async (deploymentId, stage, error) => {
                    const result = await queue.handlePipelineError(deploymentId, stage, error);

                    expect(result.deployment.retryAfterMs).toBe(error.retryAfterMs);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property 39.6 — State isolation between deployments.
     *
     * A rate-limit error on deployment A MUST NOT affect the state of
     * deployment B.
     */
    it('39.6 — rate-limit on one deployment does not affect others', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                fc.uuid(),
                arbStage,
                arbRateLimitError,
                arbPipelineError,
                async (idA, idB, stage, rateLimitError, otherError) => {
                    fc.pre(idA !== idB);

                    // Handle error for A
                    await queue.handlePipelineError(idA, stage, rateLimitError);

                    // Handle a separate error for B
                    await queue.handlePipelineError(idB, stage, otherError);

                    const stateA = queue.getDeployment(idA);
                    const stateB = queue.getDeployment(idB);

                    // A must be queued
                    expect(stateA?.status).toBe('queued');

                    // B's state must reflect its own error, not A's
                    const expectedStatusB =
                        otherError.code === 'RATE_LIMITED' ? 'queued' : 'failed';
                    expect(stateB?.status).toBe(expectedStatusB);
                },
            ),
            { numRuns: 100 },
        );
    });
});
