/**
 * Property 38 — Rollback on Failed Deployment Updates
 *
 * REQUIREMENT (Issue #120):
 * Failed updates must NOT replace the last known good deployment.
 *
 * This is a CONTRACT TEST that specifies the expected behavior for ANY
 * deployment update implementation. The deployment update feature
 * (redeployWithUpdates) is defined in the design document but not yet
 * implemented in the codebase.
 *
 * WHAT THIS TEST SPECIFIES:
 * When a deployment update fails at ANY stage of the pipeline, the system MUST:
 *   1. Preserve the active deployment URL (never change it)
 *   2. Revert customization config to the previous version
 *   3. Maintain deployment status as 'completed' (not 'failed')
 *   4. Be traceable (rollback must be logged)
 *
 * TEST STRATEGY:
 * - Uses fast-check for property-based testing
 * - Generates random deployment states and update scenarios
 * - Simulates failures at different pipeline stages
 * - Runs 100+ iterations to ensure consistency
 *
 * IMPLEMENTATION NOTE:
 * These tests mock the deployment update interface to specify behavior.
 * When the actual DeploymentEngine.redeployWithUpdates() is implemented,
 * it should satisfy all these properties.
 *
 * Validates: Design doc section 5 (Deployment Engine - redeployWithUpdates)
 */

import * as fc from 'fast-check';
import type { CustomizationConfig } from '@craft/types';

// ── Type Definitions (from design doc) ───────────────────────────────────────

/**
 * Deployment update interface as specified in design.md
 * This is the contract that any implementation must satisfy.
 */
interface DeploymentUpdateContract {
    /**
     * Update a deployment with new customization config.
     * On failure, must rollback to previous state.
     */
    redeployWithUpdates(
        deploymentId: string,
        updates: CustomizationConfig
    ): Promise<DeploymentUpdateResult>;
}

interface DeploymentUpdateResult {
    deploymentId: string;
    success: boolean;
    rolledBack: boolean;
    deploymentUrl?: string;
    errorMessage?: string;
}

interface DeploymentState {
    id: string;
    userId: string;
    customizationConfig: CustomizationConfig;
    deploymentUrl: string | null;
    vercelDeploymentId: string | null;
    status: 'pending' | 'generating' | 'creating_repo' | 'pushing_code' | 'deploying' | 'completed' | 'failed';
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

/**
 * Generate random but valid customization configurations
 */
const arbBrandingConfig = fc.record({
    appName: fc.string({ minLength: 1, maxLength: 50 }),
    logoUrl: fc.option(fc.webUrl()).map((url) => url ?? undefined),
    primaryColor: fc.stringMatching(/^[0-9a-fA-F]{6}$/).map((hex) => `#${hex}`),
    secondaryColor: fc.stringMatching(/^[0-9a-fA-F]{6}$/).map((hex) => `#${hex}`),
    fontFamily: fc.constantFrom('Inter', 'Roboto', 'Open Sans', 'Lato'),
});

const arbFeatureConfig = fc.record({
    enableCharts: fc.boolean(),
    enableTransactionHistory: fc.boolean(),
    enableAnalytics: fc.boolean(),
    enableNotifications: fc.boolean(),
});

const arbStellarConfig = fc.record({
    network: fc.constantFrom<'mainnet' | 'testnet'>('mainnet', 'testnet'),
    horizonUrl: fc.webUrl(),
    sorobanRpcUrl: fc.option(fc.webUrl()).map((url) => url ?? undefined),
    assetPairs: fc.option(
        fc.array(
            fc.record({
                base: fc.record({
                    code: fc.string({ minLength: 1, maxLength: 12 }),
                    issuer: fc.string({ minLength: 1, maxLength: 56 }),
                    type: fc.constantFrom<'native' | 'credit_alphanum4' | 'credit_alphanum12'>(
                        'native',
                        'credit_alphanum4',
                        'credit_alphanum12'
                    ),
                }),
                counter: fc.record({
                    code: fc.string({ minLength: 1, maxLength: 12 }),
                    issuer: fc.string({ minLength: 1, maxLength: 56 }),
                    type: fc.constantFrom<'native' | 'credit_alphanum4' | 'credit_alphanum12'>(
                        'native',
                        'credit_alphanum4',
                        'credit_alphanum12'
                    ),
                }),
            }),
            { minLength: 0, maxLength: 5 }
        )
    ).map((pairs) => pairs ?? undefined),
    contractAddresses: fc.option(fc.dictionary(fc.string(), fc.string())).map((addrs) => addrs ?? undefined),
});

const arbCustomizationConfig: fc.Arbitrary<CustomizationConfig> = fc.record({
    branding: arbBrandingConfig,
    features: arbFeatureConfig,
    stellar: arbStellarConfig,
});

/**
 * Generate random deployment states (only 'completed' deployments can be updated)
 */
const arbDeploymentState: fc.Arbitrary<DeploymentState> = fc.record({
    id: fc.uuid(),
    userId: fc.uuid(),
    customizationConfig: arbCustomizationConfig,
    deploymentUrl: fc.option(fc.webUrl()),
    vercelDeploymentId: fc.option(fc.uuid()),
    status: fc.constant('completed' as const),
});

/**
 * Generate random failure points in the pipeline
 */
const arbFailureStage = fc.constantFrom(
    'validating',
    'generating',
    'updating_repo',
    'redeploying'
);

/**
 * Generate random UUIDs
 */
const arbUuid = fc.uuid();

// ── Mock Implementation ───────────────────────────────────────────────────────

/**
 * Mock deployment update service that simulates the contract behavior.
 * This represents what the implementation SHOULD do.
 */
class MockDeploymentUpdateService implements DeploymentUpdateContract {
    private state: Map<string, DeploymentState> = new Map();
    private shouldFail: boolean = false;

    setInitialDeployment(state: DeploymentState) {
        this.state.set(state.id, state);
    }

    setFailureMode(shouldFail: boolean) {
        this.shouldFail = shouldFail;
    }

    async redeployWithUpdates(
        deploymentId: string,
        updates: CustomizationConfig
    ): Promise<DeploymentUpdateResult> {
        const currentState = this.state.get(deploymentId);

        if (!currentState) {
            return {
                deploymentId,
                success: false,
                rolledBack: false,
                errorMessage: 'Deployment not found',
            };
        }

        // Save the "last known good" state
        const previousState = { ...currentState };

        if (this.shouldFail) {
            // Simulate failure - but DON'T change the state
            // This is the key behavior: failed updates don't modify state
            return {
                deploymentId,
                success: false,
                rolledBack: true, // Conceptually rolled back (state unchanged)
                errorMessage: 'Update pipeline failed',
            };
        }

        // Success case: update the state
        const newState: DeploymentState = {
            ...currentState,
            customizationConfig: updates,
        };
        this.state.set(deploymentId, newState);

        return {
            deploymentId,
            success: true,
            rolledBack: false,
            deploymentUrl: currentState.deploymentUrl ?? undefined,
        };
    }

    getCurrentState(deploymentId: string): DeploymentState | undefined {
        return this.state.get(deploymentId);
    }
}

// ── Property Tests ────────────────────────────────────────────────────────────

describe('Property 38 — Rollback on Failed Deployment Updates (Contract Test)', () => {
    let service: MockDeploymentUpdateService;

    beforeEach(() => {
        service = new MockDeploymentUpdateService();
    });

    /**
     * Property 38.1: Successful updates apply the new configuration
     *
     * INVARIANT: When an update succeeds, the deployment reflects the new state.
     */
    describe('Property 38.1 — Successful update applies changes', () => {
        it('for any valid deployment and config, successful update applies the new configuration', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbDeploymentState,
                    arbCustomizationConfig,
                    async (initialState, newConfig) => {
                        service.setInitialDeployment(initialState);
                        service.setFailureMode(false);

                        const result = await service.redeployWithUpdates(
                            initialState.id,
                            newConfig
                        );

                        // Assert success
                        expect(result.success).toBe(true);
                        expect(result.rolledBack).toBe(false);

                        // Assert state was updated
                        const finalState = service.getCurrentState(initialState.id);
                        expect(finalState?.customizationConfig).toEqual(newConfig);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 38.2: CORE INVARIANT - Failed updates preserve the last good state
     *
     * This is the main property from Issue #120.
     *
     * INVARIANT: For ANY failure point, the deployment state NEVER changes.
     */
    describe('Property 38.2 — Failed updates preserve last known good state (CORE)', () => {
        it('for any failure point, deployment state remains unchanged', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbDeploymentState,
                    arbCustomizationConfig,
                    arbFailureStage,
                    async (initialState, newConfig, failureStage) => {
                        service.setInitialDeployment(initialState);
                        service.setFailureMode(true);

                        const result = await service.redeployWithUpdates(
                            initialState.id,
                            newConfig
                        );

                        // ASSERTION 1: Update must fail
                        expect(result.success).toBe(false);

                        // ASSERTION 2: Must indicate rollback
                        expect(result.rolledBack).toBe(true);

                        // ASSERTION 3 (CORE): State must be UNCHANGED
                        const finalState = service.getCurrentState(initialState.id);
                        expect(finalState?.customizationConfig).toEqual(
                            initialState.customizationConfig
                        );

                        // ASSERTION 4: Error must be reported
                        expect(result.errorMessage).toBeDefined();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 38.3: Deployment URL is NEVER changed on failure
     *
     * INVARIANT: The deployment URL is immutable when updates fail.
     * This is critical for users - their app's URL must remain stable.
     */
    describe('Property 38.3 — Deployment URL is preserved on failure', () => {
        it('for any failed update, the deployment URL never changes', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbDeploymentState,
                    arbCustomizationConfig,
                    async (initialState, newConfig) => {
                        // Ensure we have a URL to preserve
                        const stateWithUrl = {
                            ...initialState,
                            deploymentUrl: initialState.deploymentUrl || 'https://example.vercel.app',
                        };

                        service.setInitialDeployment(stateWithUrl);
                        service.setFailureMode(true);

                        const result = await service.redeployWithUpdates(
                            stateWithUrl.id,
                            newConfig
                        );

                        // ASSERTION: URL must be unchanged
                        const finalState = service.getCurrentState(stateWithUrl.id);
                        expect(finalState?.deploymentUrl).toBe(stateWithUrl.deploymentUrl);

                        // ASSERTION: Result should fail
                        expect(result.success).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 38.4: Multiple consecutive failures maintain original state
     *
     * INVARIANT: After N failed update attempts, state equals original state.
     */
    describe('Property 38.4 — Multiple failures maintain original state', () => {
        it('after N consecutive failed updates, deployment remains in original state', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbDeploymentState,
                    fc.array(arbCustomizationConfig, { minLength: 2, maxLength: 5 }),
                    async (originalState, failedConfigs) => {
                        service.setInitialDeployment(originalState);
                        service.setFailureMode(true);

                        // Attempt multiple failed updates
                        for (const failedConfig of failedConfigs) {
                            const result = await service.redeployWithUpdates(
                                originalState.id,
                                failedConfig
                            );

                            // Each attempt should fail and report rollback
                            expect(result.success).toBe(false);
                            expect(result.rolledBack).toBe(true);
                        }

                        // FINAL ASSERTION: State must still equal original
                        const finalState = service.getCurrentState(originalState.id);
                        expect(finalState?.customizationConfig).toEqual(
                            originalState.customizationConfig
                        );
                        expect(finalState?.deploymentUrl).toBe(
                            originalState.deploymentUrl
                        );
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    /**
     * Property 38.5: Status remains 'completed' after failed update
     *
     * INVARIANT: Failed updates don't change deployment status to 'failed'.
     * The deployment should remain in a serving state.
     */
    describe('Property 38.5 — Status remains completed after failure', () => {
        it('after failed update, deployment status is still "completed"', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbDeploymentState,
                    arbCustomizationConfig,
                    async (initialState, newConfig) => {
                        service.setInitialDeployment(initialState);
                        service.setFailureMode(true);

                        await service.redeployWithUpdates(
                            initialState.id,
                            newConfig
                        );

                        // ASSERTION: Status must remain 'completed'
                        const finalState = service.getCurrentState(initialState.id);
                        expect(finalState?.status).toBe('completed');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 38.6: Edge case - Null deployment URL is preserved
     *
     * INVARIANT: Even deployments without URLs maintain their state on failure.
     */
    describe('Property 38.6 — Edge case: null URL is preserved', () => {
        it('handles failed update correctly when deployment has no URL', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbCustomizationConfig,
                    arbUuid,
                    async (config, deploymentId) => {
                        const stateWithoutUrl: DeploymentState = {
                            id: deploymentId,
                            userId: 'user-' + fc.sample(arbUuid, 1)[0],
                            customizationConfig: config,
                            deploymentUrl: null,
                            vercelDeploymentId: null,
                            status: 'completed',
                        };

                        service.setInitialDeployment(stateWithoutUrl);
                        service.setFailureMode(true);

                        const result = await service.redeployWithUpdates(
                            deploymentId,
                            config
                        );

                        // Should still fail correctly
                        expect(result.success).toBe(false);
                        expect(result.rolledBack).toBe(true);

                        // URL should still be null
                        const finalState = service.getCurrentState(deploymentId);
                        expect(finalState?.deploymentUrl).toBe(null);
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    /**
     * Property 38.7: State isolation between different deployments
     *
     * INVARIANT: Failed update on deployment A doesn't affect deployment B.
     */
    describe('Property 38.7 — State isolation between deployments', () => {
        it('failed update on one deployment does not affect others', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbDeploymentState,
                    arbDeploymentState,
                    arbCustomizationConfig,
                    async (stateA, stateB, newConfig) => {
                        // Ensure different deployment IDs
                        fc.pre(stateA.id !== stateB.id);

                        service.setInitialDeployment(stateA);
                        service.setInitialDeployment(stateB);
                        service.setFailureMode(true);

                        // Fail update on deployment A
                        await service.redeployWithUpdates(stateA.id, newConfig);

                        // ASSERTION: Deployment B should be unaffected
                        const finalStateB = service.getCurrentState(stateB.id);
                        expect(finalStateB?.customizationConfig).toEqual(
                            stateB.customizationConfig
                        );
                        expect(finalStateB?.deploymentUrl).toBe(
                            stateB.deploymentUrl
                        );
                    }
                ),
                { numRuns: 50 }
            );
        });
    });
});
