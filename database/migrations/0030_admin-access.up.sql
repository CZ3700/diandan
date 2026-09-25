CREATE TABLE public.admin_login_challenges (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  state_digest bytea NOT NULL UNIQUE CHECK (octet_length(state_digest)=32),
  binding_digest bytea NOT NULL CHECK (octet_length(binding_digest)=32),
  configuration_digest bytea NOT NULL CHECK (octet_length(configuration_digest)=32),
  locale public.supported_locale NOT NULL,
  state text NOT NULL DEFAULT 'READY' CHECK (state IN ('READY','CLAIMED','CONSUMED')),
  created_at public.finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at public.finite_timestamptz NOT NULL,
  claim_digest bytea UNIQUE CHECK (claim_digest IS NULL OR octet_length(claim_digest)=32),
  claimed_at public.finite_timestamptz,
  completed_at public.finite_timestamptz,
  session_id uuid UNIQUE REFERENCES public.admin_sessions(id) ON DELETE RESTRICT,
  audit_log_id uuid UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  CHECK (expires_at>=created_at+interval '30 seconds' AND expires_at<=created_at+interval '600 seconds'),
  CHECK ((state='READY' AND claim_digest IS NULL AND claimed_at IS NULL AND completed_at IS NULL AND session_id IS NULL AND audit_log_id IS NULL)
    OR (state='CLAIMED' AND claim_digest IS NOT NULL AND claimed_at IS NOT NULL AND completed_at IS NULL AND session_id IS NULL AND audit_log_id IS NULL)
    OR (state='CONSUMED' AND claim_digest IS NOT NULL AND claimed_at IS NOT NULL AND completed_at IS NOT NULL AND audit_log_id IS NOT NULL)),
  CHECK (claimed_at IS NULL OR (claimed_at>=created_at AND claimed_at<expires_at)),
  CHECK (completed_at IS NULL OR completed_at>=claimed_at)
);
CREATE INDEX admin_login_challenges_expiry_idx ON public.admin_login_challenges(expires_at) WHERE state<>'CONSUMED';
CREATE FUNCTION public.guard_admin_login_challenge() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'READY' OR NEW.created_at<transaction_timestamp() OR NEW.created_at>clock_timestamp() THEN
      RAISE EXCEPTION 'login challenge must start ready at database time' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'state'-'claim_digest'-'claimed_at'-'completed_at'-'session_id'-'audit_log_id') IS DISTINCT FROM
     (to_jsonb(OLD)-'state'-'claim_digest'-'claimed_at'-'completed_at'-'session_id'-'audit_log_id') THEN
    RAISE EXCEPTION 'login challenge binding is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.state='READY' AND NEW.state='CLAIMED' THEN
    IF NEW.claimed_at<transaction_timestamp() OR NEW.claimed_at>clock_timestamp() OR NEW.claimed_at>=NEW.expires_at OR clock_timestamp()>=NEW.expires_at THEN
      RAISE EXCEPTION 'login claim requires fresh database time' USING ERRCODE='23514';
    END IF;
  ELSIF OLD.state='CLAIMED' AND NEW.state='CONSUMED' THEN
    IF NEW.claim_digest IS DISTINCT FROM OLD.claim_digest OR NEW.claimed_at<>OLD.claimed_at
      OR NEW.completed_at<transaction_timestamp() OR NEW.completed_at>clock_timestamp() THEN
      RAISE EXCEPTION 'login completion must preserve claim and database time' USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'login challenge is single use' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER admin_login_challenge_guard BEFORE INSERT OR UPDATE ON public.admin_login_challenges
FOR EACH ROW EXECUTE FUNCTION public.guard_admin_login_challenge();
CREATE TRIGGER admin_login_challenge_no_delete BEFORE DELETE ON public.admin_login_challenges
FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER admin_login_challenge_no_truncate BEFORE TRUNCATE ON public.admin_login_challenges
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE FUNCTION public.assert_admin_login_challenge_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.audit_logs%ROWTYPE; s public.admin_sessions%ROWTYPE;
BEGIN
  IF NEW.state<>'CONSUMED' THEN RETURN NEW; END IF;
  SELECT * INTO a FROM public.audit_logs WHERE id=NEW.audit_log_id;
  IF a.id IS NULL OR a.actor_type<>'SYSTEM' OR a.task_name<>'admin-access' OR a.subject_type<>'ADMIN_LOGIN_CHALLENGE'
    OR a.subject_id<>NEW.id OR a.created_at<>NEW.completed_at OR a.request_id IS NULL OR a.correlation_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'login completion requires exact immutable audit' USING ERRCODE='23514';
  END IF;
  IF NEW.session_id IS NULL THEN
    IF a.action<>'ADMIN_LOGIN_REJECTED' OR a.outcome<>'REJECTED' OR a.reason_code IS NULL OR a.reason_code NOT IN ('ACCESS_DENIED','LOGIN_EXPIRED','IDENTITY_REJECTED','MFA_REQUIRED','AUTHENTICATION_EXPIRED') THEN
      RAISE EXCEPTION 'login rejection audit is required' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO s FROM public.admin_sessions WHERE id=NEW.session_id;
    IF a.action<>'ADMIN_LOGIN_SUCCEEDED' OR a.outcome<>'SUCCEEDED' OR a.reason_code IS DISTINCT FROM 'AUTHENTICATED'
      OR NEW.completed_at>=NEW.expires_at OR s.id IS NULL OR NOT s.authenticated_with_mfa OR s.created_at<>NEW.completed_at OR s.revoked_at IS NOT NULL
      OR s.expires_at<s.created_at+interval '60 seconds' OR s.expires_at>s.created_at+interval '28800 seconds'
      OR octet_length(s.session_token_digest)<>32 OR octet_length(s.csrf_token_digest)<>32
      OR NOT EXISTS(SELECT 1 FROM public.admin_identities WHERE id=s.admin_identity_id AND status='ACTIVE') THEN
      RAISE EXCEPTION 'login success requires canonical active MFA session' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER admin_login_challenge_audit AFTER INSERT OR UPDATE ON public.admin_login_challenges
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_login_challenge_audit();

-- Protect only sessions issued by this login flow; earlier session readers/fixtures remain compatible.
CREATE FUNCTION public.guard_linked_admin_session() RETURNS trigger
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
CREATE TRIGGER linked_admin_session_guard BEFORE UPDATE OR DELETE ON public.admin_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_linked_admin_session();
CREATE TRIGGER linked_admin_session_no_truncate BEFORE TRUNCATE ON public.admin_sessions
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_linked_admin_session();
CREATE FUNCTION public.assert_linked_admin_session_revocation_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.admin_login_challenges WHERE session_id=NEW.id)
    AND NOT EXISTS(
      SELECT 1 FROM public.audit_logs a WHERE a.actor_type='ADMIN' AND a.actor_id=NEW.admin_identity_id
        AND a.action IN ('ADMIN_SESSION_REVOKED','ADMIN_SESSIONS_REVOKED') AND a.subject_type='ADMIN_SESSION'
        AND a.subject_id=NEW.id AND a.created_at=NEW.revoked_at AND a.outcome='SUCCEEDED'
        AND a.reason_code='USER_LOGOUT' AND a.request_id IS NOT NULL
        AND (a.action='ADMIN_SESSIONS_REVOKED' OR a.correlation_id=NEW.id)
        AND EXISTS(SELECT 1 FROM public.admin_sessions anchor WHERE anchor.id=a.correlation_id
          AND anchor.admin_identity_id=NEW.admin_identity_id AND anchor.revoked_at=NEW.revoked_at)
    ) THEN
    RAISE EXCEPTION 'admin session revocation requires exact immutable audit' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER linked_admin_session_revocation_audit AFTER UPDATE ON public.admin_sessions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_linked_admin_session_revocation_audit();
