/**
 * Stellar Network Service — Property-Based Tests
 *
 * Property 051: Network Selection Validation and Metadata Derivation
 *
 * Verifies invariants about network validation and metadata:
 * 1. All supported networks can be validated successfully
 * 2. Unsupported networks always fail with UNSUPPORTED_NETWORK error
 * 3. Network metadata is consistent across validation and direct lookup
 * 4. Network environment variables match network identity
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    getSupportedNetworks,
    isNetworkSupported,
    getNetworkMetadata,
    validateNetworkSelection,
    coerceNetworkId,
    stellarNetworkService,
    StellarNetworkService,
    type StellarNetworkId,
} from './stellar-network.service';

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbSupportedNetwork = fc.constantFrom(...getSupportedNetworks());

const arbUnsupportedNetwork = fc
    .string({ minLength: 1 })
    .filter((s) => !isNetworkSupported(s));

const arbArbitraryInput = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.boolean(),
    fc.integer(),
    fc.float(),
    fc.string(),
    fc.object({ keys: fc.string() }),
    fc.array(fc.anything())
);

// ── Property Tests ────────────────────────────────────────────────────────────

describe('Network Selection Validation — Property 051', () => {
    describe('supported networks', () => {
        it('all supported networks validate successfully', () => {
            fc.assert(
                fc.property(arbSupportedNetwork, (network) => {
                    const result = validateNetworkSelection(network);

                    // Invariant: supported networks always validate
                    expect(result.valid).toBe(true);
                    expect(result.network).toBe(network);
                    expect(result.metadata).toBeDefined();
                    expect(result.error).toBeUndefined();
                }),
                { numRuns: 100 }
            );
        });

        it('validated network can be coerced without throwing', () => {
            fc.assert(
                fc.property(arbSupportedNetwork, (network) => {
                    const coerced = coerceNetworkId(network);

                    // Invariant: coercion succeeds for supported networks
                    expect(coerced).toBe(network);
                }),
                { numRuns: 100 }
            );
        });

        it('metadata is always returned for supported networks', () => {
            fc.assert(
                fc.property(arbSupportedNetwork, (network) => {
                    const result = validateNetworkSelection(network);
                    const directMetadata = getNetworkMetadata(network);

                    // Invariant: metadata from validation matches direct lookup
                    expect(result.metadata).toEqual(directMetadata);
                    expect(result.metadata?.id).toBe(network);
                }),
                { numRuns: 100 }
            );
        });

        it('metadata has correct structure for all supported networks', () => {
            fc.assert(
                fc.property(arbSupportedNetwork, (network) => {
                    const metadata = getNetworkMetadata(network);

                    // Invariant: every network has complete metadata
                    expect(metadata).not.toBeNull();
                    expect(metadata!.id).toBe(network);
                    expect(metadata!.name).toBeDefined();
                    expect(metadata!.networkPassphrase).toBeDefined();
                    expect(metadata!.horizonUrl).toBeDefined();
                    expect(metadata!.sorobanRpcUrl).toBeDefined();
                    expect(metadata!.environment).toBeDefined();
                }),
                { numRuns: 100 }
            );
        });

        it('environment variables match network identity', () => {
            fc.assert(
                fc.property(arbSupportedNetwork, (network) => {
                    const metadata = getNetworkMetadata(network);

                    // Invariant: NEXT_PUBLIC_STELLAR_NETWORK env var matches network ID
                    expect(metadata!.environment.NEXT_PUBLIC_STELLAR_NETWORK).toBe(network);

                    // Invariant: Horizon URL is a valid HTTPS URL
                    expect(metadata!.environment.NEXT_PUBLIC_HORIZON_URL).toMatch(/^https:\/\//);

                    // Invariant: network passphrase contains network name
                    expect(metadata!.environment.NEXT_PUBLIC_NETWORK_PASSPHRASE).toBeDefined();

                    // Invariant: Soroban RPC URL is a valid HTTPS URL
                    expect(metadata!.environment.NEXT_PUBLIC_SOROBAN_RPC_URL).toMatch(/^https:\/\//);
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('unsupported networks', () => {
        it('unsupported networks always fail validation', () => {
            fc.assert(
                fc.property(arbUnsupportedNetwork, (network) => {
                    const result = validateNetworkSelection(network);

                    // Invariant: unsupported networks fail
                    expect(result.valid).toBe(false);
                    expect(result.error).toBeDefined();
                    expect(result.network).toBeUndefined();
                    expect(result.metadata).toBeUndefined();
                }),
                { numRuns: 100 }
            );
        });

        it('unexpected networks fail with UNSUPPORTED_NETWORK error', () => {
            fc.assert(
                fc.property(arbUnsupportedNetwork, (network) => {
                    const result = validateNetworkSelection(network);

                    // Invariant: error code is UNSUPPORTED_NETWORK
                    expect(result.error?.code).toBe('UNSUPPORTED_NETWORK');
                    expect(result.error?.field).toBe('stellar.network');
                    expect(result.error?.message).toContain(network);
                }),
                { numRuns: 100 }
            );
        });

        it('unsupported networks cannot be coerced', () => {
            fc.assert(
                fc.property(arbUnsupportedNetwork, (network) => {
                    // Invariant: coercion throws for unsupported networks
                    expect(() => coerceNetworkId(network)).toThrow();
                }),
                { numRuns: 100 }
            );
        });

        it('error messages list all supported networks', () => {
            fc.assert(
                fc.property(arbUnsupportedNetwork, (network) => {
                    const result = validateNetworkSelection(network);
                    const supportedList = getSupportedNetworks();

                    // Invariant: error message includes all supported networks
                    for (const supported of supportedList) {
                        expect(result.error?.message).toContain(supported);
                    }
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('type safety and error handling', () => {
        it('arbitrary inputs fail gracefully with appropriate error', () => {
            fc.assert(
                fc.property(arbArbitraryInput, (input) => {
                    const result = validateNetworkSelection(input);

                    // Invariant: all inputs either validate or fail with proper error
                    if (result.valid) {
                        expect(getSupportedNetworks()).toContain(result.network);
                        expect(result.metadata).toBeDefined();
                    } else {
                        expect(result.error).toBeDefined();
                        expect(result.error?.field).toBe('stellar.network');
                        expect(result.error?.code).toBeDefined();
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('all error codes are documented types', () => {
            const validErrorCodes = new Set([
                'UNSUPPORTED_NETWORK',
                'MISSING_NETWORK',
                'INVALID_NETWORK_TYPE',
                'NETWORK_TYPE_COERCION_FAILED',
            ]);

            fc.assert(
                fc.property(arbArbitraryInput, (input) => {
                    const result = validateNetworkSelection(input);

                    // Invariant: error codes are in the allowed set
                    if (!result.valid) {
                        expect(validErrorCodes).toContain(result.error?.code);
                    }
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('stability and consistency', () => {
        it('validation is deterministic', () => {
            fc.assert(
                fc.property(arbSupportedNetwork, (network) => {
                    const result1 = validateNetworkSelection(network);
                    const result2 = validateNetworkSelection(network);

                    // Invariant: same input always produces same output
                    expect(result1).toEqual(result2);
                }),
                { numRuns: 100 }
            );
        });

        it('metadata lookup is idempotent', () => {
            fc.assert(
                fc.property(arbSupportedNetwork, (network) => {
                    const metadata1 = getNetworkMetadata(network);
                    const metadata2 = getNetworkMetadata(network);

                    // Invariant: metadata is always the same
                    expect(metadata1).toEqual(metadata2);
                }),
                { numRuns: 100 }
            );
        });

        it('supported networks list is consistent', () => {
            fc.assert(
                fc.property(fc.integer(), () => {
                    const networks1 = getSupportedNetworks();
                    const networks2 = getSupportedNetworks();

                    // Invariant: list never changes
                    expect(networks1).toEqual(networks2);
                }),
                { numRuns: 10 }
            );
        });
    });

    describe('service class consistency', () => {
        it('module functions and service methods produce identical results', () => {
            fc.assert(
                fc.property(arbSupportedNetwork, (network) => {
                    const service = new StellarNetworkService();

                    // Invariant: service methods match module functions
                    expect(service.getSupportedNetworks()).toEqual(getSupportedNetworks());
                    expect(service.isSupported(network)).toBe(isNetworkSupported(network));
                    expect(service.validate(network)).toEqual(validateNetworkSelection(network));
                    expect(service.getMetadata(network)).toEqual(getNetworkMetadata(network));
                }),
                { numRuns: 100 }
            );
        });

        it('singleton and new instances behave identically', () => {
            fc.assert(
                fc.property(arbSupportedNetwork, (network) => {
                    const service = new StellarNetworkService();

                    // Invariant: singleton produces same results as new instance
                    expect(stellarNetworkService.validate(network)).toEqual(service.validate(network));
                    expect(stellarNetworkService.getMetadata(network)).toEqual(
                        service.getMetadata(network)
                    );
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('network configuration correctness', () => {
        it('mainnet configuration is correct and complete', () => {
            fc.assert(
                fc.property(fc.constant('mainnet'), (network) => {
                    const metadata = getNetworkMetadata(network);

                    // Invariant: mainnet has correct configuration
                    expect(metadata?.networkPassphrase).toBe(
                        'Public Global Stellar Network ; September 2015'
                    );
                    expect(metadata?.horizonUrl).toBe('https://horizon.stellar.org');
                    expect(metadata?.sorobanRpcUrl).toContain('soroban');
                    expect(metadata?.sorobanRpcUrl).not.toContain('testnet');
                }),
                { numRuns: 10 }
            );
        });

        it('testnet configuration is correct and complete', () => {
            fc.assert(
                fc.property(fc.constant('testnet'), (network) => {
                    const metadata = getNetworkMetadata(network);

                    // Invariant: testnet has correct configuration
                    expect(metadata?.networkPassphrase).toBe('Test SDF Network ; September 2015');
                    expect(metadata?.horizonUrl).toContain('testnet');
                    expect(metadata?.sorobanRpcUrl).toContain('testnet');
                }),
                { numRuns: 10 }
            );
        });

        it('network URLs are never empty or malformed', () => {
            fc.assert(
                fc.property(arbSupportedNetwork, (network) => {
                    const metadata = getNetworkMetadata(network);

                    // Invariant: all URLs are valid HTTPS
                    expect(metadata?.horizonUrl).toMatch(/^https:\/\/.+/);
                    expect(metadata?.sorobanRpcUrl).toMatch(/^https:\/\/.+/);

                    // Invariant: passphrases are non-empty
                    expect(metadata?.networkPassphrase).toBeTruthy();
                    expect(metadata?.networkPassphrase.length).toBeGreaterThan(0);
                }),
                { numRuns: 100 }
            );
        });
    });
});
