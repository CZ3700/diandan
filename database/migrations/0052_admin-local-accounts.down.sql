SET search_path=public;
LOCK TABLE admin_local_accounts,admin_local_recovery_codes,admin_local_logins IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM admin_local_accounts) OR EXISTS(SELECT 1 FROM admin_local_logins)
    OR EXISTS(SELECT 1 FROM audit_logs WHERE action LIKE 'ADMIN_LOCAL_%' OR task_name IN ('admin-local-access','admin-account-cli'))
    OR EXISTS(SELECT 1 FROM admin_identity_roles ar JOIN roles r ON r.id=ar.role_id WHERE r.role_key IN ('studio:owner','studio:operator')) THEN
    RAISE EXCEPTION 'built-in admin account history cannot be downgraded' USING ERRCODE='55000';
  END IF;
END $$;
DROP TRIGGER local_admin_session_revocation_audit ON admin_sessions;
DROP FUNCTION assert_local_admin_session_revocation_audit();
CREATE OR REPLACE FUNCTION guard_linked_admin_session() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='TRUNCATE' THEN
    IF EXISTS(SELECT 1 FROM public.admin_login_challenges WHERE session_id IS NOT NULL) THEN
      RAISE EXCEPTION 'issued admin sessions cannot be truncated' USING ERRCODE='55000';
    END IF;
    RETURN NULL;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.admin_login_challenges WHERE session_id=OLD.id) THEN
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
DROP TABLE admin_local_logins,admin_local_recovery_codes,admin_local_accounts;
DROP FUNCTION assert_admin_local_login_audit(),guard_admin_local_login(),guard_admin_local_recovery_code(),guard_admin_local_account();
DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE role_key IN ('studio:owner','studio:operator'));
DELETE FROM roles WHERE role_key IN ('studio:owner','studio:operator');
DELETE FROM permissions WHERE permission_key='staff.manage' AND NOT EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.permission_id=permissions.id);
