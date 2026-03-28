import { describe, it, expect } from 'vitest';
import { validateCustomDomain } from './validate-domain';

// ── Helpers ───────────────────────────────────────────────────────────────────

function valid(input: unknown) {
    const result = validateCustomDomain(input);
    expect(result.valid, `expected valid for: ${JSON.stringify(input)}`).toBe(true);
    if (result.valid) return result.domain;
}

function invalid(input: unknown, code: string) {
    const result = validateCustomDomain(input);
    expect(result.valid, `expected invalid for: ${JSON.stringify(input)}`).toBe(false);
    if (!result.valid) {
        expect(result.code).toBe(code);
        expect(result.field).toBe('customDomain');
        expect(result.message.length).toBeGreaterThan(0);
    }
}

// ── Valid domains ─────────────────────────────────────────────────────────────

describe('validateCustomDomain – valid inputs', () => {
    it('accepts a simple subdomain', () => {
        expect(valid('app.example.com')).toBe('app.example.com');
    });

    it('accepts a bare second-level domain', () => {
        expect(valid('example.com')).toBe('example.com');
    });

    it('accepts a deep subdomain', () => {
        expect(valid('a.b.c.example.io')).toBe('a.b.c.example.io');
    });

    it('normalises to lowercase', () => {
        expect(valid('App.Example.COM')).toBe('app.example.com');
    });

    it('strips a trailing dot (FQDN notation)', () => {
        expect(valid('app.example.com.')).toBe('app.example.com');
    });

    it('accepts hyphens inside labels', () => {
        expect(valid('my-app.example.com')).toBe('my-app.example.com');
    });

    it('accepts numeric labels', () => {
        expect(valid('123.example.com')).toBe('123.example.com');
    });

    it('accepts a custom field name in the error', () => {
        const result = validateCustomDomain('', 'deployment.customDomain');
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.field).toBe('deployment.customDomain');
    });
});

// ── Empty / missing ───────────────────────────────────────────────────────────

describe('validateCustomDomain – empty / missing', () => {
    it('rejects empty string', () => invalid('', 'DOMAIN_EMPTY'));
    it('rejects whitespace-only string', () => invalid('   ', 'DOMAIN_EMPTY'));
    it('rejects null', () => invalid(null, 'DOMAIN_EMPTY'));
    it('rejects undefined', () => invalid(undefined, 'DOMAIN_EMPTY'));
    it('rejects number', () => invalid(42, 'DOMAIN_EMPTY'));
});

// ── Format errors ─────────────────────────────────────────────────────────────

describe('validateCustomDomain – format errors', () => {
    it('rejects a URL with scheme', () => invalid('https://app.example.com', 'DOMAIN_INVALID_FORMAT'));
    it('rejects a domain with a path', () => invalid('app.example.com/path', 'DOMAIN_INVALID_FORMAT'));
    it('rejects a domain with a port', () => invalid('app.example.com:3000', 'DOMAIN_INVALID_FORMAT'));
    it('rejects a domain with whitespace', () => invalid('app .example.com', 'DOMAIN_INVALID_FORMAT'));
    it('rejects a domain exceeding 253 chars', () => {
        const long = 'a'.repeat(50) + '.' + 'b'.repeat(50) + '.' + 'c'.repeat(50) + '.' + 'd'.repeat(50) + '.com';
        invalid(long, 'DOMAIN_TOO_LONG');
    });
});

// ── Invalid labels ────────────────────────────────────────────────────────────

describe('validateCustomDomain – invalid labels', () => {
    it('rejects a label starting with a hyphen', () => invalid('-app.example.com', 'DOMAIN_INVALID_LABEL'));
    it('rejects a label ending with a hyphen', () => invalid('app-.example.com', 'DOMAIN_INVALID_LABEL'));
    it('rejects an empty label (double dot)', () => invalid('app..example.com', 'DOMAIN_INVALID_LABEL'));
    it('rejects a label with underscore', () => invalid('my_app.example.com', 'DOMAIN_INVALID_LABEL'));
    it('rejects a label with special characters', () => invalid('app!.example.com', 'DOMAIN_INVALID_LABEL'));
    it('rejects a label longer than 63 chars', () => {
        invalid('a'.repeat(64) + '.example.com', 'DOMAIN_INVALID_LABEL');
    });
});

// ── Missing TLD ───────────────────────────────────────────────────────────────

describe('validateCustomDomain – missing TLD', () => {
    it('rejects a bare hostname with no dot', () => invalid('myapp', 'DOMAIN_MISSING_TLD'));
});

// ── Reserved / special-use ────────────────────────────────────────────────────

describe('validateCustomDomain – reserved domains', () => {
    it('rejects .localhost TLD', () => invalid('app.localhost', 'DOMAIN_LOCALHOST'));
    it('rejects bare localhost', () => invalid('localhost', 'DOMAIN_LOCALHOST'));
    it('rejects loopback IPv4', () => invalid('127.0.0.1', 'DOMAIN_LOCALHOST'));
    it('rejects loopback IPv6', () => invalid('::1', 'DOMAIN_LOCALHOST'));
    it('rejects .local TLD', () => invalid('myapp.local', 'DOMAIN_RESERVED'));
    it('rejects .internal TLD', () => invalid('api.internal', 'DOMAIN_RESERVED'));
    it('rejects .invalid TLD', () => invalid('app.invalid', 'DOMAIN_RESERVED'));
    it('rejects .test TLD', () => invalid('app.test', 'DOMAIN_RESERVED'));
    it('rejects .example TLD', () => invalid('app.example', 'DOMAIN_RESERVED'));
    it('rejects example.com', () => invalid('example.com', 'DOMAIN_RESERVED'));
    it('rejects example.org', () => invalid('example.org', 'DOMAIN_RESERVED'));
    it('rejects example.net', () => invalid('example.net', 'DOMAIN_RESERVED'));
    it('rejects test.com', () => invalid('test.com', 'DOMAIN_RESERVED'));
});
