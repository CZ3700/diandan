SET search_path = public;
-- V2 plan §4-6 / F1-4: private studio photos documenting delivery of a physical order line.
-- Objects live only in the private SOURCE bucket under fulfillment-proofs/v1/, never in the
-- CDN-readable derivative bucket. Rows are append-only evidence; every write is bound to an exact
-- audit, operation receipt and the operator's canonical session permission at event time.

-- One server-assigned source reservation per upload; completion records verified renditions once.
CREATE TABLE public.fulfillment_proof_uploads (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  fulfillment_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.admin_identities(id),
  session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),
  source_object_key public.media_object_key NOT NULL UNIQUE,
  source_checksum_sha256 public.sha256_hex NOT NULL,
  source_byte_size integer NOT NULL CHECK (source_byte_size BETWEEN 1 AND 26214400),
  source_mime_type text NOT NULL CHECK (source_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  status text NOT NULL CHECK (status IN ('RESERVED', 'READY')),
  created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at public.finite_timestamptz NOT NULL,
  completed_at public.finite_timestamptz,
  completion_audit_log_id uuid UNIQUE REFERENCES public.audit_logs(id),
  display_object_key public.media_object_key UNIQUE,
  display_checksum_sha256 public.sha256_hex,
  display_byte_size integer CHECK (display_byte_size BETWEEN 1 AND 4194304),
  display_width integer CHECK (display_width BETWEEN 1 AND 1600),
  display_height integer CHECK (display_height BETWEEN 1 AND 1600),
  thumbnail_object_key public.media_object_key UNIQUE,
  thumbnail_checksum_sha256 public.sha256_hex,
  thumbnail_byte_size integer CHECK (thumbnail_byte_size BETWEEN 1 AND 524288),
  thumbnail_width integer CHECK (thumbnail_width BETWEEN 1 AND 480),
  thumbnail_height integer CHECK (thumbnail_height BETWEEN 1 AND 480),
  CONSTRAINT fulfillment_proof_uploads_fulfillment_fk
    FOREIGN KEY (fulfillment_id, order_id) REFERENCES public.fulfillments(id, order_id),
  CONSTRAINT fulfillment_proof_uploads_id_fulfillment_unique UNIQUE (id, fulfillment_id),
  CONSTRAINT fulfillment_proof_uploads_source_key_check
    CHECK (source_object_key = 'fulfillment-proofs/v1/sources/' || id::text),
  CONSTRAINT fulfillment_proof_uploads_window_check
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '900 seconds'),
  CONSTRAINT fulfillment_proof_uploads_shape_check CHECK (
    (status = 'RESERVED' AND num_nulls(completed_at, completion_audit_log_id,
      display_object_key, display_checksum_sha256, display_byte_size, display_width, display_height,
      thumbnail_object_key, thumbnail_checksum_sha256, thumbnail_byte_size, thumbnail_width, thumbnail_height) = 12)
    OR (status = 'READY' AND num_nonnulls(completed_at, completion_audit_log_id,
      display_object_key, display_checksum_sha256, display_byte_size, display_width, display_height,
      thumbnail_object_key, thumbnail_checksum_sha256, thumbnail_byte_size, thumbnail_width, thumbnail_height) = 12
      AND completed_at >= created_at AND completed_at < expires_at
      AND display_object_key = 'fulfillment-proofs/v1/renditions/' || id::text || '/' || display_checksum_sha256 || '.webp'
      AND thumbnail_object_key = 'fulfillment-proofs/v1/renditions/' || id::text || '/' || thumbnail_checksum_sha256 || '.webp'
      AND thumbnail_width <= display_width AND thumbnail_height <= display_height)
  )
);
COMMENT ON TABLE public.fulfillment_proof_uploads IS 'Private delivery photo reservations (SOURCE bucket only); READY rows carry metadata-free WebP renditions.';

-- The association the fan-facing order view reads: at most three active photos per physical line.
CREATE TABLE public.fulfillment_proofs (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  fulfillment_id uuid NOT NULL,
  upload_id uuid NOT NULL UNIQUE,
  attachment_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 32767),
  actor_id uuid NOT NULL REFERENCES public.admin_identities(id),
  session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
  audit_log_id uuid NOT NULL REFERENCES public.audit_logs(id),
  privacy_confirmed boolean NOT NULL CHECK (privacy_confirmed),
  created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fulfillment_proofs_fulfillment_fk
    FOREIGN KEY (fulfillment_id, order_id) REFERENCES public.fulfillments(id, order_id),
  CONSTRAINT fulfillment_proofs_upload_fk
    FOREIGN KEY (upload_id, fulfillment_id) REFERENCES public.fulfillment_proof_uploads(id, fulfillment_id),
  CONSTRAINT fulfillment_proofs_sequence_unique UNIQUE (fulfillment_id, sequence),
  CONSTRAINT fulfillment_proofs_id_order_unique UNIQUE (id, order_id)
);
CREATE INDEX fulfillment_proofs_attachment_idx ON public.fulfillment_proofs(attachment_id);
COMMENT ON COLUMN public.fulfillment_proofs.privacy_confirmed IS 'The operator confirmed third-party faces and address details were removed before attaching.';

CREATE TABLE public.fulfillment_proof_withdrawals (
  id uuid PRIMARY KEY,
  proof_id uuid NOT NULL UNIQUE,
  order_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.admin_identities(id),
  session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,127}$'),
  created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fulfillment_proof_withdrawals_proof_fk
    FOREIGN KEY (proof_id, order_id) REFERENCES public.fulfillment_proofs(id, order_id)
);

-- A reservation completes exactly once and only its completion facts may change.
CREATE FUNCTION public.guard_fulfillment_proof_upload() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status IS DISTINCT FROM 'RESERVED' THEN RAISE EXCEPTION 'proof uploads start as reservations' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status IS DISTINCT FROM 'RESERVED' OR NEW.status IS DISTINCT FROM 'READY'
  OR to_jsonb(NEW)-ARRAY['status','completed_at','completion_audit_log_id','display_object_key','display_checksum_sha256','display_byte_size','display_width','display_height','thumbnail_object_key','thumbnail_checksum_sha256','thumbnail_byte_size','thumbnail_width','thumbnail_height']
   IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','completed_at','completion_audit_log_id','display_object_key','display_checksum_sha256','display_byte_size','display_width','display_height','thumbnail_object_key','thumbnail_checksum_sha256','thumbnail_byte_size','thumbnail_width','thumbnail_height'] THEN
  RAISE EXCEPTION 'proof upload may only complete once' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER fulfillment_proof_uploads_guard BEFORE INSERT OR UPDATE ON public.fulfillment_proof_uploads FOR EACH ROW EXECUTE FUNCTION public.guard_fulfillment_proof_upload();

CREATE FUNCTION public.assert_fulfillment_proof_upload() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.audit_logs%ROWTYPE; event_time timestamptz;
BEGIN
 event_time:=CASE WHEN TG_OP='INSERT' THEN NEW.created_at ELSE NEW.completed_at END;
 SELECT * INTO a FROM public.audit_logs WHERE id=CASE WHEN TG_OP='INSERT' THEN NEW.audit_log_id ELSE NEW.completion_audit_log_id END;
 IF a.actor_type IS DISTINCT FROM 'ADMIN' OR a.actor_id IS DISTINCT FROM NEW.actor_id
  OR a.action IS DISTINCT FROM (CASE WHEN TG_OP='INSERT' THEN 'DELIVERY_PROOF_UPLOAD_RESERVED' ELSE 'DELIVERY_PROOF_UPLOAD_COMPLETED' END)
  OR a.subject_type IS DISTINCT FROM 'FULFILLMENT' OR a.subject_id IS DISTINCT FROM NEW.fulfillment_id OR a.outcome IS DISTINCT FROM 'SUCCEEDED'
  OR a.created_at IS DISTINCT FROM event_time OR a.request_id IS NULL OR a.correlation_id IS NULL
  OR NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.read',event_time)
  OR NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.fulfillment',event_time)
  OR NOT EXISTS(SELECT 1 FROM public.fulfillments f JOIN public.order_items i ON i.id=f.order_item_id AND i.order_id=f.order_id
   WHERE f.id=NEW.fulfillment_id AND f.order_id=NEW.order_id AND i.gift_kind IS DISTINCT FROM 'VIRTUAL'
    AND (TG_OP<>'INSERT' OR f.status IN('PREPARING','DELIVERED'))) THEN
  RAISE EXCEPTION 'proof upload requires exact authority, audit and a physical line' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.admin_order_operation_receipts r WHERE r.action='BEGIN_PROOF_UPLOAD' AND r.result_id=NEW.id AND r.audit_log_id=NEW.audit_log_id AND r.order_id=NEW.order_id) THEN
  RAISE EXCEPTION 'proof upload requires an exact operation receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER fulfillment_proof_upload_complete AFTER INSERT OR UPDATE ON public.fulfillment_proof_uploads DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_fulfillment_proof_upload();

CREATE FUNCTION public.assert_fulfillment_proof() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.audit_logs%ROWTYPE; u public.fulfillment_proof_uploads%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.audit_logs WHERE id=NEW.audit_log_id;
 SELECT * INTO u FROM public.fulfillment_proof_uploads WHERE id=NEW.upload_id;
 IF a.actor_type IS DISTINCT FROM 'ADMIN' OR a.actor_id IS DISTINCT FROM NEW.actor_id OR a.action IS DISTINCT FROM 'DELIVERY_PROOF_ATTACHED'
  OR a.subject_type IS DISTINCT FROM 'FULFILLMENT' OR a.subject_id IS DISTINCT FROM NEW.fulfillment_id OR a.outcome IS DISTINCT FROM 'SUCCEEDED'
  OR a.created_at IS DISTINCT FROM NEW.created_at OR a.reason_code IS NULL OR a.request_id IS NULL OR a.correlation_id IS NULL
  OR u.status IS DISTINCT FROM 'READY' OR u.actor_id IS DISTINCT FROM NEW.actor_id OR u.order_id IS DISTINCT FROM NEW.order_id OR u.completed_at>NEW.created_at
  OR NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.read',NEW.created_at)
  OR NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.fulfillment',NEW.created_at)
  OR NOT EXISTS(SELECT 1 FROM public.fulfillments f JOIN public.order_items i ON i.id=f.order_item_id AND i.order_id=f.order_id
   WHERE f.id=NEW.fulfillment_id AND f.order_id=NEW.order_id AND f.status IN('PREPARING','DELIVERED') AND i.gift_kind IS DISTINCT FROM 'VIRTUAL')
  OR (SELECT count(*) FROM public.fulfillment_proofs p WHERE p.fulfillment_id=NEW.fulfillment_id
   AND NOT EXISTS(SELECT 1 FROM public.fulfillment_proof_withdrawals w WHERE w.proof_id=p.id))>3
  OR NOT EXISTS(SELECT 1 FROM public.admin_order_operation_receipts r WHERE r.action='ATTACH_PROOFS' AND r.result_id=NEW.attachment_id AND r.audit_log_id=NEW.audit_log_id AND r.order_id=NEW.order_id) THEN
  RAISE EXCEPTION 'delivery proof requires exact authority, audit, a ready upload and an open physical slot' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER fulfillment_proof_complete AFTER INSERT ON public.fulfillment_proofs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_fulfillment_proof();

CREATE FUNCTION public.assert_fulfillment_proof_withdrawal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.audit_logs%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.audit_logs WHERE id=NEW.audit_log_id;
 IF a.actor_type IS DISTINCT FROM 'ADMIN' OR a.actor_id IS DISTINCT FROM NEW.actor_id OR a.action IS DISTINCT FROM 'DELIVERY_PROOF_WITHDRAWN'
  OR a.subject_type IS DISTINCT FROM 'FULFILLMENT_PROOF' OR a.subject_id IS DISTINCT FROM NEW.proof_id OR a.outcome IS DISTINCT FROM 'SUCCEEDED'
  OR a.created_at IS DISTINCT FROM NEW.created_at OR a.reason_code IS DISTINCT FROM NEW.reason_code OR a.request_id IS NULL OR a.correlation_id IS NULL
  OR NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.read',NEW.created_at)
  OR NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.manage',NEW.created_at)
  OR NOT EXISTS(SELECT 1 FROM public.admin_order_operation_receipts r WHERE r.action='WITHDRAW_PROOF' AND r.result_id=NEW.id AND r.audit_log_id=NEW.audit_log_id AND r.order_id=NEW.order_id) THEN
  RAISE EXCEPTION 'proof withdrawal requires exact manager authority, audit and receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER fulfillment_proof_withdrawal_complete AFTER INSERT ON public.fulfillment_proof_withdrawals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_fulfillment_proof_withdrawal();

CREATE TRIGGER fulfillment_proof_uploads_no_delete BEFORE DELETE ON public.fulfillment_proof_uploads FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['fulfillment_proofs','fulfillment_proof_withdrawals'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_append_only()',name||'_append_only',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['fulfillment_proof_uploads','fulfillment_proofs','fulfillment_proof_withdrawals'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only()',name||'_no_truncate',name);
 END LOOP;
END $$;

-- Operation receipts gain the three replayable proof actions; each binds its exact result row.
ALTER TABLE public.admin_order_operation_receipts
  DROP CONSTRAINT admin_order_operation_receipts_action_check,
  ADD CONSTRAINT admin_order_operation_receipts_action_check
    CHECK (action IN ('REVIEW_MESSAGE','PREPARE','DELIVER','HOLD','RESUME','ADD_NOTE','BEGIN_PROOF_UPLOAD','ATTACH_PROOFS','WITHDRAW_PROOF'));
CREATE OR REPLACE FUNCTION public.assert_admin_order_operation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.audit_logs%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.audit_logs WHERE id=NEW.audit_log_id;
 IF a.actor_type IS DISTINCT FROM 'ADMIN' OR a.actor_id IS DISTINCT FROM NEW.actor_id OR a.outcome IS DISTINCT FROM 'SUCCEEDED' OR a.created_at IS DISTINCT FROM NEW.created_at OR a.request_id IS DISTINCT FROM NEW.request_id OR a.correlation_id IS DISTINCT FROM NEW.correlation_id OR NOT EXISTS(SELECT 1 FROM public.admin_sessions WHERE id=NEW.session_id AND admin_identity_id=NEW.actor_id) THEN RAISE EXCEPTION 'order operation receipt requires exact authority' USING ERRCODE='23514'; END IF;
 IF NOT(CASE NEW.action WHEN 'ADD_NOTE' THEN EXISTS(SELECT 1 FROM public.admin_order_notes r WHERE r.id=NEW.result_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.audit_log_id=NEW.audit_log_id AND r.created_at=NEW.created_at)
 WHEN 'REVIEW_MESSAGE' THEN EXISTS(SELECT 1 FROM public.admin_order_message_reviews r WHERE r.id=NEW.result_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.audit_log_id=NEW.audit_log_id AND r.created_at=NEW.created_at)
 WHEN 'BEGIN_PROOF_UPLOAD' THEN EXISTS(SELECT 1 FROM public.fulfillment_proof_uploads r WHERE r.id=NEW.result_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.audit_log_id=NEW.audit_log_id AND r.created_at=NEW.created_at)
 WHEN 'ATTACH_PROOFS' THEN EXISTS(SELECT 1 FROM public.fulfillment_proofs r WHERE r.attachment_id=NEW.result_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.audit_log_id=NEW.audit_log_id AND r.created_at=NEW.created_at)
 WHEN 'WITHDRAW_PROOF' THEN EXISTS(SELECT 1 FROM public.fulfillment_proof_withdrawals r WHERE r.id=NEW.result_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.audit_log_id=NEW.audit_log_id AND r.created_at=NEW.created_at)
 ELSE EXISTS(SELECT 1 FROM public.admin_order_fulfillment_receipts r WHERE r.id=NEW.result_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.action=NEW.action AND r.audit_log_id=NEW.audit_log_id AND r.created_at=NEW.created_at) END) THEN RAISE EXCEPTION 'order operation receipt result must be exact' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
