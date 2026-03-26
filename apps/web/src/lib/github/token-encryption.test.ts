/**
 * Tests for lib/github/token-encryption
 *
 * Covers:
 *   - encrypt produces a three-part base64url string
 *   - decrypt round-trips correctly
 *   - each call produces a unique ciphertext (random IV)
 *   - plaintext is not present in the ciphertext
 *   - decryption fails when the ciphertext is tampered
 *   - decryption fails when the auth tag is tampered
 *   - decryption fails with a different key
 *   - missing / short key throws a clear error
 *   - invalid format (wrong number of parts) throws
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptToken, decryptToken } from './token-encryption';

const VALID_KEY = 'a'.repeat(64); // 32 bytes of 0xaa
const TOKEN = 'ghu_test_github_access_token_abc123';

function withKey(key: string | undefined, fn: () => void) {
    const prev = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    if (key === undefined) {
        delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    } else {
        process.env.GITHUB_TOKEN_ENCRYPTION_KEY = key;
    }
    try {
        fn();
    } finally {
        if (prev === undefined) {
            delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
        } else {
            process.env.GITHUB_TOKEN_ENCRYPTION_KEY = prev;
        }
    }
}

describe('token-encryption', () => {
    beforeEach(() => {
        process.env.GITHUB_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    });

    afterEach(() => {
        delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    });

    it('encryptToken returns a three-part base64url string', () => {
        const encrypted = encryptToken(TOKEN);
        const parts = encrypted.split('.');
        expect(parts).toHaveLength(3);
        // Each part must be non-empty base64url
        for (const part of parts) {
            expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
        }
    });

    it('decryptToken round-trips the original plaintext', () => {
        const encrypted = encryptToken(TOKEN);
        expect(decryptToken(encrypted)).toBe(TOKEN);
    });

    it('each encryption call produces a unique ciphertext (random IV)', () => {
        const a = encryptToken(TOKEN);
        const b = encryptToken(TOKEN);
        expect(a).not.toBe(b);
    });

    it('plaintext is not present in the encrypted output', () => {
        const encrypted = encryptToken(TOKEN);
        expect(encrypted).not.toContain(TOKEN);
        // Also check the raw base64url of the plaintext is not present
        expect(encrypted).not.toContain(Buffer.from(TOKEN).toString('base64url'));
    });

    it('decryption fails when the ciphertext part is tampered', () => {
        const [iv, , tag] = encryptToken(TOKEN).split('.');
        const tampered = [iv, 'AAAAAAAAAAAAAAAA', tag].join('.');
        expect(() => decryptToken(tampered)).toThrow();
    });

    it('decryption fails when the auth tag is tampered', () => {
        const [iv, ciphertext] = encryptToken(TOKEN).split('.');
        const tampered = [iv, ciphertext, 'AAAAAAAAAAAAAAAAAAAAAA'].join('.');
        expect(() => decryptToken(tampered)).toThrow();
    });

    it('decryption fails when a different key is used', () => {
        const encrypted = encryptToken(TOKEN);
        withKey('b'.repeat(64), () => {
            expect(() => decryptToken(encrypted)).toThrow();
        });
    });

    it('throws a clear error when GITHUB_TOKEN_ENCRYPTION_KEY is missing', () => {
        withKey(undefined, () => {
            expect(() => encryptToken(TOKEN)).toThrow(/GITHUB_TOKEN_ENCRYPTION_KEY/);
        });
    });

    it('throws a clear error when GITHUB_TOKEN_ENCRYPTION_KEY is too short', () => {
        withKey('abc', () => {
            expect(() => encryptToken(TOKEN)).toThrow(/GITHUB_TOKEN_ENCRYPTION_KEY/);
        });
    });

    it('decryptToken throws on invalid format (wrong number of parts)', () => {
        expect(() => decryptToken('onlyone')).toThrow('Invalid encrypted token format');
        expect(() => decryptToken('two.parts')).toThrow('Invalid encrypted token format');
    });

    it('encrypts and decrypts tokens containing special characters', () => {
        const special = 'ghu_abc/def+xyz==\n\t';
        const encrypted = encryptToken(special);
        expect(decryptToken(encrypted)).toBe(special);
    });
});
