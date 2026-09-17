LOCK TABLE public.admin_login_challenges,public.admin_sessions,public.audit_logs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.admin_login_challenges) OR EXISTS(SELECT 1 FROM public.audit_logs WHERE action IN ('ADMIN_LOGIN_SUCCEEDED','ADMIN_LOGIN_REJECTED','ADMIN_SESSION_REVOKED','ADMIN_SESSIONS_REVOKED')) THEN
    RAISE EXCEPTION 'admin access history cannot be discarded' USING ERRCODE='55000';
  END IF;
END $$;
DROP TRIGGER linked_admin_session_revocation_audit ON public.admin_sessions;
DROP TRIGGER linked_admin_session_no_truncate ON public.admin_sessions;
DROP TRIGGER linked_admin_session_guard ON public.admin_sessions;
DROP FUNCTION public.assert_linked_admin_session_revocation_audit();
DROP FUNCTION public.guard_linked_admin_session();
DROP TABLE public.admin_login_challenges;
DROP FUNCTION public.assert_admin_login_challenge_audit();
DROP FUNCTION public.guard_admin_login_challenge();
