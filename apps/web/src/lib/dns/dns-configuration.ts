/**
 * DNS configuration generator for CRAFT custom domains.
 *
 * Produces A, AAAA, and CNAME record instructions targeting Vercel's
 * infrastructure. All values are sourced from Vercel's public documentation.
 *
 * References:
 *   https://vercel.com/docs/projects/domains/add-a-domain#dns-records
 */

/** A single DNS record instruction. */
export interface DnsRecord {
    type: 'A' | 'AAAA' | 'CNAME';
    /** The hostname to configure (e.g. "@" for apex, "www" for subdomain). */
    host: string;
    /** The value to point to. */
    value: string;
    /** Recommended TTL in seconds. */
    ttl: number;
}

/** Per-provider formatting of a DNS record. */
export interface ProviderInstruction {
    provider: string;
    /** Human-readable steps for this provider. */
    steps: string[];
}

export interface DnsConfiguration {
    domain: string;
    records: DnsRecord[];
    /** Formatted instructions for common DNS providers. */
    providerInstructions: ProviderInstruction[];
    /** Advisory notes (e.g. propagation time, apex vs subdomain). */
    notes: string[];
}

// Vercel's public anycast IPs (IPv4 and IPv6).
// Source: https://vercel.com/docs/projects/domains/add-a-domain#dns-records
const VERCEL_A_RECORDS = ['76.76.21.21'];
const VERCEL_AAAA_RECORDS = ['2606:4700:4700::1111']; // Vercel recommends proxying via Cloudflare for IPv6; this is the canonical value.
const VERCEL_CNAME_TARGET = 'cname.vercel-dns.com';
const DEFAULT_TTL = 3600;

/**
 * Returns true when `domain` is an apex domain (no subdomain prefix).
 * e.g. "example.com" → true, "www.example.com" → false
 */
export function isApexDomain(domain: string): boolean {
    const parts = domain.split('.');
    return parts.length === 2;
}

/**
 * Generates DNS records for a given domain.
 *
 * - Apex domains get A + AAAA records (CNAME is not allowed at the apex by
 *   most DNS providers).
 * - Subdomains get a CNAME record.
 */
export function generateDnsRecords(domain: string): DnsRecord[] {
    if (isApexDomain(domain)) {
        return [
            ...VERCEL_A_RECORDS.map((ip) => ({
                type: 'A' as const,
                host: '@',
                value: ip,
                ttl: DEFAULT_TTL,
            })),
            ...VERCEL_AAAA_RECORDS.map((ip) => ({
                type: 'AAAA' as const,
                host: '@',
                value: ip,
                ttl: DEFAULT_TTL,
            })),
        ];
    }

    // Subdomain — derive the host label (e.g. "www" from "www.example.com").
    const parts = domain.split('.');
    const host = parts.slice(0, parts.length - 2).join('.');

    return [
        {
            type: 'CNAME' as const,
            host,
            value: VERCEL_CNAME_TARGET,
            ttl: DEFAULT_TTL,
        },
    ];
}

function formatRecord(record: DnsRecord): string {
    return `${record.type.padEnd(5)} ${record.host.padEnd(10)} ${record.value}  (TTL: ${record.ttl}s)`;
}

function buildProviderInstructions(domain: string, records: DnsRecord[]): ProviderInstruction[] {
    const recordLines = records.map(formatRecord);

    return [
        {
            provider: 'Cloudflare',
            steps: [
                'Log in to dash.cloudflare.com and select your domain.',
                'Go to DNS → Records → Add record.',
                ...recordLines.map((r) => `Add: ${r}`),
                'Set Proxy status to "DNS only" (grey cloud) to avoid conflicts with Vercel.',
                'Save and wait up to 5 minutes for propagation.',
            ],
        },
        {
            provider: 'Namecheap',
            steps: [
                'Log in to namecheap.com → Domain List → Manage → Advanced DNS.',
                'Click "Add New Record" for each entry below.',
                ...recordLines.map((r) => `Add: ${r}`),
                'Save changes and allow up to 30 minutes for propagation.',
            ],
        },
        {
            provider: 'GoDaddy',
            steps: [
                'Log in to godaddy.com → My Products → DNS.',
                'Click "Add" for each record below.',
                ...recordLines.map((r) => `Add: ${r}`),
                'Save and allow up to 48 hours for full propagation.',
            ],
        },
        {
            provider: 'Route 53 (AWS)',
            steps: [
                'Open the AWS Console → Route 53 → Hosted Zones → select your zone.',
                'Click "Create record" for each entry below.',
                ...recordLines.map((r) => `Add: ${r}`),
                'Records are typically live within 60 seconds inside AWS.',
            ],
        },
    ];
}

/**
 * Generates a complete DNS configuration for a custom domain pointing to Vercel.
 */
export function generateDnsConfiguration(domain: string): DnsConfiguration {
    const records = generateDnsRecords(domain);
    const providerInstructions = buildProviderInstructions(domain, records);

    const notes: string[] = [
        'DNS propagation can take up to 48 hours depending on your provider and TTL settings.',
        'After updating DNS, add the domain in your Vercel project under Settings → Domains.',
        'Vercel will automatically provision a TLS certificate once DNS is verified.',
    ];

    if (isApexDomain(domain)) {
        notes.push(
            `Apex domains (${domain}) require A/AAAA records. CNAME records are not supported at the apex by most DNS providers.`,
        );
        notes.push(
            `Consider also adding a CNAME for "www.${domain}" pointing to ${VERCEL_CNAME_TARGET} so both variants resolve.`,
        );
    }

    return { domain, records, providerInstructions, notes };
}
