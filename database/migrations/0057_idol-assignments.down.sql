SET search_path=public;
-- Assignment history is what limits a broker; refuse to drop it silently.
LOCK TABLE idol_assignments IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM idol_assignments) THEN
  RAISE EXCEPTION 'artist assignment history cannot be downgraded' USING ERRCODE='55000';
 END IF;
END $$;
-- Restore the exact 0022 functions: daily management again requires management.direct.
CREATE OR REPLACE FUNCTION public.assert_management_authority(operation_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE o public.management_operations%ROWTYPE; session public.admin_sessions%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.management_operations WHERE id=operation_id FOR SHARE;
 SELECT * INTO session FROM public.admin_sessions WHERE id=o.session_id FOR SHARE;
 IF o.id IS NULL OR o.capability<>'DIRECT_OPERATOR_V1' OR o.status NOT IN('RUNNING','SUCCEEDED')
 OR o.authorized_until>session.expires_at OR o.authorized_until<=clock_timestamp()
 OR (o.status='RUNNING' AND o.lease_expires_at<=clock_timestamp()) THEN
  RAISE EXCEPTION 'daily publication requires a current bounded operation grant' USING ERRCODE='23514';
 END IF;
 PERFORM public.assert_admin_catalog_authority(o.actor_id,o.session_id,clock_timestamp(),NULL,'management.direct',ARRAY[(o.intent->>'sourceLocale')::public.supported_locale]);
END; $$;
CREATE OR REPLACE FUNCTION public.guard_management_operation() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE session public.admin_sessions%ROWTYPE;
BEGIN
 IF NEW.intent_hash<>sha256(convert_to(public.canonical_publication_json(NEW.intent),'UTF8')) THEN RAISE EXCEPTION 'operation intent digest must match canonical payload' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.actor_id<>OLD.actor_id OR NEW.intent IS DISTINCT FROM OLD.intent OR NEW.intent_hash<>OLD.intent_hash OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.capability<>OLD.capability OR NEW.created_at<>OLD.created_at
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR OLD.status='SUCCEEDED' THEN RAISE EXCEPTION 'operation identity, intent and completed history are immutable' USING ERRCODE='23514'; END IF;
  IF NEW.session_id<>OLD.session_id OR NEW.authorized_until<>OLD.authorized_until OR NEW.retry_key IS DISTINCT FROM OLD.retry_key THEN
   IF OLD.status<>'FAILED' OR NOT OLD.failure_retryable OR NEW.status<>'QUEUED' OR NEW.retry_key IS NULL OR NEW.retry_key IS NOT DISTINCT FROM OLD.retry_key THEN RAISE EXCEPTION 'operation reauthorization requires exact failed retry' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.lease_token_digest IS DISTINCT FROM OLD.lease_token_digest AND NEW.lease_token_digest IS NOT NULL THEN
   IF (OLD.status='RUNNING' AND OLD.lease_expires_at>clock_timestamp()) OR OLD.status NOT IN('QUEUED','RUNNING') OR NEW.attempt_count<>OLD.attempt_count+1
   OR NEW.lease_expires_at>clock_timestamp()+interval '900 seconds' OR NEW.lease_expires_at>NEW.authorized_until THEN RAISE EXCEPTION 'operation claim requires a due bounded fresh lease' USING ERRCODE='23514'; END IF;
  ELSIF NEW.attempt_count<>OLD.attempt_count THEN RAISE EXCEPTION 'only claiming increments attempts' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.status<>'QUEUED' OR NEW.version<>1 OR NEW.attempt_count<>0 OR NEW.phase<>'PREPARE_MEDIA' OR NEW.retry_key IS NOT NULL OR NEW.checkpoint<>'{"sourceAssetId":null,"jobs":[],"preparedMedia":null,"retryRequested":false}'::jsonb THEN RAISE EXCEPTION 'operation starts with an exact empty durable checkpoint' USING ERRCODE='23514'; END IF;
 END IF;
 -- Expired work may become an honest retryable authorization failure, never a publication.
 IF NEW.status='FAILED' AND NEW.failure_code='NEEDS_AUTHORIZATION' THEN RETURN NEW; END IF;
 SELECT * INTO session FROM public.admin_sessions WHERE id=NEW.session_id FOR SHARE;
 IF session.id IS NULL OR session.admin_identity_id<>NEW.actor_id OR NEW.authorized_until>session.expires_at OR NEW.authorized_until<=clock_timestamp() THEN RAISE EXCEPTION 'operation expiry must be bounded by its actual session' USING ERRCODE='23514'; END IF;
 PERFORM public.assert_admin_catalog_authority(NEW.actor_id,NEW.session_id,clock_timestamp(),NULL,'management.direct',ARRAY[(NEW.intent->>'sourceLocale')::public.supported_locale]);
 RETURN NEW;
END; $$;
DROP FUNCTION public.assert_management_scope(uuid,uuid,jsonb,uuid);
DROP TABLE public.idol_assignments;
DROP FUNCTION public.guard_idol_assignment();
DROP FUNCTION public.idol_current_broker(uuid);
DELETE FROM role_permissions rp USING permissions p WHERE rp.permission_id=p.id AND p.permission_key IN('idols.assign','management.assigned');
DELETE FROM permissions WHERE permission_key IN('idols.assign','management.assigned');
