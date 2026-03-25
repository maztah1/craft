import { describe, it, expect, beforeEach } from 'vitest';
import {
    PreviewService,
    buildDefaultConfigFromTemplate,
    diffConfigs,
} from './preview.service';
import type { CustomizationConfig, Template } from '@craft/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal valid template — mirrors what TemplateService.mapDatabaseToTemplate returns */
const makeTemplate = (overrides: Partial<Template> = {}): Template => ({
    id: 'tpl-dex',
    name: 'Stellar DEX',
    description: 'A decentralised exchange template',
    category: 'dex',
    blockchainType: 'stellar',
    baseRepositoryUrl: 'https://github.com/org/stellar-dex',
    previewImageUrl: 'https://cdn.example.com/dex-preview.jpg',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    features: [
        { id: 'enableCharts', name: 'Charts', description: 'Enable charts', enabled: true, configurable: true },
        { id: 'enableAnalytics', name: 'Analytics', description: 'Enable analytics', enabled: false, configurable: true },
        { id: 'enableTransactionHistory', name: 'Tx History', description: 'Enable tx history', enabled: true, configurable: true },
        { id: 'enableNotifications', name: 'Notifications', description: 'Enable notifications', enabled: false, configurable: true },
    ],
    customizationSchema: {
        branding: {
            appName: { type: 'string', required: true },
            primaryColor: { type: 'color', required: true },
            secondaryColor: { type: 'color', required: true },
            fontFamily: { type: 'string', required: false },
        },
        features: {
            enableCharts: { type: 'boolean', default: true },
            enableTransactionHistory: { type: 'boolean', default: true },
            enableAnalytics: { type: 'boolean', default: false },
            enableNotifications: { type: 'boolean', default: false },
        },
        stellar: {
            network: { type: 'enum', values: ['mainnet', 'testnet'], required: true },
            horizonUrl: { type: 'string', required: true },
            sorobanRpcUrl: { type: 'string', required: false },
            assetPairs: { type: 'array', required: false },
        },
    },
    ...overrides,
});

/** A fully valid customization config */
const validConfig: CustomizationConfig = {
    branding: {
        appName: 'My DEX',
        primaryColor: '#6366f1',
        secondaryColor: '#a5b4fc',
        fontFamily: 'Inter',
    },
    features: {
        enableCharts: true,
        enableTransactionHistory: false,
        enableAnalytics: true,
        enableNotifications: false,
    },
    stellar: {
        network: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
    },
};

const mainnetConfig: CustomizationConfig = {
    ...validConfig,
    stellar: {
        network: 'mainnet',
        horizonUrl: 'https://horizon.stellar.org',
    },
};

const testnetConfig: CustomizationConfig = {
    ...validConfig,
    stellar: {
        network: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
    },
};

// ── buildDefaultConfigFromTemplate ────────────────────────────────────────────

describe('buildDefaultConfigFromTemplate', () => {
    it('reads feature defaults from the template schema', () => {
        const config = buildDefaultConfigFromTemplate(makeTemplate());
        expect(config.features.enableCharts).toBe(true);
        expect(config.features.enableTransactionHistory).toBe(true);
        expect(config.features.enableAnalytics).toBe(false);
        expect(config.features.enableNotifications).toBe(false);
    });

    it('falls back to safe defaults when schema has no features section', () => {
        const template = makeTemplate({
            customizationSchema: {
                branding: {} as any,
                features: {} as any,
                stellar: {} as any,
            },
        });
        const config = buildDefaultConfigFromTemplate(template);
        expect(config.features.enableCharts).toBe(true);
        expect(config.features.enableAnalytics).toBe(false);
    });

    it('falls back to safe defaults when customizationSchema is missing entirely', () => {
        const template = makeTemplate({ customizationSchema: undefined as any });
        const config = buildDefaultConfigFromTemplate(template);
        expect(config.branding.primaryColor).toBe('#6366f1');
        expect(config.stellar.network).toBe('testnet');
    });

    it('always returns a complete config with all three sections', () => {
        const config = buildDefaultConfigFromTemplate(makeTemplate());
        expect(config).toHaveProperty('branding');
        expect(config).toHaveProperty('features');
        expect(config).toHaveProperty('stellar');
    });

    it('uses schema default=false for features not explicitly defaulted', () => {
        const template = makeTemplate({
            customizationSchema: {
                ...makeTemplate().customizationSchema,
                features: {
                    enableCharts: { type: 'boolean', default: false },
                    enableTransactionHistory: { type: 'boolean', default: false },
                    enableAnalytics: { type: 'boolean', default: false },
                    enableNotifications: { type: 'boolean', default: false },
                },
            },
        });
        const config = buildDefaultConfigFromTemplate(template);
        expect(config.features.enableCharts).toBe(false);
        expect(config.features.enableTransactionHistory).toBe(false);
    });
});

// ── diffConfigs ───────────────────────────────────────────────────────────────

describe('diffConfigs', () => {
    it('returns empty array when configs are identical', () => {
        expect(diffConfigs(validConfig, validConfig)).toEqual([]);
    });

    it('detects a single branding field change', () => {
        const updated = {
            ...validConfig,
            branding: { ...validConfig.branding, appName: 'New Name' },
        };
        const changed = diffConfigs(validConfig, updated);
        expect(changed).toContain('branding.appName');
        expect(changed).toHaveLength(1);
    });

    it('detects a feature toggle change', () => {
        const updated = {
            ...validConfig,
            features: { ...validConfig.features, enableCharts: false },
        };
        const changed = diffConfigs(validConfig, updated);
        expect(changed).toContain('features.enableCharts');
    });

    it('detects a stellar network change', () => {
        const updated = {
            ...validConfig,
            stellar: { network: 'mainnet' as const, horizonUrl: 'https://horizon.stellar.org' },
        };
        const changed = diffConfigs(validConfig, updated);
        expect(changed).toContain('stellar.network');
        expect(changed).toContain('stellar.horizonUrl');
    });

    it('detects multiple simultaneous changes across sections', () => {
        const updated: CustomizationConfig = {
            branding: { ...validConfig.branding, appName: 'X', primaryColor: '#111111' },
            features: { ...validConfig.features, enableAnalytics: false },
            stellar: { ...validConfig.stellar, network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' },
        };
        const changed = diffConfigs(validConfig, updated);
        expect(changed).toContain('branding.appName');
        expect(changed).toContain('branding.primaryColor');
        expect(changed).toContain('features.enableAnalytics');
        expect(changed).toContain('stellar.network');
        expect(changed).toContain('stellar.horizonUrl');
    });

    it('detects addition of an optional field (logoUrl)', () => {
        const updated = {
            ...validConfig,
            branding: { ...validConfig.branding, logoUrl: 'https://example.com/logo.png' },
        };
        const changed = diffConfigs(validConfig, updated);
        expect(changed).toContain('branding.logoUrl');
    });
});

// ── PreviewService.generatePreview ────────────────────────────────────────────

describe('PreviewService.generatePreview', () => {
    let service: PreviewService;

    beforeEach(() => {
        service = new PreviewService();
    });

    // ── Full generation ────────────────────────────────────────────────────────

    it('returns a preview with the correct templateId and templateName', () => {
        const preview = service.generatePreview(makeTemplate());
        expect(preview.templateId).toBe('tpl-dex');
        expect(preview.templateName).toBe('Stellar DEX');
    });

    it('includes the template previewImageUrl unchanged', () => {
        const preview = service.generatePreview(makeTemplate());
        expect(preview.previewImageUrl).toBe('https://cdn.example.com/dex-preview.jpg');
    });

    it('generates a valid preview from template defaults alone (no saved config)', () => {
        const preview = service.generatePreview(makeTemplate());
        expect(preview.isValid).toBe(true);
        expect(preview.validationErrors).toEqual([]);
    });

    it('customization output contains all three sections', () => {
        const preview = service.generatePreview(makeTemplate());
        expect(preview.customization).toHaveProperty('branding');
        expect(preview.customization).toHaveProperty('features');
        expect(preview.customization).toHaveProperty('stellar');
    });

    it('reflects template schema feature defaults in enabledFeatures / disabledFeatures', () => {
        const preview = service.generatePreview(makeTemplate());
        // Schema defaults: enableCharts=true, enableTransactionHistory=true, others=false
        expect(preview.enabledFeatures).toContain('enableCharts');
        expect(preview.enabledFeatures).toContain('enableTransactionHistory');
        expect(preview.disabledFeatures).toContain('enableAnalytics');
        expect(preview.disabledFeatures).toContain('enableNotifications');
    });

    // ── Branding overlay ───────────────────────────────────────────────────────

    it('overlays branding from saved config onto template defaults', () => {
        const saved: Partial<CustomizationConfig> = {
            branding: {
                appName: 'Custom DEX',
                primaryColor: '#ff0000',
                secondaryColor: '#00ff00',
                fontFamily: 'Roboto',
            },
        };
        const preview = service.generatePreview(makeTemplate(), saved);
        expect(preview.customization.branding.appName).toBe('Custom DEX');
        expect(preview.customization.branding.primaryColor).toBe('#ff0000');
        expect(preview.customization.branding.fontFamily).toBe('Roboto');
    });

    it('preserves template default branding fields not present in saved config', () => {
        const saved: Partial<CustomizationConfig> = {
            branding: { appName: 'Partial', primaryColor: '#abc', secondaryColor: '#def', fontFamily: 'Inter' },
        };
        const preview = service.generatePreview(makeTemplate(), saved);
        // stellar and features should still come from template defaults
        expect(preview.customization.stellar.network).toBe('testnet');
        expect(preview.customization.features.enableCharts).toBe(true);
    });

    // ── Feature overlay ────────────────────────────────────────────────────────

    it('reflects feature toggles from saved config in enabledFeatures', () => {
        const saved: Partial<CustomizationConfig> = {
            branding: validConfig.branding,
            features: {
                enableCharts: false,
                enableTransactionHistory: true,
                enableAnalytics: true,
                enableNotifications: true,
            },
            stellar: validConfig.stellar,
        };
        const preview = service.generatePreview(makeTemplate(), saved);
        expect(preview.enabledFeatures).toContain('enableAnalytics');
        expect(preview.enabledFeatures).toContain('enableNotifications');
        expect(preview.disabledFeatures).toContain('enableCharts');
    });

    it('enabledFeatures and disabledFeatures are mutually exclusive', () => {
        const preview = service.generatePreview(makeTemplate(), validConfig);
        const overlap = preview.enabledFeatures.filter((f) =>
            preview.disabledFeatures.includes(f)
        );
        expect(overlap).toHaveLength(0);
    });

    it('enabledFeatures + disabledFeatures covers all four feature keys', () => {
        const preview = service.generatePreview(makeTemplate(), validConfig);
        const all = [...preview.enabledFeatures, ...preview.disabledFeatures].sort();
        expect(all).toEqual(
            ['enableAnalytics', 'enableCharts', 'enableNotifications', 'enableTransactionHistory'].sort()
        );
    });

    // ── Stellar overlay ────────────────────────────────────────────────────────

    it('overlays stellar config from saved config', () => {
        const saved: Partial<CustomizationConfig> = {
            branding: validConfig.branding,
            features: validConfig.features,
            stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' },
        };
        const preview = service.generatePreview(makeTemplate(), saved);
        expect(preview.customization.stellar.network).toBe('mainnet');
        expect(preview.customization.stellar.horizonUrl).toBe('https://horizon.stellar.org');
    });

    // ── Validation in preview ──────────────────────────────────────────────────

    it('marks preview invalid when saved config has empty appName', () => {
        const saved: Partial<CustomizationConfig> = {
            branding: { appName: '', primaryColor: '#000', secondaryColor: '#fff', fontFamily: 'Inter' },
            features: validConfig.features,
            stellar: validConfig.stellar,
        };
        const preview = service.generatePreview(makeTemplate(), saved);
        expect(preview.isValid).toBe(false);
        expect(preview.validationErrors.some((e) => e.field === 'branding.appName')).toBe(true);
    });

    it('marks preview invalid on HORIZON_NETWORK_MISMATCH', () => {
        const saved: Partial<CustomizationConfig> = {
            branding: validConfig.branding,
            features: validConfig.features,
            stellar: { network: 'mainnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
        };
        const preview = service.generatePreview(makeTemplate(), saved);
        expect(preview.isValid).toBe(false);
        expect(preview.validationErrors[0].code).toBe('HORIZON_NETWORK_MISMATCH');
    });

    it('marks preview invalid on DUPLICATE_COLORS', () => {
        const saved: Partial<CustomizationConfig> = {
            branding: { appName: 'DEX', primaryColor: '#abc', secondaryColor: '#abc', fontFamily: 'Inter' },
            features: validConfig.features,
            stellar: validConfig.stellar,
        };
        const preview = service.generatePreview(makeTemplate(), saved);
        expect(preview.isValid).toBe(false);
        expect(preview.validationErrors[0].code).toBe('DUPLICATE_COLORS');
    });

    // ── Null / undefined saved config ──────────────────────────────────────────

    it('handles null savedConfig gracefully', () => {
        const preview = service.generatePreview(makeTemplate(), null);
        expect(preview.isValid).toBe(true);
        expect(preview.customization.branding.appName).toBe('');
    });

    it('handles undefined savedConfig gracefully', () => {
        const preview = service.generatePreview(makeTemplate(), undefined);
        expect(preview.isValid).toBe(true);
    });

    // ── Template-specific edge cases ───────────────────────────────────────────

    it('handles a lending template with all features disabled by default', () => {
        const lendingTemplate = makeTemplate({
            id: 'tpl-lending',
            name: 'Lending Protocol',
            category: 'lending',
            customizationSchema: {
                ...makeTemplate().customizationSchema,
                features: {
                    enableCharts: { type: 'boolean', default: false },
                    enableTransactionHistory: { type: 'boolean', default: false },
                    enableAnalytics: { type: 'boolean', default: false },
                    enableNotifications: { type: 'boolean', default: false },
                },
            },
        });
        const preview = service.generatePreview(lendingTemplate);
        expect(preview.enabledFeatures).toHaveLength(0);
        expect(preview.disabledFeatures).toHaveLength(4);
    });

    it('handles a payment template with all features enabled by default', () => {
        const paymentTemplate = makeTemplate({
            id: 'tpl-payment',
            name: 'Payment Gateway',
            category: 'payment',
            customizationSchema: {
                ...makeTemplate().customizationSchema,
                features: {
                    enableCharts: { type: 'boolean', default: true },
                    enableTransactionHistory: { type: 'boolean', default: true },
                    enableAnalytics: { type: 'boolean', default: true },
                    enableNotifications: { type: 'boolean', default: true },
                },
            },
        });
        const preview = service.generatePreview(paymentTemplate);
        expect(preview.enabledFeatures).toHaveLength(4);
        expect(preview.disabledFeatures).toHaveLength(0);
    });

    it('preserves optional logoUrl when provided in saved config', () => {
        const saved: Partial<CustomizationConfig> = {
            branding: {
                ...validConfig.branding,
                logoUrl: 'https://example.com/logo.png',
            },
            features: validConfig.features,
            stellar: validConfig.stellar,
        };
        const preview = service.generatePreview(makeTemplate(), saved);
        expect(preview.customization.branding.logoUrl).toBe('https://example.com/logo.png');
    });

    it('does not include logoUrl when not provided', () => {
        const preview = service.generatePreview(makeTemplate(), validConfig);
        expect(preview.customization.branding.logoUrl).toBeUndefined();
    });

    it('does not make any network calls (pure transformation)', () => {
        // If this test completes without hanging, no network access occurred.
        // The service is entirely synchronous/pure — no fetch, no supabase.
        const preview = service.generatePreview(makeTemplate(), validConfig);
        expect(preview).toBeDefined();
    });
});

// ── PreviewService.applyUpdate ────────────────────────────────────────────────

describe('PreviewService.applyUpdate', () => {
    let service: PreviewService;

    beforeEach(() => {
        service = new PreviewService();
    });

    // ── Partial branding update ────────────────────────────────────────────────

    it('applies a partial branding update and reports changed fields', () => {
        const result = service.applyUpdate(validConfig, {
            branding: { ...validConfig.branding, appName: 'Updated DEX' },
        });
        expect(result.updated.branding.appName).toBe('Updated DEX');
        expect(result.changedFields).toContain('branding.appName');
    });

    it('preserves unchanged branding fields after partial update', () => {
        const result = service.applyUpdate(validConfig, {
            branding: { ...validConfig.branding, appName: 'New Name' },
        });
        expect(result.updated.branding.primaryColor).toBe(validConfig.branding.primaryColor);
        expect(result.updated.branding.fontFamily).toBe(validConfig.branding.fontFamily);
    });

    // ── Partial feature update ─────────────────────────────────────────────────

    it('applies a single feature toggle and reports only that field as changed', () => {
        const result = service.applyUpdate(validConfig, {
            features: { ...validConfig.features, enableCharts: false },
        });
        expect(result.updated.features.enableCharts).toBe(false);
        expect(result.changedFields).toContain('features.enableCharts');
        expect(result.changedFields).not.toContain('features.enableAnalytics');
    });

    it('preserves unchanged feature flags after partial update', () => {
        const result = service.applyUpdate(validConfig, {
            features: { ...validConfig.features, enableNotifications: true },
        });
        expect(result.updated.features.enableCharts).toBe(validConfig.features.enableCharts);
        expect(result.updated.features.enableTransactionHistory).toBe(
            validConfig.features.enableTransactionHistory
        );
    });

    // ── Partial stellar update ─────────────────────────────────────────────────

    it('applies a stellar network switch and reports both network and horizonUrl as changed', () => {
        const result = service.applyUpdate(validConfig, {
            stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' },
        });
        expect(result.updated.stellar.network).toBe('mainnet');
        expect(result.changedFields).toContain('stellar.network');
        expect(result.changedFields).toContain('stellar.horizonUrl');
    });

    // ── No-op update ───────────────────────────────────────────────────────────

    it('reports no changed fields when patch is identical to current', () => {
        const result = service.applyUpdate(validConfig, validConfig);
        expect(result.changedFields).toHaveLength(0);
        expect(result.isValid).toBe(true);
    });

    // ── previous / updated contract ───────────────────────────────────────────

    it('previous always reflects the original config', () => {
        const result = service.applyUpdate(validConfig, {
            branding: { ...validConfig.branding, appName: 'Changed' },
        });
        expect(result.previous.branding.appName).toBe(validConfig.branding.appName);
    });

    it('updated reflects the merged result', () => {
        const result = service.applyUpdate(validConfig, {
            branding: { ...validConfig.branding, appName: 'Changed' },
        });
        expect(result.updated.branding.appName).toBe('Changed');
    });

    // ── Validation after update ────────────────────────────────────────────────

    it('marks result invalid when update introduces an empty appName', () => {
        const result = service.applyUpdate(validConfig, {
            branding: { ...validConfig.branding, appName: '' },
        });
        expect(result.isValid).toBe(false);
        expect(result.validationErrors.some((e) => e.field === 'branding.appName')).toBe(true);
    });

    it('marks result invalid on HORIZON_NETWORK_MISMATCH after update', () => {
        const result = service.applyUpdate(validConfig, {
            stellar: { network: 'mainnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
        });
        expect(result.isValid).toBe(false);
        expect(result.validationErrors[0].code).toBe('HORIZON_NETWORK_MISMATCH');
    });

    it('marks result invalid on DUPLICATE_COLORS after update', () => {
        const result = service.applyUpdate(validConfig, {
            branding: { ...validConfig.branding, secondaryColor: validConfig.branding.primaryColor },
        });
        expect(result.isValid).toBe(false);
        expect(result.validationErrors[0].code).toBe('DUPLICATE_COLORS');
    });

    it('marks result valid when update fixes a previously invalid config', () => {
        const invalid: CustomizationConfig = {
            ...validConfig,
            branding: { ...validConfig.branding, primaryColor: '#abc', secondaryColor: '#abc' },
        };
        const result = service.applyUpdate(invalid, {
            branding: { ...invalid.branding, secondaryColor: '#def' },
        });
        expect(result.isValid).toBe(true);
        expect(result.validationErrors).toHaveLength(0);
    });

    // ── Multi-section update ───────────────────────────────────────────────────

    it('applies updates across all three sections simultaneously', () => {
        const result = service.applyUpdate(validConfig, {
            branding: { ...validConfig.branding, appName: 'Multi Update' },
            features: { ...validConfig.features, enableAnalytics: false },
            stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' },
        });
        expect(result.updated.branding.appName).toBe('Multi Update');
        expect(result.updated.features.enableAnalytics).toBe(false);
        expect(result.updated.stellar.network).toBe('mainnet');
        expect(result.changedFields).toContain('branding.appName');
        expect(result.changedFields).toContain('features.enableAnalytics');
        expect(result.changedFields).toContain('stellar.network');
    });

    // ── Transformed output includes branding and feature changes ──────────────

    it('transformed output always includes all branding fields', () => {
        const result = service.applyUpdate(validConfig, {
            branding: { ...validConfig.branding, appName: 'Assert Branding' },
        });
        const b = result.updated.branding;
        expect(b.appName).toBeDefined();
        expect(b.primaryColor).toBeDefined();
        expect(b.secondaryColor).toBeDefined();
        expect(b.fontFamily).toBeDefined();
    });

    it('transformed output always includes all feature flags', () => {
        const result = service.applyUpdate(validConfig, {});
        const f = result.updated.features;
        expect(typeof f.enableCharts).toBe('boolean');
        expect(typeof f.enableTransactionHistory).toBe('boolean');
        expect(typeof f.enableAnalytics).toBe('boolean');
        expect(typeof f.enableNotifications).toBe('boolean');
    });

    describe('updatePreview', () => {
        it('merges partial changes into current customization', () => {
            const current = mainnetConfig;
            const changes = {
                branding: {
                    appName: 'Updated DEX',
                },
            };

            const result = service.updatePreview(current, changes);

            expect(result.customization.branding.appName).toBe('Updated DEX');
            expect(result.customization.branding.primaryColor).toBe(current.branding.primaryColor);
            expect(result.customization.stellar.network).toBe(current.stellar.network);
        });

        it('detects changed fields', () => {
            const current = mainnetConfig;
            const changes = {
                branding: {
                    appName: 'New Name',
                    primaryColor: '#ff0000',
                },
            };

            const result = service.updatePreview(current, changes);

            expect(result.changedFields).toContain('branding.appName');
            expect(result.changedFields).toContain('branding.primaryColor');
            expect(result.changedFields.length).toBe(2);
        });

        it('does not include unchanged fields in changedFields', () => {
            const current = mainnetConfig;
            const changes = {
                branding: {
                    appName: mainnetConfig.branding.appName,
                },
            };

            const result = service.updatePreview(current, changes);

            expect(result.changedFields).not.toContain('branding.appName');
        });

        it('does not regenerate mock data for branding changes', () => {
            const current = mainnetConfig;
            const changes = {
                branding: {
                    appName: 'Updated',
                    primaryColor: '#ff0000',
                },
            };

            const result = service.updatePreview(current, changes);

            expect(result.mockData).toBeUndefined();
            expect(result.changedFields).toContain('branding.appName');
        });

        it('does not regenerate mock data for feature changes', () => {
            const current = mainnetConfig;
            const changes = {
                features: {
                    enableCharts: false,
                },
            };

            const result = service.updatePreview(current, changes);

            expect(result.mockData).toBeUndefined();
            expect(result.changedFields).toContain('features.enableCharts');
        });

        it('regenerates mock data when network changes', () => {
            const current = mainnetConfig;
            const changes = {
                stellar: {
                    network: 'testnet' as const,
                    horizonUrl: 'https://horizon-testnet.stellar.org',
                },
            };

            const result = service.updatePreview(current, changes);

            expect(result.mockData).toBeDefined();
            expect(result.changedFields).toContain('stellar.network');
            expect(result.customization.stellar.network).toBe('testnet');
        });

        it('does not regenerate mock data for horizon URL change only', () => {
            const current = mainnetConfig;
            const changes = {
                stellar: {
                    horizonUrl: 'https://custom-horizon.stellar.org',
                },
            };

            const result = service.updatePreview(current, changes);

            expect(result.mockData).toBeUndefined();
            expect(result.changedFields).toContain('stellar.horizonUrl');
        });

        it('handles multiple field changes across sections', () => {
            const current = mainnetConfig;
            const changes = {
                branding: {
                    appName: 'Multi Update',
                },
                features: {
                    enableAnalytics: true,
                },
                stellar: {
                    sorobanRpcUrl: 'https://soroban-rpc.stellar.org',
                },
            };

            const result = service.updatePreview(current, changes);

            expect(result.changedFields).toContain('branding.appName');
            expect(result.changedFields).toContain('features.enableAnalytics');
            expect(result.changedFields).toContain('stellar.sorobanRpcUrl');
            expect(result.changedFields.length).toBe(3);
        });

        it('returns valid timestamp', () => {
            const current = mainnetConfig;
            const changes = { branding: { appName: 'Test' } };

            const result = service.updatePreview(current, changes);

            expect(result.timestamp).toBeDefined();
            expect(new Date(result.timestamp)).toBeInstanceOf(Date);
        });

        it('handles empty changes object', () => {
            const current = mainnetConfig;
            const changes = {};

            const result = service.updatePreview(current, changes);

            expect(result.customization).toEqual(current);
            expect(result.changedFields).toEqual([]);
            expect(result.mockData).toBeUndefined();
        });

        it('preserves all fields when updating single field', () => {
            const current = testnetConfig;
            const changes = {
                branding: {
                    primaryColor: '#123456',
                },
            };

            const result = service.updatePreview(current, changes);

            expect(result.customization.branding.appName).toBe(current.branding.appName);
            expect(result.customization.branding.secondaryColor).toBe(
                current.branding.secondaryColor
            );
            expect(result.customization.features).toEqual(current.features);
            expect(result.customization.stellar).toEqual(current.stellar);
        });

        it('network change from mainnet to testnet regenerates appropriate mock data', () => {
            const current = mainnetConfig;
            const changes = {
                stellar: {
                    network: 'testnet' as const,
                    horizonUrl: 'https://horizon-testnet.stellar.org',
                },
            };

            const result = service.updatePreview(current, changes);

            expect(result.mockData).toBeDefined();
            // Balance should be in testnet range (5000-6000)
            const balance = parseFloat(result.mockData!.accountBalance);
            expect(balance).toBeGreaterThanOrEqual(5000);
            expect(balance).toBeLessThanOrEqual(6000);
            expect(result.mockData!.assetPrices.XLM).toBe(0.10);
        });

        it('network change from testnet to mainnet regenerates appropriate mock data', () => {
            const current = testnetConfig;
            const changes = {
                stellar: {
                    network: 'mainnet' as const,
                    horizonUrl: 'https://horizon.stellar.org',
                },
            };

            const result = service.updatePreview(current, changes);

            expect(result.mockData).toBeDefined();
            // Balance should be in mainnet range (10000-11000)
            const balance = parseFloat(result.mockData!.accountBalance);
            expect(balance).toBeGreaterThanOrEqual(10000);
            expect(balance).toBeLessThanOrEqual(11000);
            expect(result.mockData!.assetPrices.XLM).toBe(0.12);
        });
    });
});
