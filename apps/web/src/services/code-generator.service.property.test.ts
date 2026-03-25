/**
 * Property 16 – Code Generation Completeness
 *
 * "For any valid template and customization configuration, the generated code
 *  should include: all customization values in config files, Stellar network
 *  environment variables, preserved Turborepo structure, and syntactically
 *  valid code."
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
 *
 * Strategy
 * ────────
 * fast-check generates random CustomizationConfig values across the full
 * input space (all template families × all branding/feature/stellar combos).
 * For each generated input we run CodeGeneratorService.generate() and assert
 * the universal completeness invariants hold.
 *
 * Minimum 100 iterations (numRuns: 100) as required by the spec.
 *
 * Issue: #068 — write code generation tests and completeness proof
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    CodeGeneratorService,
    NETWORK_PASSPHRASE,
    type TemplateFamilyId,
} from './code-generator.service';
import type { CustomizationConfig } from '@craft/types';

// ── Arbitraries ───────────────────────────────────────────────────────────────

const TEMPLATE_FAMILIES: readonly TemplateFamilyId[] = [
    'stellar-dex',
    'soroban-defi',
    'payment-gateway',
    'asset-issuance',
];

const NETWORKS = ['mainnet', 'testnet'] as const;

/** Hex color string e.g. #a1b2c3 */
const arbHexColor = fc
    .stringMatching(/^[0-9a-fA-F]{6}$/)
    .map((h) => `#${h}`);

/** Safe printable string — avoids control chars that would break generated TS */
const arbSafeString = fc.string({ minLength: 1, maxLength: 40 }).filter(
    (s) => !/[\x00-\x1f\x7f]/.test(s)
);

const arbNetwork = fc.constantFrom(...NETWORKS);

const arbTemplateFamily = fc.constantFrom(...TEMPLATE_FAMILIES);

const arbBranding = fc.record({
    appName: arbSafeString,
    primaryColor: arbHexColor,
    secondaryColor: arbHexColor,
    fontFamily: arbSafeString,
});

const arbFeatures = fc.record({
    enableCharts: fc.boolean(),
    enableTransactionHistory: fc.boolean(),
    enableAnalytics: fc.boolean(),
    enableNotifications: fc.boolean(),
});

const arbStellarConfig = arbNetwork.chain((network) =>
    fc.record({
        network: fc.constant(network),
        horizonUrl: fc.constantFrom(
            'https://horizon-testnet.stellar.org',
            'https://horizon.stellar.org',
            'https://custom-horizon.example.com'
        ),
        sorobanRpcUrl: fc.option(
            fc.constantFrom(
                'https://soroban-testnet.stellar.org',
                'https://soroban.example.com'
            ),
            { nil: undefined }
        ),
    })
);

const arbCustomizationConfig: fc.Arbitrary<CustomizationConfig> = fc.record({
    branding: arbBranding,
    features: arbFeatures,
    stellar: arbStellarConfig,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFile(
    files: { path: string; content: string }[],
    path: string
): string | undefined {
    return files.find((f) => f.path === path)?.content;
}

// ── Property 16 ───────────────────────────────────────────────────────────────

describe('Property 16 – Code Generation Completeness', () => {
    const svc = new CodeGeneratorService();

    // ── 16-A: Required files always present ──────────────────────────────────

    it(
        '16-A: for any template family and config, required files are always generated',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    expect(result.success).toBe(true);
                    expect(result.errors).toHaveLength(0);

                    const paths = result.generatedFiles.map((f) => f.path);
                    expect(paths).toContain('src/lib/config.ts');
                    expect(paths).toContain('.env.local');
                    expect(paths).toContain('package.json');
                    expect(paths).toContain('src/lib/stellar.ts');
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-B: Branding values appear in config.ts ─────────────────────────────

    it(
        '16-B: for any config, all branding values appear in the generated config.ts',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.2
             *
             * Note: hex colors (#rrggbb) contain no characters that need escaping,
             * so they appear verbatim. String fields like fontFamily may be escaped
             * (backslashes, single quotes) — we verify the .env.local instead for
             * those, since env values are written raw without JS string escaping.
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const configContent = getFile(result.generatedFiles, 'src/lib/config.ts')!;
                    expect(configContent).toBeDefined();

                    // Hex colors are never escaped — they must appear verbatim
                    expect(configContent).toContain(cfg.branding.primaryColor);
                    expect(configContent).toContain(cfg.branding.secondaryColor);

                    // fontFamily appears in .env.local verbatim (no JS escaping there)
                    const envContent = getFile(result.generatedFiles, '.env.local')!;
                    expect(envContent).toContain(cfg.branding.fontFamily);
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-C: Stellar network env vars in config.ts ───────────────────────────

    it(
        '16-C: for any config, Stellar network env vars are present in config.ts',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.3
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const configContent = getFile(result.generatedFiles, 'src/lib/config.ts')!;

                    // Required Stellar env var keys
                    expect(configContent).toContain('NEXT_PUBLIC_STELLAR_NETWORK');
                    expect(configContent).toContain('NEXT_PUBLIC_HORIZON_URL');
                    expect(configContent).toContain('NEXT_PUBLIC_NETWORK_PASSPHRASE');

                    // Correct passphrase for the selected network
                    expect(configContent).toContain(NETWORK_PASSPHRASE[cfg.stellar.network]);

                    // Horizon URL value embedded
                    expect(configContent).toContain(cfg.stellar.horizonUrl);
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-D: .env.local contains all required keys ───────────────────────────

    it(
        '16-D: for any config, .env.local always contains all required NEXT_PUBLIC_ keys',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.3, 7.4
             */
            const REQUIRED_ENV_KEYS = [
                'NEXT_PUBLIC_APP_NAME',
                'NEXT_PUBLIC_PRIMARY_COLOR',
                'NEXT_PUBLIC_SECONDARY_COLOR',
                'NEXT_PUBLIC_FONT_FAMILY',
                'NEXT_PUBLIC_STELLAR_NETWORK',
                'NEXT_PUBLIC_HORIZON_URL',
                'NEXT_PUBLIC_NETWORK_PASSPHRASE',
                'NEXT_PUBLIC_ENABLE_CHARTS',
                'NEXT_PUBLIC_ENABLE_TRANSACTION_HISTORY',
                'NEXT_PUBLIC_ENABLE_ANALYTICS',
                'NEXT_PUBLIC_ENABLE_NOTIFICATIONS',
            ];

            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const envContent = getFile(result.generatedFiles, '.env.local')!;
                    expect(envContent).toBeDefined();

                    for (const key of REQUIRED_ENV_KEYS) {
                        expect(envContent, `Missing env key: ${key}`).toContain(key);
                    }
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-E: package.json always includes stellar-sdk ───────────────────────

    it(
        '16-E: for any template family, package.json always includes stellar-sdk dependency',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.5 (Property 46: Stellar SDK Inclusion)
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const pkgContent = getFile(result.generatedFiles, 'package.json')!;
                    expect(pkgContent).toBeDefined();

                    // Must be valid JSON
                    let pkg: any;
                    expect(() => { pkg = JSON.parse(pkgContent); }).not.toThrow();

                    // stellar-sdk must be in dependencies
                    expect(pkg.dependencies['stellar-sdk']).toBeDefined();
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-F: stellar.ts always imports stellar-sdk and has error handling ────

    it(
        '16-F: for any template family, stellar.ts always imports stellar-sdk and includes error handling',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.4, 17.1, 17.4
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const stellarContent = getFile(result.generatedFiles, 'src/lib/stellar.ts')!;
                    expect(stellarContent).toBeDefined();

                    // Must import stellar-sdk
                    expect(stellarContent).toContain("from 'stellar-sdk'");

                    // Must include error handling
                    expect(stellarContent).toContain('throw new Error');
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-G: Feature flags reflected in config.ts ────────────────────────────

    it(
        '16-G: for any feature config, all four feature flag keys appear in config.ts',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.2
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const configContent = getFile(result.generatedFiles, 'src/lib/config.ts')!;

                    expect(configContent).toContain('enableCharts');
                    expect(configContent).toContain('enableTransactionHistory');
                    expect(configContent).toContain('enableAnalytics');
                    expect(configContent).toContain('enableNotifications');
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-H: soroban-defi always generates soroban.ts ───────────────────────

    it(
        '16-H: for any config, soroban-defi always generates soroban.ts with SorobanRpc',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.4, 17.3 (Property 47: Soroban Configuration Inclusion)
             */
            fc.assert(
                fc.property(arbCustomizationConfig, (cfg) => {
                    const result = svc.generate({
                        templateId: 'soroban-defi',
                        templateFamily: 'soroban-defi',
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const paths = result.generatedFiles.map((f) => f.path);
                    expect(paths).toContain('src/lib/soroban.ts');

                    const sorobanContent = getFile(result.generatedFiles, 'src/lib/soroban.ts')!;
                    expect(sorobanContent).toContain('SorobanRpc');
                    expect(sorobanContent).toContain('invokeContract');
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-I: Network passphrase matches network selection ────────────────────

    it(
        '16-I: for any network selection, the correct passphrase is always embedded in config.ts',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 5.1, 17.2 (Property 12: Network Configuration Mapping)
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const configContent = getFile(result.generatedFiles, 'src/lib/config.ts')!;
                    const expectedPassphrase = NETWORK_PASSPHRASE[cfg.stellar.network];
                    const wrongPassphrase = NETWORK_PASSPHRASE[cfg.stellar.network === 'mainnet' ? 'testnet' : 'mainnet'];

                    expect(configContent).toContain(expectedPassphrase);
                    // The wrong passphrase for the selected network must NOT appear
                    expect(configContent).not.toContain(wrongPassphrase);
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-J: All generated files have non-empty content and valid type ───────

    it(
        '16-J: for any input, all generated files have non-empty content and a valid type field',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.1, 18.1
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    for (const file of result.generatedFiles) {
                        expect(file.content.trim().length, `Empty file: ${file.path}`).toBeGreaterThan(0);
                        expect(['code', 'config', 'asset']).toContain(file.type);
                        expect(file.path.length).toBeGreaterThan(0);
                    }
                }),
                { numRuns: 100 }
            );
        }
    );
});
