SET search_path=public;
-- The 0052 checks can hold only NULL; refuse to restore them over stored second factors.
LOCK TABLE admin_local_accounts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM admin_local_accounts WHERE num_nonnulls(totp_ciphertext,totp_encrypted_data_key,
    totp_pending_ciphertext,totp_pending_encrypted_data_key)>0) THEN
    RAISE EXCEPTION 'stored second factors cannot return to the 0052 format checks' USING ERRCODE='55000';
  END IF;
END $$;
ALTER TABLE admin_local_accounts
  DROP CONSTRAINT admin_local_accounts_totp_ciphertext_check,
  DROP CONSTRAINT admin_local_accounts_totp_encrypted_data_key_check,
  DROP CONSTRAINT admin_local_accounts_totp_pending_ciphertext_check,
  DROP CONSTRAINT admin_local_accounts_totp_pending_encrypted_data_key_check,
  ADD CONSTRAINT admin_local_accounts_totp_ciphertext_check
    CHECK (totp_ciphertext ~ '^enc:v1:[A-Za-z0-9_-]{32,4096}$'),
  ADD CONSTRAINT admin_local_accounts_totp_encrypted_data_key_check
    CHECK (totp_encrypted_data_key ~ '^enc:v1:[A-Za-z0-9_-]{32,4096}$'),
  ADD CONSTRAINT admin_local_accounts_totp_pending_ciphertext_check
    CHECK (totp_pending_ciphertext ~ '^enc:v1:[A-Za-z0-9_-]{32,4096}$'),
  ADD CONSTRAINT admin_local_accounts_totp_pending_encrypted_data_key_check
    CHECK (totp_pending_encrypted_data_key ~ '^enc:v1:[A-Za-z0-9_-]{32,4096}$');
