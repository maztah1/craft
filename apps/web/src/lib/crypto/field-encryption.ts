/**
 * Field-level encryption for sensitive database columns
 *
 * Algorithm: AES-256-GCM (authenticated encryption)
 *   - Provides both confidentiality and integrity — any tampering with the
 *     ciphertext is detected at decryption time via the auth tag.
 *   - 96-bit random IV per encryption call ensures ciphertexts are unique
 *     even for identical plaintexts.
 *
 * Blob format (stored as a single string):
 *   v<version>.<iv_base64url>.<ciphertext_base64url>.<tag_base64url>
 *
 *   - version: 1-digit key version (e.g. "1") — used to identify which key
 *     was used to encrypt the value, enabling gradual key rotation without
 *     downtime.  Increment when rotating keys.
 *   - iv: 12-byte (96-bit) random initialisation vector
 *   - ciphertext: AES-256-GCM encrypted UTF-8 plaintext
 *   - tag: 16-byte GCM authentication tag
 *
 * Key material:
 *   FIELD_ENCRYPTION_KEY — 64 hex characters (32 bytes).
 *   Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 *   For key rotation, add FIELD_ENCRYPTION_KEY_<N> vars (e.g. FIELD_ENCRYPTION_KEY_2)
 *   and update KEY_VERSION below.  Old keys must be kept until all rows are
 *   re-encrypted (see rotateFieldEncryptionKey() in key-rotation.ts).
 *
 * Plaintext values are NEVER logged.
 *
 * Assumptions / follow-up work:
 *   - HSM / KMS integration is out of scope; keys are env-var sourced.
 *   - Multi-key versioning beyond a single active key is a follow-up item.
 *   - The github_token_encrypted column uses a separate key
 *     (GITHUB_TOKEN_ENCRYPTION_KEY) and its own encryption module
 *     (lib/github/token-encryption.ts) — that is intentional and unchanged.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Increment this when rotating to a new key. */
export const KEY_VERSION = 1;

function getKey(version = KEY_VERSION): Buffer {
    const envVar = version === 1
        ? 'FIELD_ENCRYPTION_KEY'
        : `FIELD_ENCRYPTION_KEY_${version}`;

    const hex = process.env[envVar] ?? '';
    if (hex.length !== 64) {
        throw new Error(
            `${envVar} must be a 64-character hex string (32 bytes). ` +
            'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        );
    }
    return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a plaintext string for database storage.
 * Returns a self-contained blob: v<version>.<iv>.<ciphertext>.<tag>
 */
export function encrypt(plaintext: string): string {
    const key = getKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
        `v${KEY_VERSION}`,
        iv.toString('base64url'),
        ciphertext.toString('base64url'),
        tag.toString('base64url'),
    ].join('.');
}

/**
 * Decrypts a blob produced by encrypt().
 * Throws if the blob is malformed, the auth tag is invalid, or the key is wrong.
 */
export function decrypt(stored: string): string {
    const parts = stored.split('.');
    if (parts.length !== 4) {
        throw new Error('Invalid encrypted field format: expected v<version>.<iv>.<ciphertext>.<tag>');
    }

    const [versionPart, ivB64, ciphertextB64, tagB64] = parts;
    const version = parseInt(versionPart.slice(1), 10);
    if (isNaN(version) || !versionPart.startsWith('v')) {
        throw new Error('Invalid encrypted field format: missing version prefix');
    }

    const key = getKey(version);
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

/**
 * Returns true if the value looks like an encrypted blob produced by encrypt().
 * Useful for migration scripts to skip already-encrypted rows.
 */
export function isEncrypted(value: string): boolean {
    const parts = value.split('.');
    return parts.length === 4 && /^v\d+$/.test(parts[0]);
}
