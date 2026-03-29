/**
 * Key rotation utility for field-level encrypted columns (#234)
 *
 * Usage:
 *   1. Generate a new key:
 *        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   2. Set the new key as FIELD_ENCRYPTION_KEY_<N> in your environment
 *      (e.g. FIELD_ENCRYPTION_KEY_2=<new-hex-key>).
 *   3. Update KEY_VERSION in lib/crypto/field-encryption.ts to N.
 *   4. Deploy the updated application — new writes will use the new key.
 *   5. Run this utility to re-encrypt existing rows with the new key:
 *        FIELD_ENCRYPTION_KEY=<old-key> FIELD_ENCRYPTION_KEY_2=<new-key> \
 *          npx tsx apps/web/src/lib/crypto/key-rotation.ts
 *   6. Once all rows are re-encrypted, remove the old key env var.
 *
 * The utility is idempotent: rows already encrypted with the current
 * KEY_VERSION are skipped.
 *
 * Assumptions:
 *   - Runs as a one-off script with direct DB access (service_role key).
 *   - Does NOT cause downtime: old and new keys coexist during rotation.
 *   - HSM / KMS integration is out of scope.
 */

import { createClient } from '@supabase/supabase-js';
import { encrypt, decrypt, KEY_VERSION, isEncrypted } from './field-encryption';

/** Columns in the profiles table that use field-level encryption. */
const ENCRYPTED_PROFILE_COLUMNS = [
    'stripe_customer_id_encrypted',
    'stripe_subscription_id_encrypted',
] as const;

type EncryptedColumn = typeof ENCRYPTED_PROFILE_COLUMNS[number];

/**
 * Re-encrypts a single value with the current KEY_VERSION key.
 * If the value is already at the current version, returns it unchanged.
 */
export function reEncrypt(stored: string): { value: string; rotated: boolean } {
    const parts = stored.split('.');
    const currentVersion = parts.length === 4 ? parseInt(parts[0].slice(1), 10) : -1;

    if (currentVersion === KEY_VERSION) {
        return { value: stored, rotated: false };
    }

    const plaintext = decrypt(stored);
    return { value: encrypt(plaintext), rotated: true };
}

/**
 * Rotates all encrypted profile columns for all rows.
 * Returns a summary of how many rows were rotated per column.
 *
 * @param supabase - Supabase client initialised with the service_role key.
 */
export async function rotateProfileEncryptedColumns(
    supabase: ReturnType<typeof createClient>,
): Promise<Record<EncryptedColumn, { total: number; rotated: number }>> {
    const summary = {} as Record<EncryptedColumn, { total: number; rotated: number }>;

    for (const col of ENCRYPTED_PROFILE_COLUMNS) {
        summary[col] = { total: 0, rotated: 0 };

        const { data: rows, error } = await supabase
            .from('profiles')
            .select(`id, ${col}`)
            .not(col, 'is', null);

        if (error) throw new Error(`Failed to fetch profiles for ${col}: ${error.message}`);
        if (!rows?.length) continue;

        for (const row of rows) {
            const stored = row[col] as string;
            summary[col].total++;

            const { value, rotated } = reEncrypt(stored);
            if (!rotated) continue;

            const { error: updateError } = await supabase
                .from('profiles')
                .update({ [col]: value })
                .eq('id', row.id);

            if (updateError) {
                throw new Error(`Failed to update row ${row.id} for ${col}: ${updateError.message}`);
            }

            summary[col].rotated++;
        }
    }

    return summary;
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
        console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    rotateProfileEncryptedColumns(supabase)
        .then((summary) => {
            console.log('Key rotation complete:');
            for (const [col, stats] of Object.entries(summary)) {
                console.log(`  ${col}: ${stats.rotated}/${stats.total} rows rotated`);
            }
        })
        .catch((err) => {
            console.error('Key rotation failed:', err.message);
            process.exit(1);
        });
}
