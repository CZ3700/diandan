-- Administrative resource evidence is additive; existing content and processing history stays intact.
CREATE TABLE public.policy_registration_receipts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  policy_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES public.admin_sessions(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  created_at public.finite_timestamptz NOT NULL,
  field_paths text[] NOT NULL DEFAULT ARRAY['policy'] CHECK (field_paths=ARRAY['policy']),
  CONSTRAINT policy_registration_owner_fk FOREIGN KEY(policy_key,kind) REFERENCES public.policies(policy_key,kind) ON DELETE RESTRICT
);

CREATE TABLE public.media_upload_reservations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  actor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES public.admin_sessions(id) ON DELETE RESTRICT,
  object_key public.media_object_key NOT NULL UNIQUE,
  checksum_sha256 public.sha256_hex NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/avif')),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  rights_reference text NOT NULL CHECK (length(rights_reference) BETWEEN 1 AND 256 AND rights_reference ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]*$' AND strpos(rights_reference,'://')=0 AND strpos(rights_reference,'..')=0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','REGISTERED')),
  version integer NOT NULL DEFAULT 1 CHECK (version IN (1,2)),
  created_at public.finite_timestamptz NOT NULL,
  expires_at public.finite_timestamptz NOT NULL,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  registered_asset_id uuid REFERENCES public.media_assets(id) ON DELETE RESTRICT,
  registered_at public.finite_timestamptz,
  registration_audit_log_id uuid UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  verified_width integer CHECK (verified_width BETWEEN 1 AND 20000),
  verified_height integer CHECK (verified_height BETWEEN 1 AND 20000),
  verified_orientation smallint CHECK (verified_orientation BETWEEN 1 AND 8),
  field_paths text[] NOT NULL DEFAULT ARRAY['upload'] CHECK (field_paths=ARRAY['upload']),
  registration_field_paths text[],
  CHECK (object_key='uploads/v1/'||id::text),
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '900 seconds'),
  CHECK (verified_width::bigint*verified_height<=40000000),
  CHECK ((status='PENDING' AND version=1 AND num_nonnulls(registered_asset_id,registered_at,registration_audit_log_id,verified_width,verified_height,verified_orientation,registration_field_paths)=0)
    OR (status='REGISTERED' AND version=2 AND num_nonnulls(registered_asset_id,registered_at,registration_audit_log_id,verified_width,verified_height,verified_orientation,registration_field_paths)=7
      AND registered_at>=created_at AND registration_field_paths=ARRAY['registration']))
);
CREATE INDEX media_upload_reservations_actor_idx ON public.media_upload_reservations(actor_id,created_at,id);
CREATE INDEX media_upload_reservations_pending_expiry_idx ON public.media_upload_reservations(expires_at,id) WHERE status='PENDING';

CREATE TABLE public.media_rights_events (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  asset_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version>0),
  previous_status text NOT NULL CHECK (previous_status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  new_status text NOT NULL CHECK (new_status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  evidence_reference text NOT NULL CHECK (length(evidence_reference) BETWEEN 1 AND 256 AND evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]*$' AND strpos(evidence_reference,'://')=0 AND strpos(evidence_reference,'..')=0),
  actor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES public.admin_sessions(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  created_at public.finite_timestamptz NOT NULL,
  field_paths text[] NOT NULL CHECK (field_paths=CASE WHEN previous_status=new_status THEN ARRAY['rightsEvidence'] ELSE ARRAY['rightsStatus','rightsEvidence'] END),
  CONSTRAINT media_rights_event_version_unique UNIQUE(asset_id,version)
);

ALTER TABLE public.media_processing_jobs ADD COLUMN generation integer NOT NULL DEFAULT 1 CHECK (generation>0);
ALTER TABLE public.media_processing_jobs ADD COLUMN retry_of_job_id uuid REFERENCES public.media_processing_jobs(id) ON DELETE RESTRICT;
ALTER TABLE public.media_processing_jobs DROP CONSTRAINT media_processing_jobs_command_hash_key;
ALTER TABLE public.media_processing_jobs ADD CONSTRAINT media_processing_command_generation_unique UNIQUE(command_hash,generation);
ALTER TABLE public.media_processing_jobs ADD CONSTRAINT media_processing_retry_shape CHECK ((generation=1 AND retry_of_job_id IS NULL) OR (generation>1 AND retry_of_job_id IS NOT NULL));
CREATE UNIQUE INDEX media_processing_retry_successor_unique ON public.media_processing_jobs(retry_of_job_id) WHERE retry_of_job_id IS NOT NULL;

CREATE TABLE public.media_processing_admin_receipts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  job_id uuid NOT NULL REFERENCES public.media_processing_jobs(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('ENQUEUE','RETRY')),
  actor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES public.admin_sessions(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  created_at public.finite_timestamptz NOT NULL,
  field_paths text[] NOT NULL DEFAULT ARRAY['processingJob'] CHECK (field_paths=ARRAY['processingJob'])
);
CREATE UNIQUE INDEX media_processing_retry_receipt_unique ON public.media_processing_admin_receipts(job_id) WHERE action='RETRY';

CREATE FUNCTION public.assert_resource_management_audit(audit_id uuid, actor uuid, session_id uuid, expected_action text, expected_subject text, subject uuid, event_time timestamptz, causal_lower_bound timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE evidence public.audit_logs%ROWTYPE; session public.admin_sessions%ROWTYPE; identity_status text; required_permission text;
BEGIN
  SELECT * INTO evidence FROM public.audit_logs WHERE id=audit_id;
  SELECT * INTO session FROM public.admin_sessions WHERE id=session_id FOR SHARE;
  SELECT status INTO identity_status FROM public.admin_identities WHERE id=actor FOR SHARE;
  IF evidence.id IS NULL OR evidence.actor_type<>'ADMIN' OR evidence.actor_id IS DISTINCT FROM actor OR evidence.action<>expected_action
    OR evidence.subject_type<>expected_subject OR evidence.subject_id<>subject OR evidence.outcome<>'SUCCEEDED'
    OR evidence.created_at<>event_time OR evidence.reason_code IS NULL OR evidence.request_id IS NULL OR evidence.correlation_id IS NULL
    OR evidence.field_category IS DISTINCT FROM 'RESOURCE_MANAGEMENT' THEN
    RAISE EXCEPTION 'resource operation requires its exact audit' USING ERRCODE='23514';
  END IF;
  IF session.id IS NULL OR session.admin_identity_id<>actor OR identity_status IS DISTINCT FROM 'ACTIVE'
    OR NOT session.authenticated_with_mfa OR session.revoked_at IS NOT NULL OR session.expires_at<=clock_timestamp()
    OR session.created_at>clock_timestamp() OR event_time<session.created_at
    OR event_time>GREATEST(clock_timestamp(),transaction_timestamp(),session.created_at,causal_lower_bound) THEN
    RAISE EXCEPTION 'resource operation requires its active MFA actor session' USING ERRCODE='23514';
  END IF;
  required_permission:=CASE expected_action WHEN 'POLICY_REGISTER' THEN 'content.policy.manage'
    WHEN 'MEDIA_UPLOAD_BEGIN' THEN 'content.media.upload' WHEN 'MEDIA_UPLOAD_REGISTER' THEN 'content.media.upload'
    WHEN 'MEDIA_RIGHTS_SET' THEN 'content.media.rights' WHEN 'MEDIA_PROCESSING_ENQUEUE' THEN 'content.media.process'
    WHEN 'MEDIA_PROCESSING_RETRY' THEN 'content.media.process' END;
  PERFORM ar.role_id FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id
    JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id
    WHERE ar.admin_identity_id=actor AND p.permission_key=required_permission
      AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()
      AND ar.granted_at<=event_time AND rp.granted_at<=event_time FOR SHARE OF ar,r,rp,p;
  IF NOT FOUND THEN RAISE EXCEPTION 'resource operation requires its current specific permission' USING ERRCODE='23514'; END IF;
END; $$;

CREATE FUNCTION public.assert_policy_registration_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE owner public.policies%ROWTYPE;
BEGIN
  SELECT * INTO owner FROM public.policies WHERE policy_key=NEW.policy_key FOR UPDATE;
  IF owner.policy_key IS NULL OR owner.kind<>NEW.kind OR owner.created_at<>NEW.created_at THEN
    RAISE EXCEPTION 'policy registration requires exact immutable owner' USING ERRCODE='23514';
  END IF;
  PERFORM public.assert_resource_management_audit(NEW.audit_log_id,NEW.actor_id,NEW.session_id,'POLICY_REGISTER','POLICY_REGISTRATION',NEW.id,NEW.created_at);
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER policy_registration_receipt_validate AFTER INSERT ON public.policy_registration_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_policy_registration_receipt();
CREATE FUNCTION public.guard_registered_policy_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.policy_registration_receipts WHERE policy_key=OLD.policy_key) THEN
    RAISE EXCEPTION 'registered policy owner is immutable' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER registered_policy_owner_guard BEFORE UPDATE OR DELETE ON public.policies FOR EACH ROW EXECUTE FUNCTION public.guard_registered_policy_owner();

CREATE FUNCTION public.guard_media_upload_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE session public.admin_sessions%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO session FROM public.admin_sessions WHERE id=NEW.session_id FOR SHARE;
    IF NEW.status<>'PENDING' OR NEW.version<>1 OR session.id IS NULL OR NEW.expires_at>session.expires_at
      OR NEW.expires_at>clock_timestamp()+interval '900 seconds' OR NEW.created_at>GREATEST(clock_timestamp(),transaction_timestamp(),session.created_at) THEN
      RAISE EXCEPTION 'upload reservation requires a bounded initial ticket' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status<>'PENDING' OR NEW.status<>'REGISTERED' OR NEW.version<>2
    OR to_jsonb(NEW)-ARRAY['status','version','registered_asset_id','registered_at','registration_audit_log_id','verified_width','verified_height','verified_orientation','registration_field_paths']
      IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','version','registered_asset_id','registered_at','registration_audit_log_id','verified_width','verified_height','verified_orientation','registration_field_paths'] THEN
    RAISE EXCEPTION 'upload reservation permits only one immutable registration' USING ERRCODE='55000';
  END IF;
  IF OLD.expires_at<=clock_timestamp() OR NEW.registered_at>GREATEST(clock_timestamp(),transaction_timestamp(),OLD.created_at) THEN
    RAISE EXCEPTION 'upload registration requires an unexpired ticket' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER media_upload_reservation_guard BEFORE INSERT OR UPDATE ON public.media_upload_reservations FOR EACH ROW EXECUTE FUNCTION public.guard_media_upload_reservation();

CREATE FUNCTION public.assert_media_upload_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset public.media_assets%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM public.assert_resource_management_audit(NEW.audit_log_id,NEW.actor_id,NEW.session_id,'MEDIA_UPLOAD_BEGIN','MEDIA_UPLOAD_RESERVATION',NEW.id,NEW.created_at);
  ELSE
    SELECT * INTO asset FROM public.media_assets WHERE id=NEW.registered_asset_id FOR SHARE;
    IF asset.id IS NULL OR asset.identity_kind<>'SOURCE' OR asset.checksum_sha256<>NEW.checksum_sha256 OR asset.mime_type<>NEW.mime_type
      OR asset.byte_size<>NEW.byte_size OR asset.width<>NEW.verified_width OR asset.height<>NEW.verified_height OR asset.processing_status='ARCHIVED' THEN
      RAISE EXCEPTION 'upload registration requires exact verified source identity' USING ERRCODE='23514';
    END IF;
    PERFORM public.assert_resource_management_audit(NEW.registration_audit_log_id,NEW.actor_id,NEW.session_id,'MEDIA_UPLOAD_REGISTER','MEDIA_UPLOAD_RESERVATION',NEW.id,NEW.registered_at,NEW.created_at);
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER media_upload_reservation_validate AFTER INSERT OR UPDATE ON public.media_upload_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_media_upload_reservation();

CREATE FUNCTION public.assert_reserved_media_source() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.object_key NOT LIKE 'uploads/v1/%' THEN RETURN NULL; END IF;
  IF NEW.identity_kind<>'SOURCE' OR NEW.processing_status<>'PENDING' OR NEW.rights_status<>'PENDING'
    OR NOT EXISTS(SELECT 1 FROM public.media_upload_reservations ticket WHERE ticket.object_key=NEW.object_key AND ticket.status='REGISTERED'
      AND ticket.registered_asset_id=NEW.id AND ticket.checksum_sha256=NEW.checksum_sha256 AND ticket.mime_type=NEW.mime_type
      AND ticket.byte_size=NEW.byte_size AND ticket.verified_width=NEW.width AND ticket.verified_height=NEW.height
      AND ticket.rights_reference=NEW.rights_reference AND ticket.registered_at=NEW.created_at) THEN
    RAISE EXCEPTION 'reserved original requires its completed trusted registration' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER reserved_media_source_validate AFTER INSERT ON public.media_assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_reserved_media_source();

CREATE FUNCTION public.guard_media_rights_event() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset public.media_assets%ROWTYPE; previous public.media_rights_events%ROWTYPE;
BEGIN
  SELECT * INTO asset FROM public.media_assets WHERE id=NEW.asset_id FOR UPDATE;
  SELECT * INTO previous FROM public.media_rights_events WHERE asset_id=NEW.asset_id ORDER BY version DESC LIMIT 1;
  IF asset.id IS NULL OR NEW.version<>COALESCE(previous.version,0)+1 OR NEW.previous_status<>COALESCE(previous.new_status,asset.rights_status)
    OR asset.rights_status<>NEW.previous_status OR NEW.created_at<GREATEST(asset.created_at,previous.created_at) THEN
    RAISE EXCEPTION 'rights event must advance its locked canonical status and version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER media_rights_event_guard BEFORE INSERT ON public.media_rights_events FOR EACH ROW EXECUTE FUNCTION public.guard_media_rights_event();

CREATE FUNCTION public.assert_media_rights_event() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_status text; asset_created timestamptz; previous_time timestamptz; latest public.media_rights_events%ROWTYPE;
BEGIN
  SELECT rights_status,created_at INTO current_status,asset_created FROM public.media_assets WHERE id=NEW.asset_id;
  SELECT max(created_at) INTO previous_time FROM public.media_rights_events WHERE asset_id=NEW.asset_id AND version<NEW.version;
  SELECT * INTO latest FROM public.media_rights_events WHERE asset_id=NEW.asset_id ORDER BY version DESC LIMIT 1;
  IF current_status IS DISTINCT FROM latest.new_status THEN
    RAISE EXCEPTION 'rights event and asset status must commit together' USING ERRCODE='23514';
  END IF;
  PERFORM public.assert_resource_management_audit(NEW.audit_log_id,NEW.actor_id,NEW.session_id,'MEDIA_RIGHTS_SET','MEDIA_RIGHTS_EVENT',NEW.id,NEW.created_at,GREATEST(asset_created,previous_time));
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER media_rights_event_validate AFTER INSERT ON public.media_rights_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_media_rights_event();
CREATE FUNCTION public.assert_media_rights_status_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE latest public.media_rights_events%ROWTYPE;
BEGIN
  IF NEW.rights_status=OLD.rights_status THEN RETURN NULL; END IF;
  SELECT * INTO latest FROM public.media_rights_events WHERE asset_id=NEW.id ORDER BY version DESC LIMIT 1;
  IF latest.id IS NULL OR latest.previous_status<>OLD.rights_status OR latest.new_status<>NEW.rights_status THEN
    RAISE EXCEPTION 'asset rights transition requires its exact immutable event' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER media_rights_status_evidence AFTER UPDATE OF rights_status ON public.media_assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_media_rights_status_change();

CREATE FUNCTION public.guard_media_processing_generation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE previous public.media_processing_jobs%ROWTYPE;
BEGIN
  IF NEW.generation=1 THEN RETURN NEW; END IF;
  SELECT * INTO previous FROM public.media_processing_jobs WHERE id=NEW.retry_of_job_id FOR UPDATE;
  IF previous.id IS NULL OR previous.status<>'FAILED' OR NEW.generation<>previous.generation+1
    OR ROW(NEW.source_asset_id,NEW.source_metadata_revision_id,NEW.source_checksum_sha256,NEW.profile_version,NEW.role,NEW.fit,NEW.focal_x,NEW.focal_y,NEW.command_hash)
      IS DISTINCT FROM ROW(previous.source_asset_id,previous.source_metadata_revision_id,previous.source_checksum_sha256,previous.profile_version,previous.role,previous.fit,previous.focal_x,previous.focal_y,previous.command_hash)
    OR NEW.created_at<GREATEST(previous.created_at,previous.updated_at,previous.completed_at)
    OR NEW.created_at>GREATEST(clock_timestamp(),transaction_timestamp(),previous.created_at,previous.updated_at,previous.completed_at) THEN
    RAISE EXCEPTION 'manual retry requires the next generation of its failed immutable recipe' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER a_media_processing_generation_guard BEFORE INSERT ON public.media_processing_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_media_processing_generation();

CREATE FUNCTION public.assert_media_processing_admin_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.media_processing_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.media_processing_jobs WHERE id=NEW.job_id FOR UPDATE;
  IF job.id IS NULL OR (NEW.action='ENQUEUE' AND job.generation<>1) OR (NEW.action='RETRY' AND job.generation=1)
    OR NEW.created_at<job.created_at OR (NEW.action='RETRY' AND (job.requested_by<>NEW.actor_id OR NEW.created_at<>job.created_at)) THEN
    RAISE EXCEPTION 'processing administration requires its exact job generation' USING ERRCODE='23514';
  END IF;
  IF NEW.action='RETRY' AND NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE id=NEW.audit_log_id AND reason_code=job.reason) THEN
    RAISE EXCEPTION 'manual retry reason must bind its job and audit' USING ERRCODE='23514';
  END IF;
  PERFORM public.assert_resource_management_audit(NEW.audit_log_id,NEW.actor_id,NEW.session_id,'MEDIA_PROCESSING_'||NEW.action,'MEDIA_PROCESSING_JOB',NEW.job_id,NEW.created_at,job.created_at);
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER media_processing_admin_receipt_validate AFTER INSERT ON public.media_processing_admin_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_media_processing_admin_receipt();
CREATE FUNCTION public.assert_media_processing_retry_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.generation>1 AND NOT EXISTS(SELECT 1 FROM public.media_processing_admin_receipts WHERE job_id=NEW.id AND action='RETRY') THEN
    RAISE EXCEPTION 'manual processing retry requires permanent audit evidence' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER media_processing_retry_receipt_validate AFTER INSERT ON public.media_processing_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_media_processing_retry_receipt();

CREATE TRIGGER policy_registration_receipts_append_only BEFORE UPDATE OR DELETE ON public.policy_registration_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER policy_registration_receipts_no_truncate BEFORE TRUNCATE ON public.policy_registration_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER media_upload_reservations_no_delete BEFORE DELETE ON public.media_upload_reservations FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER media_upload_reservations_no_truncate BEFORE TRUNCATE ON public.media_upload_reservations FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER media_rights_events_append_only BEFORE UPDATE OR DELETE ON public.media_rights_events FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER media_rights_events_no_truncate BEFORE TRUNCATE ON public.media_rights_events FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER media_processing_admin_receipts_append_only BEFORE UPDATE OR DELETE ON public.media_processing_admin_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER media_processing_admin_receipts_no_truncate BEFORE TRUNCATE ON public.media_processing_admin_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
