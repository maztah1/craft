import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { AuthService } from './auth.service';

// --- Supabase mock ---
const mockSignUp = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockProfileInsert = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: {
            signUp: mockSignUp,
            signInWithPassword: mockSignInWithPassword,
        },
        from: (_table: string) => ({ insert: mockProfileInsert }),
    }),
}));

// --- Arbitraries for invalid credentials ---

/** Malformed emails: missing @, missing domain, empty, whitespace-only, etc. */
const invalidEmail = fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.constant('notanemail'),
    fc.constant('@nodomain.com'),
    fc.constant('noatsign.com'),
    fc.constant('double@@domain.com'),
    fc.constant('missing@'),
    fc.constant('space in@email.com'),
    // random strings that are very unlikely to be valid emails
    fc.string({ minLength: 0, maxLength: 20 }).filter((s) => !s.includes('@') || s.startsWith('@') || s.endsWith('@'))
);

/** Weak / invalid passwords: too short, empty, whitespace-only */
const invalidPassword = fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.constant('short'),          // < 8 chars
    fc.constant('1234567'),        // 7 chars
    fc.string({ minLength: 0, maxLength: 7 }) // any string under 8 chars
);

/** Edge-case credential strings: null bytes, control chars, very long strings */
const edgeCaseCredential = fc.oneof(
    fc.constant('\x00\x01\x02'),
    fc.constant('\n\r\t'),
    fc.string({ minLength: 300, maxLength: 500 }), // excessively long
    fc.constant('SELECT * FROM users; --'),         // SQL injection attempt
    fc.constant('<script>alert(1)</script>'),        // XSS attempt
);

// --- Property 2: invalid credentials are always rejected without side effects ---
describe('Property 2 — invalid credentials are rejected without creating accounts or sessions', () => {
    beforeEach(() => vi.clearAllMocks());

    it('signUp with malformed email always returns error, never a user or session', async () => {
        await fc.assert(
            fc.asyncProperty(invalidEmail, fc.string({ minLength: 8, maxLength: 32 }), async (email, password) => {
                mockSignUp.mockResolvedValue({
                    data: { user: null, session: null },
                    error: { code: 'validation_failed', message: 'Invalid email format' },
                });

                const service = new AuthService();
                const result = await service.signUp(email, password);

                // Property 2 invariants: no account, no session, always an error
                expect(result.user).toBeNull();
                expect(result.session).toBeNull();
                expect(result.error).not.toBeNull();
                expect(mockProfileInsert).not.toHaveBeenCalled();
            }),
            { numRuns: 100 }
        );
    });

    it('signUp with weak password always returns error, never a user or session', async () => {
        await fc.assert(
            fc.asyncProperty(invalidPassword, async (password) => {
                mockSignUp.mockResolvedValue({
                    data: { user: null, session: null },
                    error: { code: 'weak_password', message: 'Password is too weak' },
                });

                const service = new AuthService();
                const result = await service.signUp('valid@example.com', password);

                expect(result.user).toBeNull();
                expect(result.session).toBeNull();
                expect(result.error).not.toBeNull();
                expect(mockProfileInsert).not.toHaveBeenCalled();
            }),
            { numRuns: 100 }
        );
    });

    it('signUp with edge-case credential strings always returns error without side effects', async () => {
        await fc.assert(
            fc.asyncProperty(edgeCaseCredential, edgeCaseCredential, async (email, password) => {
                mockSignUp.mockResolvedValue({
                    data: { user: null, session: null },
                    error: { code: 'invalid_input', message: 'Invalid input' },
                });

                const service = new AuthService();
                const result = await service.signUp(email, password);

                expect(result.user).toBeNull();
                expect(result.session).toBeNull();
                expect(result.error).not.toBeNull();
                expect(mockProfileInsert).not.toHaveBeenCalled();
            }),
            { numRuns: 100 }
        );
    });

    it('signIn with invalid credentials always returns error, never a session', async () => {
        await fc.assert(
            fc.asyncProperty(invalidEmail, invalidPassword, async (email, password) => {
                mockSignInWithPassword.mockResolvedValue({
                    data: { user: null, session: null },
                    error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
                });

                const service = new AuthService();
                const result = await service.signIn(email, password);

                expect(result.user).toBeNull();
                expect(result.session).toBeNull();
                expect(result.error).not.toBeNull();
                // readable message transformation must not expose raw internals
                expect(result.error!.message).toBe('Invalid email or password. Please try again.');
            }),
            { numRuns: 100 }
        );
    });
});
