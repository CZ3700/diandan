SET search_path=public;
-- ADR-022 / L3-11: a broker manages only the artists assigned to it. Assignment is append-only
-- history beside `idols`, so reassigning never moves the artist's own optimistic version.
INSERT INTO public.permissions(id,permission_key,description) VALUES
 (gen_random_uuid(),'idols.assign','Set and change the broker an artist belongs to'),
 (gen_random_uuid(),'management.assigned','Manage only the artists assigned to the account in the daily center')
ON CONFLICT(permission_key) DO NOTHING;

CREATE TABLE public.idol_assignments (
 id uuid PRIMARY KEY,
 idol_id uuid NOT NULL REFERENCES public.idols(id) ON DELETE RESTRICT,
 sequence bigint NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
 broker_identity_id uuid REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
 previous_broker_identity_id uuid REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(reason IN('BROKER_CREATED','ASSIGNED')),
 operation_id uuid REFERENCES public.management_operations(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.admin_sessions(id) ON DELETE RESTRICT,
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 created_at public.finite_timestamptz NOT NULL,
 UNIQUE(idol_id,sequence),
 -- Every row changes the assignment; NULL is unassigned (managed by the studio).
 CHECK(broker_identity_id IS DISTINCT FROM previous_broker_identity_id),
 CHECK((reason='BROKER_CREATED')=(operation_id IS NOT NULL)),
 CHECK(reason<>'BROKER_CREATED' OR (sequence=1 AND broker_identity_id=actor_id AND previous_broker_identity_id IS NULL))
);
CREATE INDEX idol_assignments_broker ON public.idol_assignments(broker_identity_id,idol_id);
CREATE TRIGGER idol_assignments_immutable BEFORE UPDATE OR DELETE ON public.idol_assignments FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER idol_assignments_no_truncate BEFORE TRUNCATE ON public.idol_assignments FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

-- The latest row is the current assignment; no row, or a NULL broker, is unassigned.
CREATE FUNCTION public.idol_current_broker(idol uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT a.broker_identity_id FROM public.idol_assignments a WHERE a.idol_id=$1 ORDER BY a.sequence DESC LIMIT 1
$$;

CREATE FUNCTION public.guard_idol_assignment() RETURNS trigger
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
CREATE TRIGGER idol_assignment_guard BEFORE INSERT ON public.idol_assignments FOR EACH ROW EXECUTE FUNCTION public.guard_idol_assignment();

-- `management.direct` keeps its exact 0022 check. Without it, `management.assigned` covers saving
-- a new artist or one currently assigned to the account, and nothing else.
CREATE FUNCTION public.assert_management_scope(actor uuid,session_id uuid,intent jsonb,target uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE locales public.supported_locale[]:=ARRAY[(intent->>'sourceLocale')::public.supported_locale];
BEGIN
 IF EXISTS(SELECT 1 FROM public.admin_identity_roles ar JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id
  WHERE ar.admin_identity_id=actor AND p.permission_key='management.direct' AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()) THEN
  PERFORM public.assert_admin_catalog_authority(actor,session_id,clock_timestamp(),NULL,'management.direct',locales);
  RETURN;
 END IF;
 PERFORM public.assert_admin_catalog_authority(actor,session_id,clock_timestamp(),NULL,'management.assigned',locales);
 IF intent->>'kind' IS DISTINCT FROM 'SAVE_ARTIST' OR NOT coalesce(public.idol_current_broker(target)=actor
  OR (intent->'id'='null'::jsonb AND NOT EXISTS(SELECT 1 FROM public.idols WHERE id=target)),false) THEN
  RAISE EXCEPTION 'assigned management covers only the account''s own artists' USING ERRCODE='23514'; END IF;
END; $$;

-- The two 0022 functions, unchanged except that their final permission check is the scope above.
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
 PERFORM public.assert_management_scope(o.actor_id,o.session_id,o.intent,o.target_id);
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
 PERFORM public.assert_management_scope(NEW.actor_id,NEW.session_id,NEW.intent,NEW.target_id);
 RETURN NEW;
END; $$;
