SET search_path=public;
-- ADR-021 / L3-10: built-in admin accounts beside the existing identity, RBAC, session and audit model.

-- The complete permission catalog, so a production database can grant roles without local fixtures.
INSERT INTO permissions(id,permission_key,description)
SELECT gen_random_uuid(),key,'Platform permission' FROM unnest(ARRAY[
  'content.read','content.edit','content.translation.review','content.preview',
  'content.media.upload','content.media.read','content.media.process','content.media.rights',
  'content.policy.manage','content.publish',
  'orders.read','orders.message.read','orders.message.review','orders.message.triage',
  'orders.fulfillment','orders.note','orders.notification.resend','orders.manage',
  'commerce.read','gift.manage','pricing.manage','inventory.manage','management.direct',
  'finance.manage','payments.read','payments.configure','payments.review','payments.publish',
  'exceptions.read','exceptions.replay'
]) AS key
ON CONFLICT (permission_key) DO NOTHING;
INSERT INTO permissions(id,permission_key,description)
VALUES(gen_random_uuid(),'staff.manage','Create built-in staff accounts, assign roles, reset passwords and suspend access')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO roles(id,role_key,description) VALUES
  (gen_random_uuid(),'studio:owner','Studio administrator: every permission, including staff, finance and payment configuration'),
  (gen_random_uuid(),'studio:operator','Daily operations: content, gifts, orders and messages; no finance, payment configuration, exception replay or staff management')
ON CONFLICT (role_key) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.role_key='studio:owner'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key=ANY(ARRAY[
  'content.read','content.edit','content.translation.review','content.preview',
  'content.media.upload','content.media.read','content.media.process','content.media.rights',
  'content.policy.manage','content.publish',
  'orders.read','orders.message.read','orders.message.review','orders.message.triage',
  'orders.fulfillment','orders.note','orders.notification.resend',
  'commerce.read','gift.manage','pricing.manage','inventory.manage','management.direct',
  'payments.read','exceptions.read'
]) WHERE r.role_key='studio:operator'
ON CONFLICT DO NOTHING;

CREATE TABLE admin_local_accounts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  admin_identity_id uuid NOT NULL UNIQUE REFERENCES admin_identities(id) ON DELETE RESTRICT,
  login_name text NOT NULL UNIQUE CHECK (login_name ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80
    AND display_name=btrim(display_name) AND display_name !~ '[[:cntrl:]]'),
  password_hash text NOT NULL CHECK (password_hash ~ '^scrypt\$1\$[0-9]{1,10}\$[0-9]{1,3}\$[0-9]{1,3}\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$'),
  password_changed_at finite_timestamptz NOT NULL,
  must_change_password boolean NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 1000000),
  locked_until finite_timestamptz,
  totp_ciphertext text CHECK (totp_ciphertext ~ '^enc:v1:[A-Za-z0-9_-]{32,4096}$'),
  totp_encrypted_data_key text CHECK (totp_encrypted_data_key ~ '^enc:v1:[A-Za-z0-9_-]{32,4096}$'),
  totp_key_version text CHECK (totp_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  totp_enabled_at finite_timestamptz,
  totp_last_step bigint CHECK (totp_last_step>=0),
  totp_pending_ciphertext text CHECK (totp_pending_ciphertext ~ '^enc:v1:[A-Za-z0-9_-]{32,4096}$'),
  totp_pending_encrypted_data_key text CHECK (totp_pending_encrypted_data_key ~ '^enc:v1:[A-Za-z0-9_-]{32,4096}$'),
  totp_pending_key_version text CHECK (totp_pending_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  totp_pending_expires_at finite_timestamptz,
  last_login_at finite_timestamptz,
  version positive_version NOT NULL DEFAULT 1,
  created_at finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (num_nulls(totp_ciphertext,totp_encrypted_data_key,totp_key_version,totp_enabled_at) IN (0,4)),
  CHECK (totp_ciphertext IS NOT NULL OR totp_last_step IS NULL),
  CHECK (num_nulls(totp_pending_ciphertext,totp_pending_encrypted_data_key,totp_pending_key_version,totp_pending_expires_at) IN (0,4)),
  CHECK (updated_at>=created_at AND password_changed_at>=created_at)
);
CREATE FUNCTION guard_admin_local_account() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM public.admin_identities WHERE id=NEW.admin_identity_id AND issuer='urn:fan-support:local') THEN
      RAISE EXCEPTION 'built-in account requires a built-in identity' USING ERRCODE='23514';
    END IF;
    IF NEW.version<>1 OR NEW.failed_attempts<>0 OR NEW.totp_ciphertext IS NOT NULL OR NEW.totp_pending_ciphertext IS NOT NULL THEN
      RAISE EXCEPTION 'built-in account starts without history or second factor' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id<>OLD.id OR NEW.admin_identity_id<>OLD.admin_identity_id OR NEW.login_name<>OLD.login_name
    OR NEW.created_at<>OLD.created_at OR NEW.schema_version<>OLD.schema_version THEN
    RAISE EXCEPTION 'built-in account binding is immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at THEN
    RAISE EXCEPTION 'built-in account updates are versioned' USING ERRCODE='40001';
  END IF;
  IF NEW.password_changed_at<OLD.password_changed_at
    OR (NEW.password_hash IS DISTINCT FROM OLD.password_hash AND NEW.password_changed_at=OLD.password_changed_at) THEN
    RAISE EXCEPTION 'password change must be timestamped' USING ERRCODE='23514';
  END IF;
  IF OLD.totp_last_step IS NOT NULL AND NEW.totp_last_step IS NOT NULL
    AND NEW.totp_ciphertext IS NOT DISTINCT FROM OLD.totp_ciphertext AND NEW.totp_last_step<OLD.totp_last_step THEN
    RAISE EXCEPTION 'accepted TOTP steps never move backwards' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER admin_local_account_guard BEFORE INSERT OR UPDATE ON admin_local_accounts
FOR EACH ROW EXECUTE FUNCTION guard_admin_local_account();
CREATE TRIGGER admin_local_account_no_delete BEFORE DELETE ON admin_local_accounts
FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER admin_local_account_no_truncate BEFORE TRUNCATE ON admin_local_accounts
FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

CREATE TABLE admin_local_recovery_codes (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES admin_local_accounts(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  code_digest bytea NOT NULL UNIQUE CHECK (octet_length(code_digest)=32),
  created_at finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
  used_at finite_timestamptz,
  revoked_at finite_timestamptz,
  CHECK (used_at IS NULL OR revoked_at IS NULL),
  CHECK (used_at IS NULL OR used_at>=created_at),
  CHECK (revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE INDEX admin_local_recovery_codes_live_idx ON admin_local_recovery_codes(account_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE FUNCTION guard_admin_local_recovery_code() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.used_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'recovery code starts unused' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'used_at'-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'used_at'-'revoked_at')
    OR OLD.used_at IS NOT NULL OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'recovery code is single use' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER admin_local_recovery_code_guard BEFORE INSERT OR UPDATE ON admin_local_recovery_codes
FOR EACH ROW EXECUTE FUNCTION guard_admin_local_recovery_code();
CREATE TRIGGER admin_local_recovery_code_no_delete BEFORE DELETE ON admin_local_recovery_codes
FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER admin_local_recovery_code_no_truncate BEFORE TRUNCATE ON admin_local_recovery_codes
FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

CREATE TABLE admin_local_logins (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  account_id uuid NOT NULL REFERENCES admin_local_accounts(id) ON DELETE RESTRICT,
  challenge_digest bytea UNIQUE CHECK (octet_length(challenge_digest)=32),
  locale supported_locale NOT NULL,
  needs_second_factor boolean NOT NULL,
  needs_new_password boolean NOT NULL,
  second_factor text NOT NULL DEFAULT 'NONE' CHECK (second_factor IN ('NONE','TOTP','RECOVERY_CODE')),
  step_attempts smallint NOT NULL DEFAULT 0 CHECK (step_attempts BETWEEN 0 AND 5),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','CONSUMED')),
  created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at finite_timestamptz NOT NULL,
  completed_at finite_timestamptz,
  session_id uuid UNIQUE REFERENCES admin_sessions(id) ON DELETE RESTRICT,
  audit_log_id uuid UNIQUE REFERENCES audit_logs(id) ON DELETE RESTRICT,
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '300 seconds'),
  CHECK ((state='PENDING' AND completed_at IS NULL AND session_id IS NULL AND audit_log_id IS NULL)
    OR (state='CONSUMED' AND completed_at IS NOT NULL AND audit_log_id IS NOT NULL)),
  CHECK (completed_at IS NULL OR completed_at>=created_at),
  CHECK ((needs_second_factor OR needs_new_password)=(challenge_digest IS NOT NULL)),
  CHECK (needs_second_factor OR second_factor='NONE')
);
CREATE INDEX admin_local_logins_expiry_idx ON admin_local_logins(expires_at) WHERE state='PENDING';
CREATE FUNCTION guard_admin_local_login() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'PENDING' OR NEW.second_factor<>'NONE' OR NEW.step_attempts<>0
      OR NEW.created_at<transaction_timestamp() OR NEW.created_at>clock_timestamp() THEN
      RAISE EXCEPTION 'built-in login must start pending at database time' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'state'-'second_factor'-'step_attempts'-'completed_at'-'session_id'-'audit_log_id') IS DISTINCT FROM
     (to_jsonb(OLD)-'state'-'second_factor'-'step_attempts'-'completed_at'-'session_id'-'audit_log_id') THEN
    RAISE EXCEPTION 'built-in login binding is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.state<>'PENDING' THEN
    RAISE EXCEPTION 'built-in login is single use' USING ERRCODE='55000';
  END IF;
  IF NEW.step_attempts<OLD.step_attempts OR NEW.step_attempts>OLD.step_attempts+1
    OR (OLD.second_factor<>'NONE' AND NEW.second_factor<>OLD.second_factor) THEN
    RAISE EXCEPTION 'built-in login steps only move forward' USING ERRCODE='23514';
  END IF;
  IF NEW.state='PENDING' THEN
    IF clock_timestamp()>=NEW.expires_at THEN
      RAISE EXCEPTION 'built-in login expired' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.completed_at<transaction_timestamp() OR NEW.completed_at>clock_timestamp() THEN
    RAISE EXCEPTION 'built-in login completion must use database time' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER admin_local_login_guard BEFORE INSERT OR UPDATE ON admin_local_logins
FOR EACH ROW EXECUTE FUNCTION guard_admin_local_login();
CREATE TRIGGER admin_local_login_no_delete BEFORE DELETE ON admin_local_logins
FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER admin_local_login_no_truncate BEFORE TRUNCATE ON admin_local_logins
FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE FUNCTION assert_admin_local_login_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.audit_logs%ROWTYPE; s public.admin_sessions%ROWTYPE; acct public.admin_local_accounts%ROWTYPE; expected_reason text;
BEGIN
  IF NEW.state<>'CONSUMED' THEN RETURN NEW; END IF;
  SELECT * INTO a FROM public.audit_logs WHERE id=NEW.audit_log_id;
  SELECT * INTO acct FROM public.admin_local_accounts WHERE id=NEW.account_id;
  IF a.id IS NULL OR a.actor_type<>'SYSTEM' OR a.task_name<>'admin-local-access' OR a.subject_type<>'ADMIN_LOCAL_LOGIN'
    OR a.subject_id<>NEW.id OR a.created_at<>NEW.completed_at OR a.request_id IS NULL OR a.correlation_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'built-in login completion requires exact immutable audit' USING ERRCODE='23514';
  END IF;
  IF NEW.session_id IS NULL THEN
    IF a.action<>'ADMIN_LOCAL_LOGIN_REJECTED' OR a.outcome<>'REJECTED'
      OR a.reason_code IS NULL OR a.reason_code NOT IN ('LOGIN_EXPIRED','SECOND_FACTOR_FAILED','ACCOUNT_LOCKED','ACCESS_DENIED') THEN
      RAISE EXCEPTION 'built-in login rejection audit is required' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO s FROM public.admin_sessions WHERE id=NEW.session_id;
  -- Computed first: an IF condition ends at its first THEN, so no CASE may appear inside it.
  expected_reason := CASE NEW.second_factor WHEN 'TOTP' THEN 'AUTHENTICATED_TOTP'
    WHEN 'RECOVERY_CODE' THEN 'AUTHENTICATED_RECOVERY_CODE' ELSE 'AUTHENTICATED_PASSWORD' END;
  IF a.action<>'ADMIN_LOCAL_LOGIN_SUCCEEDED' OR a.outcome<>'SUCCEEDED'
    OR a.reason_code IS DISTINCT FROM expected_reason
    OR (NEW.needs_second_factor AND NEW.second_factor='NONE')
    OR (NEW.needs_new_password AND (acct.must_change_password OR acct.password_changed_at<NEW.created_at))
    OR NEW.completed_at>=NEW.expires_at OR s.id IS NULL OR s.admin_identity_id<>acct.admin_identity_id
    OR NOT s.authenticated_with_mfa OR s.created_at<>NEW.completed_at OR s.revoked_at IS NOT NULL
    OR s.expires_at<s.created_at+interval '60 seconds' OR s.expires_at>s.created_at+interval '28800 seconds'
    OR octet_length(s.session_token_digest)<>32 OR octet_length(s.csrf_token_digest)<>32
    OR NOT EXISTS(SELECT 1 FROM public.admin_identities WHERE id=s.admin_identity_id AND status='ACTIVE') THEN
    RAISE EXCEPTION 'built-in login success requires a canonical session that met the account policy' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER admin_local_login_audit AFTER INSERT OR UPDATE ON admin_local_logins
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_admin_local_login_audit();

-- Sessions issued by either login flow share the same immutability; earlier fixtures stay compatible.
CREATE OR REPLACE FUNCTION guard_linked_admin_session() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='TRUNCATE' THEN
    IF EXISTS(SELECT 1 FROM public.admin_login_challenges WHERE session_id IS NOT NULL)
      OR EXISTS(SELECT 1 FROM public.admin_local_logins WHERE session_id IS NOT NULL) THEN
      RAISE EXCEPTION 'issued admin sessions cannot be truncated' USING ERRCODE='55000';
    END IF;
    RETURN NULL;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.admin_login_challenges WHERE session_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM public.admin_local_logins WHERE session_id=OLD.id) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'issued admin sessions cannot be deleted' USING ERRCODE='55000';
  END IF;
  IF (to_jsonb(NEW)-'last_seen_at'-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'last_seen_at'-'revoked_at')
    OR NOT isfinite(NEW.last_seen_at) OR NEW.last_seen_at<OLD.last_seen_at THEN
    RAISE EXCEPTION 'issued admin session binding is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
    OR NEW.revoked_at IS NOT NULL AND NOT isfinite(NEW.revoked_at)
    OR OLD.revoked_at IS NULL AND NEW.revoked_at>clock_timestamp() THEN
    RAISE EXCEPTION 'admin session revocation is final' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION assert_local_admin_session_revocation_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.admin_local_logins WHERE session_id=NEW.id)
    AND NOT EXISTS(
      SELECT 1 FROM public.audit_logs a WHERE a.subject_type='ADMIN_SESSION' AND a.subject_id=NEW.id
        AND a.created_at=NEW.revoked_at AND a.outcome='SUCCEEDED' AND a.request_id IS NOT NULL
        AND a.action IN ('ADMIN_SESSION_REVOKED','ADMIN_SESSIONS_REVOKED')
        AND a.reason_code IN ('USER_LOGOUT','PASSWORD_CHANGED','PASSWORD_RESET','ACCOUNT_SUSPENDED','SECOND_FACTOR_CHANGED')
        AND (a.actor_type='ADMIN' OR (a.actor_type='SYSTEM' AND a.task_name='admin-account-cli'))
    ) THEN
    RAISE EXCEPTION 'built-in admin session revocation requires exact immutable audit' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER local_admin_session_revocation_audit AFTER UPDATE ON admin_sessions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_local_admin_session_revocation_audit();
