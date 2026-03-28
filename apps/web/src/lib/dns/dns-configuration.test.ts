import { describe, it, expect } from 'vitest';
import {
    isApexDomain,
    generateDnsRecords,
    generateDnsConfiguration,
} from './dns-configuration';

describe('isApexDomain', () => {
    it('returns true for a two-part domain', () => {
        expect(isApexDomain('example.com')).toBe(true);
    });

    it('returns false for a subdomain', () => {
        expect(isApexDomain('www.example.com')).toBe(false);
    });

    it('returns false for a deeply nested subdomain', () => {
        expect(isApexDomain('app.staging.example.com')).toBe(false);
    });
});

describe('generateDnsRecords', () => {
    it('returns A and AAAA records for an apex domain', () => {
        const records = generateDnsRecords('example.com');
        const types = records.map((r) => r.type);
        expect(types).toContain('A');
        expect(types).toContain('AAAA');
        expect(types).not.toContain('CNAME');
    });

    it('sets host to "@" for apex records', () => {
        const records = generateDnsRecords('example.com');
        expect(records.every((r) => r.host === '@')).toBe(true);
    });

    it('returns a CNAME record for a subdomain', () => {
        const records = generateDnsRecords('www.example.com');
        expect(records).toHaveLength(1);
        expect(records[0].type).toBe('CNAME');
        expect(records[0].host).toBe('www');
        expect(records[0].value).toBe('cname.vercel-dns.com');
    });

    it('derives the correct host label for a multi-segment subdomain', () => {
        const records = generateDnsRecords('app.staging.example.com');
        expect(records[0].host).toBe('app.staging');
    });

    it('all records have a positive TTL', () => {
        for (const domain of ['example.com', 'www.example.com']) {
            const records = generateDnsRecords(domain);
            expect(records.every((r) => r.ttl > 0)).toBe(true);
        }
    });
});

describe('generateDnsConfiguration', () => {
    it('includes the domain in the response', () => {
        const config = generateDnsConfiguration('example.com');
        expect(config.domain).toBe('example.com');
    });

    it('includes provider instructions for Cloudflare, Namecheap, GoDaddy, and Route 53', () => {
        const config = generateDnsConfiguration('example.com');
        const providers = config.providerInstructions.map((p) => p.provider);
        expect(providers).toContain('Cloudflare');
        expect(providers).toContain('Namecheap');
        expect(providers).toContain('GoDaddy');
        expect(providers).toContain('Route 53 (AWS)');
    });

    it('each provider has at least one step', () => {
        const config = generateDnsConfiguration('www.example.com');
        for (const p of config.providerInstructions) {
            expect(p.steps.length).toBeGreaterThan(0);
        }
    });

    it('includes apex-specific notes for apex domains', () => {
        const config = generateDnsConfiguration('example.com');
        const combined = config.notes.join(' ');
        expect(combined).toMatch(/apex/i);
    });

    it('does not include apex notes for subdomains', () => {
        const config = generateDnsConfiguration('www.example.com');
        const combined = config.notes.join(' ');
        expect(combined).not.toMatch(/apex/i);
    });

    it('includes a propagation note', () => {
        const config = generateDnsConfiguration('example.com');
        expect(config.notes.some((n) => /propagation/i.test(n))).toBe(true);
    });
});
