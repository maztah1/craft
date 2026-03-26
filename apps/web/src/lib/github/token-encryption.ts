/**
 * GitHub token encryption / decryption
 *
 * Uses AES-256-GCM (authenticated encryption) so any tampering with the
 * ciphertext is detected on decryption.
 *
 * Storage format (all base64url, joined by "."):
 *   <iv>.<ciphertext>.<authTag>
 *
 * Key material:
 *   GITHUB_TOKEN_ENCRYPTION_KEY — 64 hex characters (32 bytes).
 *   Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * The plaintext token is NEVER returned from encrypt(); callers must call
 * decrypt() explicitly and only in server-side contexts.
 *
 * Feature: encrypted-github-token-storage
 * Issue branch: issue-084-store-encrypted-github-tokens-in-the-database
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit IV recommended for GCM
const TAG_BYTES = 16;

function getKey(): Buffer {
    const hex = process.env.GITHUB_TOKEN_ENCRYPTION_KEY ?? '';
    if (hex.length !== 64) {
        throw new Error(
            'GITHUB_TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
            'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        );
    }
    return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a GitHub access token for database storage.
 * Returns an opaque string safe to store in `github_token_encrypted`.
 */
export function encryptToken(plaintext: string): string {
    const key = getKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
        iv.toString('base64url'),
        ciphertext.toString('base64url'),
        tag.toString('base64url'),
    ].join('.');
}

/**
 * Decrypts a stored token produced by encryptToken().
 * Throws if the ciphertext has been tampered with or the key is wrong.
 */
export function decryptToken(stored: string): string {
    const parts = stored.split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted token format');
    }

    const [ivB64, ciphertextB64, tagB64] = parts;
    const key = getKey();
    const iv = Buffer.from(ivB64, 'base64url');
    const ciphertext = Buffer.from(ciphertextB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');

    if (tag.length !== TAG_BYTES) {
        throw new Error('Invalid auth tag length');
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]).toString('utf8');
}
