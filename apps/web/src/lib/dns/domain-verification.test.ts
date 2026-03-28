import { describe, it, expect, vi, afterEach } from 'vitest';
import * as dnsPromises from 'node:dns/promises';

// Mock the entire dns/promises module
vi.mock('node:dns/promises', () => ({
    default: {
        resolveTxt: vi.fn(),
        resolveCname: vi.fn(),
    },
}));

import {
    isValidDomain,
    txtHostname,
    verifyViaTxt,
    verifyViaCname,
} from './domain-verification';

const mockDns = dnsPromises.default as {
    resolveTxt: ReturnType<typeof vi.fn>;
    resolveCname: ReturnType<typeof vi.fn>;
};

afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// isValidDomain
// ---------------------------------------------------------------------------
describe('isValidDomain', () => {
    it('accepts a plain domain', () => expect(isValidDomain('example.com')).toBe(true));
    it('accepts a subdomain', () => expect(isValidDomain('www.example.com')).toBe(true));
    it('rejects an empty string', () => expect(isValidDomain('')).toBe(false));
    it('rejects a bare label', () => expect(isValidDomain('localhost')).toBe(false));
    it('rejects a domain with spaces', () => expect(isValidDomain('ex ample.com')).toBe(false));
});

// ---------------------------------------------------------------------------
// txtHostname
// ---------------------------------------------------------------------------
describe('txtHostname', () => {
    it('prefixes with _craft-verify', () => {
        expect(txtHostname('example.com')).toBe('_craft-verify.example.com');
    });
});

// ---------------------------------------------------------------------------
// verifyViaTxt
// ---------------------------------------------------------------------------
describe('verifyViaTxt', () => {
    it('returns verified:true when token is present in TXT records', async () => {
        mockDns.resolveTxt.mockResolvedValue([['craft-token-abc123']]);
        const result = await verifyViaTxt('example.com', 'craft-token-abc123');
        expect(result.verified).toBe(true);
        expect(result.method).toBe('txt');
    });

    it('returns WRONG_VALUE when TXT record exists but token does not match', async () => {
        mockDns.resolveTxt.mockResolvedValue([['some-other-value']]);
        const result = await verifyViaTxt('example.com', 'craft-token-abc123');
        expect(result.verified).toBe(false);
        expect(result.errorCode).toBe('WRONG_VALUE');
        expect(result.recordsFound).toContain('some-other-value');
    });

    it('returns NOT_FOUND when ENOTFOUND', async () => {
        const err = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
        mockDns.resolveTxt.mockRejectedValue(err);
        const result = await verifyViaTxt('example.com', 'token', { retries: 0 });
        expect(result.verified).toBe(false);
        expect(result.errorCode).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when ENODATA', async () => {
        const err = Object.assign(new Error('ENODATA'), { code: 'ENODATA' });
        mockDns.resolveTxt.mockRejectedValue(err);
        const result = await verifyViaTxt('example.com', 'token', { retries: 0 });
        expect(result.errorCode).toBe('NOT_FOUND');
    });

    it('returns TIMEOUT when DNS query times out', async () => {
        mockDns.resolveTxt.mockImplementation(
            () => new Promise((_, reject) => setTimeout(() => reject(new Error('DNS_TIMEOUT')), 10)),
        );
        const result = await verifyViaTxt('example.com', 'token', { timeout: 1, retries: 0 });
        expect(result.errorCode).toBe('TIMEOUT');
    });

    it('returns INVALID_DOMAIN for a bad domain', async () => {
        const result = await verifyViaTxt('not a domain', 'token');
        expect(result.errorCode).toBe('INVALID_DOMAIN');
        expect(mockDns.resolveTxt).not.toHaveBeenCalled();
    });

    it('handles multi-chunk TXT records by joining chunks', async () => {
        mockDns.resolveTxt.mockResolvedValue([['craft-', 'token-abc']]);
        const result = await verifyViaTxt('example.com', 'craft-token-abc');
        expect(result.verified).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// verifyViaCname
// ---------------------------------------------------------------------------
describe('verifyViaCname', () => {
    it('returns verified:true when CNAME points to Vercel target', async () => {
        mockDns.resolveCname.mockResolvedValue(['cname.vercel-dns.com']);
        const result = await verifyViaCname('www.example.com');
        expect(result.verified).toBe(true);
        expect(result.method).toBe('cname');
    });

    it('accepts trailing dot in CNAME value', async () => {
        mockDns.resolveCname.mockResolvedValue(['cname.vercel-dns.com.']);
        const result = await verifyViaCname('www.example.com');
        expect(result.verified).toBe(true);
    });

    it('returns WRONG_VALUE when CNAME points elsewhere', async () => {
        mockDns.resolveCname.mockResolvedValue(['other-target.example.net']);
        const result = await verifyViaCname('www.example.com');
        expect(result.verified).toBe(false);
        expect(result.errorCode).toBe('WRONG_VALUE');
    });

    it('returns NOT_FOUND when ENOTFOUND', async () => {
        const err = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
        mockDns.resolveCname.mockRejectedValue(err);
        const result = await verifyViaCname('www.example.com', { retries: 0 });
        expect(result.errorCode).toBe('NOT_FOUND');
    });

    it('returns INVALID_DOMAIN for apex domains', async () => {
        const result = await verifyViaCname('example.com');
        expect(result.errorCode).toBe('INVALID_DOMAIN');
        expect(mockDns.resolveCname).not.toHaveBeenCalled();
    });

    it('returns INVALID_DOMAIN for a bad domain string', async () => {
        const result = await verifyViaCname('not valid');
        expect(result.errorCode).toBe('INVALID_DOMAIN');
    });

    it('returns TIMEOUT when DNS query times out', async () => {
        mockDns.resolveCname.mockImplementation(
            () => new Promise((_, reject) => setTimeout(() => reject(new Error('DNS_TIMEOUT')), 10)),
        );
        const result = await verifyViaCname('www.example.com', { timeout: 1, retries: 0 });
        expect(result.errorCode).toBe('TIMEOUT');
    });
});
