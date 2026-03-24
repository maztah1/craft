/**
 * Property tests for the PreviewService.
 *
 * Property 13 — Preview Mock Data Isolation
 *   For any preview interaction, no actual Stellar network requests are made
 *   and all blockchain data comes exclusively from mock sources.
 *   Validates: Requirements 6.3
 *
 * Property 14 — Responsive Preview Rendering
 *   For any customisation configuration, the preview renders successfully at
 *   all supported viewport classes (desktop, tablet, mobile) without errors,
 *   and the resulting layout metadata is valid for each class.
 *   Validates: Requirements 6.4
 *
 * Feature: craft-platform
 * Issue: issue-059-add-property-tests-for-mock-data-isolation-and-responsive
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
    PreviewService,
    STATIC_MOCK_DATA,
    VIEWPORT_CLASSES,
    VIEWPORT_DIMENSIONS,
    deriveLayoutMetadata,
    generatePreviewCss,
    type ViewportClass,
} from './preview.service';

// ── Guard: ensure no network module is ever imported ─────────────────────────
// The preview service must not import @craft/stellar or any Stellar SDK.
// We verify this at the module level by asserting the mock is never called.

const mockHorizonFetch = vi.fn();
vi.mock('@craft/stellar', () => ({
    StellarService: vi.fn().mockImplementation(() => ({
        getAccountBalance: mockHorizonFetch,
        getTransactions: mockHorizonFetch,
        getAssetPrices: mockHorizonFetch,
    })),
}));

// ── Arbitraries ───────────────────────────────────────────────────────────────

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const arbHexColor = fc
    .tuple(
        fc.hexaString({ minLength: 3, maxLength: 3 }),
        fc.hexaString({ minLength: 3, maxLength: 3 })
    )
    // Ensure primary !== secondary to satisfy DUPLICATE_COLORS business rule
    .filter(([a, b]) => a.toLowerCase() !== b.toLowerCase())
    .map(([a, b]) => [`#${a}`, `#${b}`] as [string, string]);

const arbFontFamily = fc.constantFrom('Inter', 'Roboto', 'Poppins', 'Lato', 'Open Sans');

const arbNetwork = fc.constantFrom('mainnet' as const, 'testnet' as const);

const arbHorizonUrl = arbNetwork.map((network) =>
    network === 'mainnet'
        ? 'https://horizon.stellar.org'
        : 'https://horizon-testnet.stellar.org'
);

/** Generates a valid CustomizationConfig with matching network/horizonUrl. */
const arbCustomizationConfig = fc
    .tuple(arbHexColor, arbFontFamily, arbNetwork)
    .chain(([[primary, secondary], font, network]) =>
        fc.record({
            branding: fc.record({
                appName: fc.string({ minLength: 1, maxLength: 60 }),
                primaryColor: fc.constant(primary),
                secondaryColor: fc.constant(secondary),
                fontFamily: fc.constant(font),
                logoUrl: fc.option(fc.webUrl(), { nil: undefined }),
            }),
            features: fc.record({
                enableCharts: fc.boolean(),
                enableTransactionHistory: fc.boolean(),
                enableAnalytics: fc.boolean(),
                enableNotifications: fc.boolean(),
            }),
            stellar: fc.record({
                network: fc.constant(network),
                horizonUrl: fc.constant(
                    network === 'mainnet'
                        ? 'https://horizon.stellar.org'
                        : 'https://horizon-testnet.stellar.org'
                ),
                sorobanRpcUrl: fc.option(fc.webUrl(), { nil: undefined }),
            }),
        })
    );

const arbViewportClass = fc.constantFrom<ViewportClass>(...VIEWPORT_CLASSES);

// ── Property 13: Preview Mock Data Isolation ──────────────────────────────────

describe('Property 13 — Preview Mock Data Isolation', () => {
    let service: PreviewService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new PreviewService();
    });

    it('mockData is always the static fixture — never fetched from the network', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, arbViewportClass, (config, viewport) => {
                const preview = service.generatePreview(config, viewport);

                // The entire mock data object must be reference-equal to the
                // static fixture, proving no dynamic fetch occurred.
                expect(preview.mockData).toBe(STATIC_MOCK_DATA);
            }),
            { numRuns: 100 }
        );
    });

    it('no Stellar network calls are made for any config/viewport combination', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, arbViewportClass, (config, viewport) => {
                service.generatePreview(config, viewport);

                // The mocked Stellar SDK methods must never be invoked.
                expect(mockHorizonFetch).not.toHaveBeenCalled();
            }),
            { numRuns: 100 }
        );
    });

    it('accountBalance is always a non-empty string from the mock', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, arbViewportClass, (config, viewport) => {
                const { mockData } = service.generatePreview(config, viewport);

                expect(typeof mockData.accountBalance).toBe('string');
                expect(mockData.accountBalance.length).toBeGreaterThan(0);
            }),
            { numRuns: 100 }
        );
    });

    it('recentTransactions is always a non-empty array from the mock', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, arbViewportClass, (config, viewport) => {
                const { mockData } = service.generatePreview(config, viewport);

                expect(Array.isArray(mockData.recentTransactions)).toBe(true);
                expect(mockData.recentTransactions.length).toBeGreaterThan(0);
            }),
            { numRuns: 100 }
        );
    });

    it('each mock transaction has all required fields with correct types', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, (config) => {
                const { mockData } = service.generatePreview(config, 'desktop');

                for (const tx of mockData.recentTransactions) {
                    expect(typeof tx.id).toBe('string');
                    expect(tx.id.length).toBeGreaterThan(0);
                    expect(typeof tx.type).toBe('string');
                    expect(typeof tx.amount).toBe('string');
                    expect(tx.timestamp).toBeInstanceOf(Date);
                    // Asset fields
                    expect(typeof tx.asset.code).toBe('string');
                    expect(['native', 'credit_alphanum4', 'credit_alphanum12']).toContain(tx.asset.type);
                }
            }),
            { numRuns: 100 }
        );
    });

    it('assetPrices is always a non-null object from the mock', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, arbViewportClass, (config, viewport) => {
                const { mockData } = service.generatePreview(config, viewport);

                expect(mockData.assetPrices).not.toBeNull();
                expect(typeof mockData.assetPrices).toBe('object');
                // Every price value must be a finite number
                const prices = Object.keys(mockData.assetPrices).map((k) => mockData.assetPrices[k]);
                for (const price of prices) {
                    expect(typeof price).toBe('number');
                    expect(isFinite(price)).toBe(true);
                }
            }),
            { numRuns: 100 }
        );
    });

    it('mock data is identical across all viewport classes for the same config', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, (config) => {
                const all = service.generateAllViewports(config);

                // All three viewports must share the exact same mock data reference
                expect(all.desktop.mockData).toBe(all.tablet.mockData);
                expect(all.tablet.mockData).toBe(all.mobile.mockData);
            }),
            { numRuns: 100 }
        );
    });

    it('preview data is derived only from the supplied config — not from external state', () => {
        fc.assert(
            fc.property(
                arbCustomizationConfig,
                arbCustomizationConfig,
                arbViewportClass,
                (configA, configB, viewport) => {
                    fc.pre(configA.branding.appName !== configB.branding.appName);

                    const previewA = service.generatePreview(configA, viewport);
                    const previewB = service.generatePreview(configB, viewport);

                    // Different configs must produce different branding
                    expect(previewA.branding.appName).toBe(configA.branding.appName);
                    expect(previewB.branding.appName).toBe(configB.branding.appName);
                    expect(previewA.branding.appName).not.toBe(previewB.branding.appName);

                    // But mock data is always the same static fixture
                    expect(previewA.mockData).toBe(STATIC_MOCK_DATA);
                    expect(previewB.mockData).toBe(STATIC_MOCK_DATA);
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ── Property 14: Responsive Preview Rendering ─────────────────────────────────

describe('Property 14 — Responsive Preview Rendering', () => {
    let service: PreviewService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new PreviewService();
    });

    it('generatePreview succeeds for every viewport class without throwing', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, arbViewportClass, (config, viewport) => {
                expect(() => service.generatePreview(config, viewport)).not.toThrow();
            }),
            { numRuns: 100 }
        );
    });

    it('viewport dimensions are correct for each class', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, arbViewportClass, (config, viewport) => {
                const preview = service.generatePreview(config, viewport);

                expect(preview.viewport.width).toBe(VIEWPORT_DIMENSIONS[viewport].width);
                expect(preview.viewport.height).toBe(VIEWPORT_DIMENSIONS[viewport].height);
                expect(preview.viewport.width).toBeGreaterThan(0);
                expect(preview.viewport.height).toBeGreaterThan(0);
            }),
            { numRuns: 100 }
        );
    });

    it('desktop viewport is always wider than tablet, tablet wider than mobile', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, (config) => {
                const all = service.generateAllViewports(config);

                expect(all.desktop.viewport.width).toBeGreaterThan(all.tablet.viewport.width);
                expect(all.tablet.viewport.width).toBeGreaterThan(all.mobile.viewport.width);
            }),
            { numRuns: 100 }
        );
    });

    it('generateAllViewports returns all three viewport classes for any config', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, (config) => {
                const all = service.generateAllViewports(config);

                expect(all).toHaveProperty('desktop');
                expect(all).toHaveProperty('tablet');
                expect(all).toHaveProperty('mobile');
                // Each entry must be a non-null object
                for (const vp of VIEWPORT_CLASSES) {
                    expect(all[vp]).not.toBeNull();
                    expect(typeof all[vp]).toBe('object');
                }
            }),
            { numRuns: 100 }
        );
    });

    it('branding values are faithfully reflected in every viewport preview', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, arbViewportClass, (config, viewport) => {
                const preview = service.generatePreview(config, viewport);

                expect(preview.branding.appName).toBe(config.branding.appName);
                expect(preview.branding.primaryColor).toBe(config.branding.primaryColor);
                expect(preview.branding.secondaryColor).toBe(config.branding.secondaryColor);
                expect(preview.branding.fontFamily).toBe(config.branding.fontFamily);
            }),
            { numRuns: 100 }
        );
    });

    it('feature flags are faithfully reflected in every viewport preview', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, arbViewportClass, (config, viewport) => {
                const preview = service.generatePreview(config, viewport);

                expect(preview.features.enableCharts).toBe(config.features.enableCharts);
                expect(preview.features.enableTransactionHistory).toBe(config.features.enableTransactionHistory);
                expect(preview.features.enableAnalytics).toBe(config.features.enableAnalytics);
                expect(preview.features.enableNotifications).toBe(config.features.enableNotifications);
            }),
            { numRuns: 100 }
        );
    });

    it('generated CSS contains primary color, secondary color, and font family for any config', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, (config) => {
                const css = generatePreviewCss(config);

                expect(css).toContain(config.branding.primaryColor);
                expect(css).toContain(config.branding.secondaryColor);
                expect(css).toContain(config.branding.fontFamily);
            }),
            { numRuns: 100 }
        );
    });

    it('generated CSS is identical for the same config regardless of viewport', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, (config) => {
                const all = service.generateAllViewports(config);

                // CSS is config-derived, not viewport-derived
                expect(all.desktop.css).toBe(all.tablet.css);
                expect(all.tablet.css).toBe(all.mobile.css);
            }),
            { numRuns: 100 }
        );
    });

    it('layout metadata is valid for every viewport class', () => {
        fc.assert(
            fc.property(arbViewportClass, (viewportClass) => {
                const meta = deriveLayoutMetadata(viewportClass);

                // Viewport dimensions must be positive whole numbers
                expect(meta.viewport.width).toBeGreaterThan(0);
                expect(meta.viewport.height).toBeGreaterThan(0);
                expect(meta.viewport.width % 1).toBe(0);
                expect(meta.viewport.height % 1).toBe(0);

                // Container max-width must not exceed viewport width
                expect(meta.containerMaxWidth).toBeLessThanOrEqual(meta.viewport.width);
                expect(meta.containerMaxWidth).toBeGreaterThan(0);

                // Grid columns must be a positive whole number
                expect(meta.gridColumns).toBeGreaterThan(0);
                expect(meta.gridColumns % 1).toBe(0);

                // viewportClass round-trips correctly
                expect(meta.viewportClass).toBe(viewportClass);

                // Sidebar is collapsed on narrow viewports
                if (viewportClass === 'desktop') {
                    expect(meta.sidebarCollapsed).toBe(false);
                } else {
                    expect(meta.sidebarCollapsed).toBe(true);
                }
            }),
            { numRuns: 50 }
        );
    });

    it('desktop has more grid columns than tablet, tablet more than mobile', () => {
        const desktop = deriveLayoutMetadata('desktop');
        const tablet  = deriveLayoutMetadata('tablet');
        const mobile  = deriveLayoutMetadata('mobile');

        expect(desktop.gridColumns).toBeGreaterThan(tablet.gridColumns);
        expect(tablet.gridColumns).toBeGreaterThan(mobile.gridColumns);
    });

    it('preview output is deterministic — same inputs always produce same output', () => {
        fc.assert(
            fc.property(arbCustomizationConfig, arbViewportClass, (config, viewport) => {
                const service = new PreviewService();
                const first  = service.generatePreview(config, viewport);
                const second = service.generatePreview(config, viewport);

                // Structural equality for all scalar fields
                expect(second.css).toBe(first.css);
                expect(second.viewport.width).toBe(first.viewport.width);
                expect(second.viewport.height).toBe(first.viewport.height);
                expect(second.branding.appName).toBe(first.branding.appName);
                expect(second.branding.primaryColor).toBe(first.branding.primaryColor);
                expect(second.branding.secondaryColor).toBe(first.branding.secondaryColor);
                expect(second.branding.fontFamily).toBe(first.branding.fontFamily);
                expect(second.features).toEqual(first.features);
                expect(second.mockData).toBe(first.mockData);
            }),
            { numRuns: 100 }
        );
    });
});
