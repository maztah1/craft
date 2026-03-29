import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { corsHeaders, handlePreflight, getAllowedOrigins } from './cors';

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try { fn(); } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

describe('corsHeaders', () => {
    it('returns ACAO header for an allowed origin', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app', NODE_ENV: 'production' }, () => {
            const headers = corsHeaders('https://craft.app');
            expect(headers['Access-Control-Allow-Origin']).toBe('https://craft.app');
        });
    });

    it('sets Vary: Origin when origin is allowed', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app', NODE_ENV: 'production' }, () => {
            expect(corsHeaders('https://craft.app')['Vary']).toBe('Origin');
        });
    });

    it('omits ACAO header for a disallowed origin', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app', NODE_ENV: 'production' }, () => {
            const headers = corsHeaders('https://evil.example.com');
            expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
        });
    });

    it('omits ACAO header when origin is null', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app', NODE_ENV: 'production' }, () => {
            expect(corsHeaders(null)['Access-Control-Allow-Origin']).toBeUndefined();
        });
    });

    it('always allows localhost:3000 in development', () => {
        withEnv({ ALLOWED_ORIGINS: undefined, NODE_ENV: 'development' }, () => {
            expect(corsHeaders('http://localhost:3000')['Access-Control-Allow-Origin'])
                .toBe('http://localhost:3000');
        });
    });

    it('does NOT allow localhost:3000 in production unless explicitly listed', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app', NODE_ENV: 'production' }, () => {
            expect(corsHeaders('http://localhost:3000')['Access-Control-Allow-Origin'])
                .toBeUndefined();
        });
    });

    it('always includes Allow-Methods and Allow-Headers', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app', NODE_ENV: 'production' }, () => {
            const headers = corsHeaders('https://craft.app');
            expect(headers['Access-Control-Allow-Methods']).toBeTruthy();
            expect(headers['Access-Control-Allow-Headers']).toBeTruthy();
        });
    });

    it('supports multiple allowed origins from env', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app,https://www.craft.app', NODE_ENV: 'production' }, () => {
            expect(corsHeaders('https://www.craft.app')['Access-Control-Allow-Origin'])
                .toBe('https://www.craft.app');
        });
    });
});

describe('handlePreflight', () => {
    it('returns 204 for an allowed origin', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app', NODE_ENV: 'production' }, () => {
            const req = { headers: { get: (h: string) => h === 'origin' ? 'https://craft.app' : null } };
            const res = handlePreflight(req);
            expect(res.status).toBe(204);
            expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://craft.app');
        });
    });

    it('returns 204 even for an unknown origin (does not leak info)', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app', NODE_ENV: 'production' }, () => {
            const req = { headers: { get: (h: string) => h === 'origin' ? 'https://attacker.com' : null } };
            const res = handlePreflight(req);
            expect(res.status).toBe(204);
            expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
        });
    });

    it('returns 204 with no ACAO when origin header is absent', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app', NODE_ENV: 'production' }, () => {
            const req = { headers: { get: () => null } };
            const res = handlePreflight(req);
            expect(res.status).toBe(204);
            expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
        });
    });
});
