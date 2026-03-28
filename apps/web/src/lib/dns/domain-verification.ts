/**
 * Domain ownership verification via DNS.
 *
 * Supports two verification methods:
 *
 * 1. TXT record  — user adds a TXT record containing the verification token
 *    under the domain root (or `_craft-verify.<domain>`).
 * 2. CNAME record — user adds a CNAME from their subdomain pointing to
 *    `cname.vercel-dns.com` (reuses the DNS config target).
 *
 * Uses Node's built-in `dns.promises` — no extra dependencies.
 */

import dns from 'node:dns/promises';

export type VerificationMethod = 'txt' | 'cname';

export type VerificationErrorCode =
    | 'NOT_FOUND'      // record not present
    | 'WRONG_VALUE'    // record present but value doesn't match
    | 'TIMEOUT'        // DNS query timed out / SERVFAIL
    | 'INVALID_DOMAIN' // domain failed basic validation
    | 'UNKNOWN';

export interface VerificationResult {
    verified: boolean;
    method: VerificationMethod;
    domain: string;
    /** Populated on failure. */
    errorCode?: VerificationErrorCode;
    errorMessage?: string;
    /** The records found during the check (useful for debugging). */
    recordsFound?: string[];
}

export interface VerifyDomainOptions {
    /** Milliseconds before giving up. Default: 5000 */
    timeout?: number;
    /** How many times to retry on transient errors. Default: 2 */
    retries?: number;
}

/** Vercel CNAME target — must match dns-configuration.ts */
const VERCEL_CNAME_TARGET = 'cname.vercel-dns.com';

/** Basic domain sanity check — not a full RFC validator, just guards obvious garbage. */
export function isValidDomain(domain: string): boolean {
    return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain);
}

/**
 * Derives the TXT record hostname for a given domain.
 * We use `_craft-verify.<domain>` to avoid polluting the apex.
 */
export function txtHostname(domain: string): string {
    return `_craft-verify.${domain}`;
}

/**
 * Verify domain ownership via a TXT record.
 *
 * The user must have added a TXT record at `_craft-verify.<domain>` containing
 * exactly the provided `token`.
 */
export async function verifyViaTxt(
    domain: string,
    token: string,
    options: VerifyDomainOptions = {},
): Promise<VerificationResult> {
    if (!isValidDomain(domain)) {
        return {
            verified: false,
            method: 'txt',
            domain,
            errorCode: 'INVALID_DOMAIN',
            errorMessage: `"${domain}" is not a valid domain name`,
        };
    }

    const host = txtHostname(domain);
    const retries = options.retries ?? 2;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const records: string[][] = await withTimeout(
                dns.resolveTxt(host),
                options.timeout ?? 5000,
            );

            // resolveTxt returns string[][] — flatten each entry
            const flat = records.map((chunks) => chunks.join(''));

            if (flat.includes(token)) {
                return { verified: true, method: 'txt', domain, recordsFound: flat };
            }

            return {
                verified: false,
                method: 'txt',
                domain,
                errorCode: 'WRONG_VALUE',
                errorMessage: `TXT record found at ${host} but token not present`,
                recordsFound: flat,
            };
        } catch (err: unknown) {
            const code = (err as NodeJS.ErrnoException).code;

            if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ESERVFAIL') {
                if (attempt < retries && code === 'ESERVFAIL') continue; // retry transient
                return {
                    verified: false,
                    method: 'txt',
                    domain,
                    errorCode: code === 'ESERVFAIL' ? 'TIMEOUT' : 'NOT_FOUND',
                    errorMessage: `No TXT record found at ${host}`,
                };
            }

            if ((err as Error).message === 'DNS_TIMEOUT') {
                if (attempt < retries) continue;
                return {
                    verified: false,
                    method: 'txt',
                    domain,
                    errorCode: 'TIMEOUT',
                    errorMessage: `DNS query timed out after ${options.timeout ?? 5000}ms`,
                };
            }

            return {
                verified: false,
                method: 'txt',
                domain,
                errorCode: 'UNKNOWN',
                errorMessage: (err as Error).message,
            };
        }
    }

    // Should not reach here
    return { verified: false, method: 'txt', domain, errorCode: 'UNKNOWN' };
}

/**
 * Verify domain ownership via CNAME.
 *
 * The CNAME for the subdomain must resolve to `cname.vercel-dns.com`.
 * Not applicable to apex domains (CNAME at apex is forbidden by DNS spec).
 */
export async function verifyViaCname(
    domain: string,
    options: VerifyDomainOptions = {},
): Promise<VerificationResult> {
    if (!isValidDomain(domain)) {
        return {
            verified: false,
            method: 'cname',
            domain,
            errorCode: 'INVALID_DOMAIN',
            errorMessage: `"${domain}" is not a valid domain name`,
        };
    }

    const parts = domain.split('.');
    if (parts.length === 2) {
        return {
            verified: false,
            method: 'cname',
            domain,
            errorCode: 'INVALID_DOMAIN',
            errorMessage: 'CNAME verification is not supported for apex domains — use TXT instead',
        };
    }

    const retries = options.retries ?? 2;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const cname: string = await withTimeout(
                dns.resolveCname(domain),
                options.timeout ?? 5000,
            ).then((r: string[]) => r[0] ?? '');

            // Strip trailing dot if present (DNS canonical form)
            const normalized = cname.replace(/\.$/, '').toLowerCase();

            if (normalized === VERCEL_CNAME_TARGET) {
                return { verified: true, method: 'cname', domain, recordsFound: [cname] };
            }

            return {
                verified: false,
                method: 'cname',
                domain,
                errorCode: 'WRONG_VALUE',
                errorMessage: `CNAME points to "${normalized}", expected "${VERCEL_CNAME_TARGET}"`,
                recordsFound: [cname],
            };
        } catch (err: unknown) {
            const code = (err as NodeJS.ErrnoException).code;

            if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ESERVFAIL') {
                if (attempt < retries && code === 'ESERVFAIL') continue;
                return {
                    verified: false,
                    method: 'cname',
                    domain,
                    errorCode: code === 'ESERVFAIL' ? 'TIMEOUT' : 'NOT_FOUND',
                    errorMessage: `No CNAME record found for ${domain}`,
                };
            }

            if ((err as Error).message === 'DNS_TIMEOUT') {
                if (attempt < retries) continue;
                return {
                    verified: false,
                    method: 'cname',
                    domain,
                    errorCode: 'TIMEOUT',
                    errorMessage: `DNS query timed out after ${options.timeout ?? 5000}ms`,
                };
            }

            return {
                verified: false,
                method: 'cname',
                domain,
                errorCode: 'UNKNOWN',
                errorMessage: (err as Error).message,
            };
        }
    }

    return { verified: false, method: 'cname', domain, errorCode: 'UNKNOWN' };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const id = setTimeout(() => reject(new Error('DNS_TIMEOUT')), ms);
        promise.then(
            (v) => { clearTimeout(id); resolve(v); },
            (e) => { clearTimeout(id); reject(e); },
        );
    });
}
