-- Migration 007: field-level encryption for Stripe credential columns (#234)
--
-- Context:
--   github_token_encrypted already uses AES-256-GCM (lib/github/token-encryption.ts).
--   This migration extends field-level encryption to the remaining sensitive
--   columns in the profiles table:
--     - stripe_customer_id   → stripe_customer_id_encrypted
--     - stripe_subscription_id → stripe_subscription_id_encrypted
--
-- Stripe customer/subscription IDs are not secret keys, but they are
-- third-party identifiers that uniquely link a user to their billing account.
-- Encrypting them limits exposure in the event of a DB read compromise.
--
-- Migration strategy (zero-downtime):
--   1. Add new _encrypted columns (nullable).
--   2. The application layer writes to the new columns going forward.
--   3. Run the key-rotation utility (lib/crypto/key-rotation.ts) to
--      back-fill any existing rows that were written before this migration.
--   4. Once all rows are migrated, the old plaintext columns can be dropped
--      in a follow-up migration after verifying no reads target them.
--
-- Encryption format: v<version>.<iv_base64url>.<ciphertext_base64url>.<tag_base64url>
-- Key: FIELD_ENCRYPTION_KEY environment variable (64-char hex / 32 bytes).
--
-- Key management assumptions (out of scope):
--   - Key rotation uses FIELD_ENCRYPTION_KEY_<N> versioned env vars.
--   - HSM / KMS integration is a follow-up item.

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS stripe_customer_id_encrypted     TEXT,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id_encrypted TEXT;

-- Prevent accidental plaintext Stripe ID storage.
-- Stripe customer IDs start with "cus_", subscription IDs with "sub_".
ALTER TABLE profiles
    ADD CONSTRAINT profiles_stripe_customer_not_plaintext
    CHECK (
        stripe_customer_id_encrypted IS NULL
        OR stripe_customer_id_encrypted NOT LIKE 'cus\_%' ESCAPE '\'
    );

ALTER TABLE profiles
    ADD CONSTRAINT profiles_stripe_subscription_not_plaintext
    CHECK (
        stripe_subscription_id_encrypted IS NULL
        OR stripe_subscription_id_encrypted NOT LIKE 'sub\_%' ESCAPE '\'
    );
