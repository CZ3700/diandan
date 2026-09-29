SET search_path=public;
-- 0052 bounded the encrypted TOTP columns with '{32,4096}', but PostgreSQL regular expressions allow
-- at most 255 repetitions, so every non-null value failed with 2201B. No row can hold such a value yet.
-- Same rule, expressed as an alphabet check plus a length bound ("enc:v1:" + 32..4096 characters).
ALTER TABLE admin_local_accounts
  DROP CONSTRAINT admin_local_accounts_totp_ciphertext_check,
  DROP CONSTRAINT admin_local_accounts_totp_encrypted_data_key_check,
  DROP CONSTRAINT admin_local_accounts_totp_pending_ciphertext_check,
  DROP CONSTRAINT admin_local_accounts_totp_pending_encrypted_data_key_check,
  ADD CONSTRAINT admin_local_accounts_totp_ciphertext_check
    CHECK (totp_ciphertext ~ '^enc:v1:[A-Za-z0-9_-]+$' AND char_length(totp_ciphertext) BETWEEN 39 AND 4103),
  ADD CONSTRAINT admin_local_accounts_totp_encrypted_data_key_check
    CHECK (totp_encrypted_data_key ~ '^enc:v1:[A-Za-z0-9_-]+$' AND char_length(totp_encrypted_data_key) BETWEEN 39 AND 4103),
  ADD CONSTRAINT admin_local_accounts_totp_pending_ciphertext_check
    CHECK (totp_pending_ciphertext ~ '^enc:v1:[A-Za-z0-9_-]+$' AND char_length(totp_pending_ciphertext) BETWEEN 39 AND 4103),
  ADD CONSTRAINT admin_local_accounts_totp_pending_encrypted_data_key_check
    CHECK (totp_pending_encrypted_data_key ~ '^enc:v1:[A-Za-z0-9_-]+$' AND char_length(totp_pending_encrypted_data_key) BETWEEN 39 AND 4103);
