import { describe, it, expect } from 'vitest';
import { validateCustomizationConfig } from './validate';

const valid = {
    branding: {
        appName: 'My DEX',
        primaryColor: '#6366f1',
        secondaryColor: '#a5b4fc',
        fontFamily: 'Inter',
    },
    features: {
        enableCharts: true,
        enableTransactionHistory: false,
        enableAnalytics: false,
        enableNotifications: false,
    },
    stellar: {
        network: 'testnet' as const,
        horizonUrl: 'https://horizon-testnet.stellar.org',
    },
};

describe('validateCustomizationConfig', () => {
    it('returns valid for a correct config', () => {
        expect(validateCustomizationConfig(valid)).toEqual({ valid: true, errors: [] });
    });

    // ── Schema errors ──────────────────────────────────────────────────────────

    it('returns error when appName is empty', () => {
        const result = validateCustomizationConfig({ ...valid, branding: { ...valid.branding, appName: '' } });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('branding.appName');
        expect(result.errors[0].code).toBeDefined();
    });

    it('returns error when appName exceeds 60 chars', () => {
        const result = validateCustomizationConfig({ ...valid, branding: { ...valid.branding, appName: 'a'.repeat(61) } });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('branding.appName');
    });

    it('returns error for invalid hex color', () => {
        const result = validateCustomizationConfig({ ...valid, branding: { ...valid.branding, primaryColor: 'red' } });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('branding.primaryColor');
        expect(result.errors[0].code).toBe('INVALID_STRING');
    });

    it('returns error for invalid logoUrl', () => {
        const result = validateCustomizationConfig({ ...valid, branding: { ...valid.branding, logoUrl: 'not-a-url' } });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('branding.logoUrl');
    });

    it('returns error for invalid network value', () => {
        const result = validateCustomizationConfig({ ...valid, stellar: { ...valid.stellar, network: 'devnet' as any } });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('stellar.network');
    });

    it('returns error for invalid horizonUrl', () => {
        const result = validateCustomizationConfig({ ...valid, stellar: { ...valid.stellar, horizonUrl: 'not-a-url' } });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('stellar.horizonUrl');
    });

    it('returns error for invalid sorobanRpcUrl', () => {
        const result = validateCustomizationConfig({ ...valid, stellar: { ...valid.stellar, sorobanRpcUrl: 'bad' } });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('stellar.sorobanRpcUrl');
    });

    it('handles null input', () => {
        const result = validateCustomizationConfig(null);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    // ── Business rule errors ───────────────────────────────────────────────────

    it('returns HORIZON_NETWORK_MISMATCH when mainnet + testnet URL', () => {
        const result = validateCustomizationConfig({
            ...valid,
            stellar: { network: 'mainnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe('HORIZON_NETWORK_MISMATCH');
        expect(result.errors[0].field).toBe('stellar.horizonUrl');
    });

    it('returns HORIZON_NETWORK_MISMATCH when testnet + mainnet URL', () => {
        const result = validateCustomizationConfig({
            ...valid,
            stellar: { network: 'testnet', horizonUrl: 'https://horizon.stellar.org' },
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe('HORIZON_NETWORK_MISMATCH');
    });

    it('returns DUPLICATE_COLORS when primary === secondary', () => {
        const result = validateCustomizationConfig({
            ...valid,
            branding: { ...valid.branding, primaryColor: '#abc', secondaryColor: '#abc' },
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe('DUPLICATE_COLORS');
        expect(result.errors[0].field).toBe('branding.secondaryColor');
    });

    it('accepts valid mainnet config', () => {
        const result = validateCustomizationConfig({
            ...valid,
            stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' },
        });
        expect(result.valid).toBe(true);
    });

    // ── Contract address validation ────────────────────────────────────────────

    it('accepts config without contract addresses', () => {
        const result = validateCustomizationConfig(valid);
        expect(result.valid).toBe(true);
    });

    it('accepts config with valid contract addresses', () => {
        const result = validateCustomizationConfig({
            ...valid,
            stellar: {
                ...valid.stellar,
                contractAddresses: {
                    usdcContract: 'CBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7FFWVGNQST',
                    nativeTokenContract: 'CATPNZ2SJRSVZJBWXGFSMZQHQ47JM5PXNQRVJLGHGHVKPZ2OVH3FHXPA',
                },
            },
        });
        expect(result.valid).toBe(true);
    });

    it('returns error for invalid contract address (wrong length)', () => {
        const result = validateCustomizationConfig({
            ...valid,
            stellar: {
                ...valid.stellar,
                contractAddresses: {
                    badContract: 'CBQWI64FZ2NKSJC7D45HJZ',
                },
            },
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('stellar.contractAddresses.badContract');
        expect(result.errors[0].code).toBe('CONTRACT_ADDRESS_INVALID_LENGTH');
    });

    it('returns error for invalid contract address (wrong prefix)', () => {
        const result = validateCustomizationConfig({
            ...valid,
            stellar: {
                ...valid.stellar,
                contractAddresses: {
                    badContract: 'GBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7FFWVGNQST',
                },
            },
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe('CONTRACT_ADDRESS_INVALID_PREFIX');
    });

    it('returns error for contract with invalid characters', () => {
        const result = validateCustomizationConfig({
            ...valid,
            stellar: {
                ...valid.stellar,
                contractAddresses: {
                    badContract: 'CBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7-FWVGNQST',
                },
            },
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe('CONTRACT_ADDRESS_INVALID_CHARSET');
    });
});
