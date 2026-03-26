/**
 * Property 35 — Repository Reuse on Deployment Update
 *
 * REQUIREMENT (Issue #117):
 * Updates must target the original repository when eligible.
 *
 * This is a CONTRACT TEST that specifies the expected behavior for repository
 * binding during deployment updates. When a deployment has an existing repository
 * binding that is still valid/eligible, updates should reuse that repository rather
 * than creating a new one.
 *
 * WHAT THIS TEST SPECIFIES:
 * When a deployment update is performed, the system MUST:
 *   1. Preserve the original repository URL when binding is valid/eligible
 *   2. NOT create a replacement repository for valid updates
 *   3. Handle invalid bindings appropriately (allow update but flag the issue)
 *   4. Maintain repository binding consistency across multiple updates
 *
 * TEST STRATEGY:
 * - Uses fast-check for property-based testing
 * - Generates random deployment states with various repository bindings
 * - Tests both valid and invalid repository binding scenarios
 * - Runs 100+ iterations to ensure consistency
 *
 * IMPLEMENTATION NOTE:
 * These tests mock the deployment update interface to specify behavior.
 * When the actual repository binding logic is implemented in the deployment
 * update service, it should satisfy all these properties.
 *
 * Validates: Design doc section 5 (Deployment Engine - repository binding)
 */

import * as fc from 'fast-check';
import type { CustomizationConfig } from '@craft/types';

// ── Type Definitions ───────────────────────────────────────────────────────────

/**
 * Repository binding state for a deployment
 */
interface RepositoryBinding {
    /** GitHub repository URL */
    url: string | null;
    /** Whether the binding is still valid/eligible for reuse */
    isEligible: boolean;
    /** Optional error message if binding is invalid */
    errorMessage?: string;
}

/**
 * Deployment state as stored in the database
 */
interface DeploymentState {
    id: string;
    userId: string;
    name: string;
    customizationConfig: CustomizationConfig;
    repositoryBinding: RepositoryBinding;
    deploymentUrl: string | null;
    vercelDeploymentId: string | null;
    status: 'pending' | 'generating' | 'creating_repo' | 'pushing_code' | 'deploying' | 'completed' | 'failed';
}

/**
 * Result of a deployment update operation
 */
interface DeploymentUpdateResult {
    deploymentId: string;
    success: boolean;
    repositoryUrl: string | null;
    createdNewRepository: boolean;
    errorMessage?: string;
}

/**
 * Deployment update contract interface
 */
interface DeploymentUpdateContract {
    /**
     * Update a deployment with new customization config.
     * Should reuse existing repository when eligible.
     */
    updateDeployment(
        deploymentId: string,
        updates: CustomizationConfig
    ): Promise<DeploymentUpdateResult>;
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

/**
 * Generate random but valid customization configurations
 */
const arbBrandingConfig = fc.record({
    appName: fc.string({ minLength: 1, maxLength: 50 }),
    logoUrl: fc.option(fc.webUrl()).map((url) => url ?? undefined),
    primaryColor: fc.hexaString().map((hex) => `#${hex}`).filter((s) => s.length === 7),
    secondaryColor: fc.hexaString().map((hex) => `#${hex}`).filter((s) => s.length === 7),
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
 * Generate valid GitHub repository URLs
 */
const arbValidRepoUrl = fc.webUrl().filter((url) =>
    url.includes('github.com') && url.length > 20
);

/**
 * Generate invalid repository URLs (malformed or non-GitHub)
 */
const arbInvalidRepoUrl = fc.oneOf(
    fc.string({ minLength: 1, maxLength: 10 }), // Too short
    fc.webUrl().filter((url) => !url.includes('github.com')), // Not GitHub
    fc.constant(''),
    fc.constant('not-a-url'),
    fc.constant('https://gitlab.com/repo'), // Different provider
);

/**
 * Generate repository bindings with various states
 */
const arbValidRepositoryBinding: fc.Arbitrary<RepositoryBinding> = fc.record({
    url: arbValidRepoUrl,
    isEligible: fc.constant(true),
    errorMessage: fc.constant(undefined),
});

const arbInvalidRepositoryBinding: fc.Arbitrary<RepositoryBinding> = fc.oneOf(
    fc.record({
        url: arbInvalidRepoUrl,
        isEligible: fc.constant(false),
        errorMessage: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    fc.record({
        url: fc.constant(null),
        isEligible: fc.constant(false),
        errorMessage: fc.constant('No repository bound'),
    }),
);

const arbRepositoryBinding: fc.Arbitrary<RepositoryBinding> = fc.oneOf(
    arbValidRepositoryBinding,
    arbInvalidRepositoryBinding,
);

/**
 * Generate random deployment states with repository bindings
 * Only 'completed' deployments can be updated
 */
const arbDeploymentState: fc.Arbitrary<DeploymentState> = fc.record({
    id: fc.uuid(),
    userId: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    customizationConfig: arbCustomizationConfig,
    repositoryBinding: arbRepositoryBinding,
    deploymentUrl: fc.option(fc.webUrl()),
    vercelDeploymentId: fc.option(fc.uuid()),
    status: fc.constant('completed' as const),
});

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
    private repositoryCreatedCount: Map<string, number> = new Map();

    setInitialDeployment(state: DeploymentState) {
        this.state.set(state.id, state);
        this.repositoryCreatedCount.set(state.id, 0);
    }

    async updateDeployment(
        deploymentId: string,
        updates: CustomizationConfig
    ): Promise<DeploymentUpdateResult> {
        const currentState = this.state.get(deploymentId);

        if (!currentState) {
            return {
                deploymentId,
                success: false,
                repositoryUrl: null,
                createdNewRepository: false,
                errorMessage: 'Deployment not found',
            };
        }

        // Check if repository binding is eligible for reuse
        const canReuseRepository =
            currentState.repositoryBinding.url !== null &&
            currentState.repositoryBinding.isEligible;

        if (canReuseRepository) {
            // Reuse the existing repository - NO new repository created
            const newState: DeploymentState = {
                ...currentState,
                customizationConfig: updates,
            };
            this.state.set(deploymentId, newState);

            return {
                deploymentId,
                success: true,
                repositoryUrl: currentState.repositoryBinding.url,
                createdNewRepository: false,
            };
        } else {
            // Invalid binding - for this test, we don't create new repos
            // In a real implementation, this might create a new repo or flag an error
            const newState: DeploymentState = {
                ...currentState,
                customizationConfig: updates,
            };
            this.state.set(deploymentId, newState);

            return {
                deploymentId,
                success: true,
                repositoryUrl: currentState.repositoryBinding.url,
                createdNewRepository: false,
                errorMessage: currentState.repositoryBinding.errorMessage,
            };
        }
    }

    getCurrentState(deploymentId: string): DeploymentState | undefined {
        return this.state.get(deploymentId);
    }

    getRepositoryCreatedCount(deploymentId: string): number {
        return this.repositoryCreatedCount.get(deploymentId) ?? 0;
    }
}

// ── Property Tests ────────────────────────────────────────────────────────────

describe('Property 35 — Repository Reuse on Deployment Update (Contract Test)', () => {
    let service: MockDeploymentUpdateService;

    beforeEach(() => {
        service = new MockDeploymentUpdateService();
    });

    /**
     * Property 35.1: Valid repository bindings are preserved during updates
     *
     * INVARIANT: When a deployment has a valid (eligible) repository binding,
     * the repository URL must remain unchanged after update.
     */
    describe('Property 35.1 — Valid repository binding is preserved', () => {
        it('for any deployment with valid repository, update preserves the repository URL', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbDeploymentState,
                    arbCustomizationConfig,
                    async (initialState, newConfig) => {
                        // Ensure we have a valid repository binding
                        const stateWithValidRepo: DeploymentState = {
                            ...initialState,
                            repositoryBinding: {
                                url: 'https://github.com/owner/repo',
                                isEligible: true,
                            },
                        };

                        service.setInitialDeployment(stateWithValidRepo);

                        const result = await service.updateDeployment(
                            stateWithValidRepo.id,
                            newConfig
                        );

                        // ASSERTION 1: Update must succeed
                        expect(result.success).toBe(true);

                        // ASSERTION 2 (CORE): Repository URL must be preserved
                        expect(result.repositoryUrl).toBe('https://github.com/owner/repo');

                        // ASSERTION 3: No new repository should be created
                        expect(result.createdNewRepository).toBe(false);

                        // ASSERTION 4: Final state should have the new config
                        const finalState = service.getCurrentState(stateWithValidRepo.id);
                        expect(finalState?.customizationConfig).toEqual(newConfig);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 35.2: No replacement repository is created for valid updates
     *
     * INVARIANT: For any number of updates to a deployment with valid repository
     * binding, no new repositories should be created.
     */
    describe('Property 35.2 — No replacement repository created (CORE)', () => {
        it('multiple updates to valid repository binding never create new repositories', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbDeploymentState,
                    fc.array(arbCustomizationConfig, { minLength: 2, maxLength: 10 }),
                    async (initialState, newConfigs) => {
                        // Ensure we have a valid repository binding
                        const originalRepoUrl = 'https://github.com/owner/my-deployment';
                        const stateWithValidRepo: DeploymentState = {
                            ...initialState,
                            repositoryBinding: {
                                url: originalRepoUrl,
                                isEligible: true,
                            },
                        };

                        service.setInitialDeployment(stateWithValidRepo);

                        // Perform multiple updates
                        for (const config of newConfigs) {
                            const result = await service.updateDeployment(
                                stateWithValidRepo.id,
                                config
                            );

                            // Each update should succeed
                            expect(result.success).toBe(true);

                            // Each update should preserve the original repository
                            expect(result.repositoryUrl).toBe(originalRepoUrl);

                            // No new repository should ever be created
                            expect(result.createdNewRepository).toBe(false);
                        }

                        // FINAL ASSERTION: After all updates, still using original repo
                        const finalState = service.getCurrentState(stateWithValidRepo.id);
                        expect(finalState?.repositoryBinding.url).toBe(originalRepoUrl);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 35.3: Invalid repository bindings are handled correctly
     *
     * INVARIANT: When a deployment has an invalid repository binding,
     * the update should still succeed but may flag the issue.
     */
    describe('Property 35.3 — Invalid repository binding is handled', () => {
        it('update succeeds even with invalid repository binding', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbDeploymentState,
                    arbCustomizationConfig,
                    async (initialState, newConfig) => {
                        // Ensure we have an invalid repository binding
                        const stateWithInvalidRepo: DeploymentState = {
                            ...initialState,
                            repositoryBinding: {
                                url: null,
                                isEligible: false,
                                errorMessage: 'No repository bound',
                            },
                        };

                        service.setInitialDeployment(stateWithInvalidRepo);

                        const result = await service.updateDeployment(
                            stateWithInvalidRepo.id,
                            newConfig
                        );

                        // ASSERTION: Update should succeed (config can still be updated)
                        expect(result.success).toBe(true);

                        // The repository URL should remain unchanged (null)
                        expect(result.repositoryUrl).toBe(null);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 35.4: Repository binding consistency across edge cases
     *
     * INVARIANT: Various edge cases should maintain repository consistency.
     */
    describe('Property 35.4 — Edge cases maintain consistency', () => {
        it('handles various repository URL formats correctly', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbCustomizationConfig,
                    fc.uuid(),
                    async (config, deploymentId) => {
                        // Test with various valid GitHub URL formats
                        const validUrls = [
                            'https://github.com/owner/repo',
                            'https://github.com/owner/repo.git',
                            'https://github.com/org/team/project',
                        ];

                        for (const url of validUrls) {
                            const state: DeploymentState = {
                                id: deploymentId,
                                userId: 'user-' + deploymentId,
                                name: 'Test Deployment',
                                customizationConfig: config,
                                repositoryBinding: {
                                    url,
                                    isEligible: true,
                                },
                                deploymentUrl: 'https://example.vercel.app',
                                vercelDeploymentId: null,
                                status: 'completed',
                            };

                            service.setInitialDeployment(state);

                            const result = await service.updateDeployment(deploymentId, config);

                            // Should preserve any valid GitHub URL format
                            expect(result.repositoryUrl).toBe(url);
                            expect(result.createdNewRepository).toBe(false);
                        }
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('handles null repository binding correctly', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbCustomizationConfig,
                    arbUuid,
                    async (config, deploymentId) => {
                        const state: DeploymentState = {
                            id: deploymentId,
                            userId: 'user-' + deploymentId,
                            name: 'Test Deployment',
                            customizationConfig: config,
                            repositoryBinding: {
                                url: null,
                                isEligible: false,
                                errorMessage: 'Repository not created',
                            },
                            deploymentUrl: null,
                            vercelDeploymentId: null,
                            status: 'completed',
                        };

                        service.setInitialDeployment(state);

                        const result = await service.updateDeployment(deploymentId, config);

                        // Should succeed but URL remains null
                        expect(result.success).toBe(true);
                        expect(result.repositoryUrl).toBe(null);
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    /**
     * Property 35.5: State isolation between deployments
     *
     * INVARIANT: Repository binding of one deployment should not affect another.
     */
    describe('Property 35.5 — State isolation between deployments', () => {
        it('repository bindings are isolated between different deployments', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbDeploymentState,
                    arbDeploymentState,
                    arbCustomizationConfig,
                    async (stateA, stateB, newConfig) => {
                        // Ensure different deployment IDs
                        fc.pre(stateA.id !== stateB.id);

                        // Set different repository bindings
                        const stateAWithRepo: DeploymentState = {
                            ...stateA,
                            repositoryBinding: {
                                url: 'https://github.com/owner/repo-a',
                                isEligible: true,
                            },
                        };
                        const stateBWithRepo: DeploymentState = {
                            ...stateB,
                            repositoryBinding: {
                                url: 'https://github.com/owner/repo-b',
                                isEligible: true,
                            },
                        };

                        service.setInitialDeployment(stateAWithRepo);
                        service.setInitialDeployment(stateBWithRepo);

                        // Update deployment A
                        const resultA = await service.updateDeployment(stateAWithRepo.id, newConfig);

                        // ASSERTION: Deployment A should preserve its repository
                        expect(resultA.repositoryUrl).toBe('https://github.com/owner/repo-a');

                        // ASSERTION: Deployment B should be unaffected
                        const finalStateB = service.getCurrentState(stateBWithRepo.id);
                        expect(finalStateB?.repositoryBinding.url).toBe('https://github.com/owner/repo-b');
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    /**
     * Property 35.6: Eligibility flip scenarios
     *
     * INVARIANT: When repository eligibility changes mid-update, behavior is consistent.
     */
    describe('Property 35.6 — Eligibility flip scenarios', () => {
        it('maintains consistency when eligibility changes between updates', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbCustomizationConfig,
                    arbUuid,
                    async (config, deploymentId) => {
                        // Start with valid repository
                        const state: DeploymentState = {
                            id: deploymentId,
                            userId: 'user-' + deploymentId,
                            name: 'Test Deployment',
                            customizationConfig: config,
                            repositoryBinding: {
                                url: 'https://github.com/owner/repo',
                                isEligible: true,
                            },
                            deploymentUrl: 'https://example.vercel.app',
                            vercelDeploymentId: null,
                            status: 'completed',
                        };

                        service.setInitialDeployment(state);

                        // First update - should reuse repository
                        const result1 = await service.updateDeployment(deploymentId, config);
                        expect(result1.repositoryUrl).toBe('https://github.com/owner/repo');
                        expect(result1.createdNewRepository).toBe(false);

                        // Simulate eligibility becoming false (e.g., repo was deleted)
                        const stateAfterFirst = service.getCurrentState(deploymentId);
                        if (stateAfterFirst) {
                            stateAfterFirst.repositoryBinding.isEligible = false;
                            stateAfterFirst.repositoryBinding.errorMessage = 'Repository no longer exists';
                        }

                        // Second update - should handle invalid eligibility
                        const result2 = await service.updateDeployment(deploymentId, config);
                        expect(result2.success).toBe(true);
                        // Repository URL should remain as-is (not create new one in this mock)
                        expect(result2.repositoryUrl).toBe('https://github.com/owner/repo');
                    }
                ),
                { numRuns: 50 }
            );
        });
    });
});
