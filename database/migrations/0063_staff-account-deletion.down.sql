SET search_path=public;
-- Older code does not know deleted accounts (its server command would reactivate one); refuse while any exist.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM admin_identities WHERE status='ARCHIVED') THEN
  RAISE EXCEPTION 'deleted staff accounts cannot be downgraded' USING ERRCODE='55000';
 END IF;
END $$;
DROP TRIGGER admin_identity_role_not_archived ON public.admin_identity_roles;
DROP FUNCTION public.guard_archived_admin_role();
DROP TRIGGER admin_identity_archived_final ON public.admin_identities;
DROP FUNCTION public.guard_archived_admin_identity();
-- Restore the exact 0052 revocation check and the exact 0057 assignment guard.
CREATE OR REPLACE FUNCTION assert_local_admin_session_revocation_audit() RETURNS trigger
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

CREATE OR REPLACE FUNCTION public.guard_idol_assignment() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE latest public.idol_assignments%ROWTYPE; o public.management_operations%ROWTYPE; artist_status text;
BEGIN
 -- One writer per artist, so the sequence and the previous broker are read under the same lock.
 PERFORM pg_advisory_xact_lock(hashtextextended('fan-support:idol-assignment:'||NEW.idol_id::text,0));
 SELECT * INTO latest FROM public.idol_assignments WHERE idol_id=NEW.idol_id ORDER BY sequence DESC LIMIT 1;
 IF NEW.sequence<>coalesce(latest.sequence,0)+1 OR NEW.previous_broker_identity_id IS DISTINCT FROM latest.broker_identity_id
 OR NEW.created_at<coalesce(latest.created_at,NEW.created_at) THEN RAISE EXCEPTION 'artist assignment must extend its exact current history' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs l WHERE l.id=NEW.audit_log_id AND l.actor_type='ADMIN' AND l.actor_id=NEW.actor_id AND l.action='IDOL_ASSIGNMENT'
  AND l.subject_type='IDOL' AND l.subject_id=NEW.idol_id AND l.outcome='SUCCEEDED' AND l.request_id=NEW.request_id AND l.created_at=NEW.created_at) THEN
  RAISE EXCEPTION 'artist assignment requires its exact audit record' USING ERRCODE='23514'; END IF;
 IF NEW.broker_identity_id IS NOT NULL THEN
  PERFORM 1 FROM public.admin_identities i WHERE i.id=NEW.broker_identity_id AND i.status='ACTIVE' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.admin_identity_roles ar JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id
   WHERE ar.admin_identity_id=NEW.broker_identity_id AND p.permission_key='management.assigned' AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()) THEN
   RAISE EXCEPTION 'an artist can only be assigned to an active broker' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.reason='BROKER_CREATED' THEN
  -- Written by the daily publication that creates the artist, inside that same transaction.
  SELECT * INTO o FROM public.management_operations WHERE id=NEW.operation_id FOR SHARE;
  IF o.id IS NULL OR o.actor_id<>NEW.actor_id OR o.session_id<>NEW.session_id OR o.target_id IS DISTINCT FROM NEW.idol_id OR o.status<>'RUNNING'
  OR o.intent->>'kind' IS DISTINCT FROM 'SAVE_ARTIST' OR o.intent->'id' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'a broker owns only the artist its own running operation creates' USING ERRCODE='23514'; END IF;
  PERFORM public.assert_admin_catalog_authority(NEW.actor_id,NEW.session_id,NEW.created_at,latest.created_at,'management.assigned',ARRAY[(o.intent->>'sourceLocale')::public.supported_locale]);
 ELSE
  SELECT status INTO artist_status FROM public.idols WHERE id=NEW.idol_id FOR SHARE;
  IF artist_status IS NULL OR artist_status='archived' THEN RAISE EXCEPTION 'only a current artist can be assigned' USING ERRCODE='23514'; END IF;
  PERFORM public.assert_admin_catalog_authority(NEW.actor_id,NEW.session_id,NEW.created_at,latest.created_at,'idols.assign',ARRAY[]::public.supported_locale[]);
 END IF;
 RETURN NEW;
END; $$;

