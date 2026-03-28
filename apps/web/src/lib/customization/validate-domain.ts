/**
 * Custom Domain Validation
 *
 * Validates custom domain inputs against DNS format requirements before
 * configuration. Rejects reserved domains, localhost patterns, and inputs
 * that would be unsafe or invalid in a DNS context.
 */

export type DomainValidationResult =
    | { valid: true; domain: string }
    | { valid: false; field: string; message: string; code: DomainValidationErrorCode };

export type DomainValidationErrorCode =
    | 'DOMAIN_EMPTY'
    | 'DOMAIN_TOO_LONG'
    | 'DOMAIN_INVALID_FORMAT'
    | 'DOMAIN_INVALID_LABEL'
    | 'DOMAIN_MISSING_TLD'
    | 'DOMAIN_RESERVED'
    | 'DOMAIN_LOCALHOST';

// RFC 1035 label: 1–63 chars, alphanumeric + hyphens, no leading/trailing hyphen
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

// Domains that must never be accepted as custom domains
const RESERVED_TLDS = new Set(['localhost', 'local', 'internal', 'invalid', 'test', 'example']);

const RESERVED_DOMAINS = new Set([
    'localhost',
    'example.com',
    'example.org',
    'example.net',
    'test.com',
]);

/**
 * Validate a custom domain string.
 *
 * Rules applied (in order):
 * 1. Must be non-empty
 * 2. Total length ≤ 253 characters (DNS limit)
 * 3. No scheme, path, port, or whitespace — bare hostname only
 * 4. Each label must match RFC 1035 (1–63 chars, alphanumeric + hyphens)
 * 5. Must have at least two labels (i.e. a TLD is required)
 * 6. TLD must not be a reserved/special-use TLD (RFC 2606 / RFC 6761)
 * 7. Full domain must not be a reserved domain
 * 8. Must not be a localhost pattern (127.x.x.x, ::1, *.localhost)
 *
 * @param input - Raw domain string from user input
 * @param field - Field name to include in error (default: "customDomain")
 * @returns Validation result with normalised domain on success
 */
export function validateCustomDomain(
    input: unknown,
    field = 'customDomain',
): DomainValidationResult {
    if (!input || typeof input !== 'string' || input.trim() === '') {
        return {
            valid: false,
            field,
            message: 'Domain is required. Enter a domain like "app.example.com".',
            code: 'DOMAIN_EMPTY',
        };
    }

    const raw = input.trim().toLowerCase();

    // Strip a single trailing dot (FQDN notation) for normalisation
    const domain = raw.endsWith('.') ? raw.slice(0, -1) : raw;

    // Loopback IPv6 — check before the format guard since '::1' contains ':'
    if (domain === '::1') {
        return {
            valid: false,
            field,
            message: 'Localhost and loopback addresses cannot be used as custom domains.',
            code: 'DOMAIN_LOCALHOST',
        };
    }

    // Reject anything that looks like a URL or contains unsafe characters
    if (/[/:?#@\s]/.test(domain)) {
        return {
            valid: false,
            field,
            message:
                'Enter a bare domain name without a scheme, path, or port (e.g. "app.example.com").',
            code: 'DOMAIN_INVALID_FORMAT',
        };
    }

    if (domain.length > 253) {
        return {
            valid: false,
            field,
            message: `Domain must be 253 characters or fewer (got ${domain.length}).`,
            code: 'DOMAIN_TOO_LONG',
        };
    }

    // Localhost / loopback patterns
    if (
        domain === 'localhost' ||
        domain.endsWith('.localhost') ||
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)
    ) {
        return {
            valid: false,
            field,
            message: 'Localhost and loopback addresses cannot be used as custom domains.',
            code: 'DOMAIN_LOCALHOST',
        };
    }

    const labels = domain.split('.');

    // Validate each DNS label
    for (const label of labels) {
        if (!LABEL_RE.test(label)) {
            return {
                valid: false,
                field,
                message: `"${label}" is not a valid domain label. Labels must be 1–63 characters, start and end with a letter or digit, and contain only letters, digits, or hyphens.`,
                code: 'DOMAIN_INVALID_LABEL',
            };
        }
    }

    // Require at least a second-level domain + TLD
    if (labels.length < 2) {
        return {
            valid: false,
            field,
            message: 'Domain must include a TLD (e.g. "app.example.com").',
            code: 'DOMAIN_MISSING_TLD',
        };
    }

    const tld = labels[labels.length - 1];

    if (RESERVED_TLDS.has(tld)) {
        return {
            valid: false,
            field,
            message: `".${tld}" is a reserved TLD and cannot be used as a custom domain.`,
            code: 'DOMAIN_RESERVED',
        };
    }

    if (RESERVED_DOMAINS.has(domain)) {
        return {
            valid: false,
            field,
            message: `"${domain}" is a reserved domain and cannot be used as a custom domain.`,
            code: 'DOMAIN_RESERVED',
        };
    }

    return { valid: true, domain };
}
