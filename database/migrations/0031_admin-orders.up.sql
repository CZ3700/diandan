SET search_path=public;

CREATE TABLE public.admin_order_message_locale_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_identity_id uuid NOT NULL REFERENCES public.admin_identities(id),
 locale public.supported_locale NOT NULL, granted_by uuid NOT NULL REFERENCES public.admin_identities(id),
 granted_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id), revoked_at public.finite_timestamptz,
 revoked_audit_log_id uuid UNIQUE REFERENCES public.audit_logs(id),
 CHECK((revoked_at IS NULL)=(revoked_audit_log_id IS NULL)), CHECK(revoked_at IS NULL OR revoked_at>=granted_at)
);
CREATE UNIQUE INDEX admin_order_message_locale_active ON public.admin_order_message_locale_grants(admin_identity_id,locale) WHERE revoked_at IS NULL;
CREATE FUNCTION public.guard_admin_order_message_locale() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.audit_logs%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.revoked_at IS NOT NULL OR NEW.granted_at>clock_timestamp() THEN RAISE EXCEPTION 'invalid initial order language grant' USING ERRCODE='23514'; END IF;
  SELECT * INTO a FROM public.audit_logs WHERE id=NEW.audit_log_id;
  IF a.action IS DISTINCT FROM 'ORDER_MESSAGE_LOCALE_GRANT' OR a.actor_id IS DISTINCT FROM NEW.granted_by OR a.created_at IS DISTINCT FROM NEW.granted_at THEN RAISE EXCEPTION 'order language grant requires exact audit' USING ERRCODE='23514'; END IF;
 ELSE
  IF to_jsonb(NEW)-ARRAY['revoked_at','revoked_audit_log_id'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['revoked_at','revoked_audit_log_id'] OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_at>clock_timestamp() THEN RAISE EXCEPTION 'order language grant only permits one-way revocation' USING ERRCODE='55000'; END IF;
  SELECT * INTO a FROM public.audit_logs WHERE id=NEW.revoked_audit_log_id;
  IF a.action IS DISTINCT FROM 'ORDER_MESSAGE_LOCALE_REVOKE' OR a.created_at IS DISTINCT FROM NEW.revoked_at THEN RAISE EXCEPTION 'order language revocation requires exact audit' USING ERRCODE='23514'; END IF;
 END IF;
 IF a.actor_type IS DISTINCT FROM 'ADMIN' OR a.subject_type IS DISTINCT FROM 'ADMIN_ORDER_MESSAGE_LOCALE_GRANT' OR a.subject_id IS DISTINCT FROM NEW.admin_identity_id OR a.outcome IS DISTINCT FROM 'SUCCEEDED' OR a.reason_code IS NULL OR a.request_id IS NULL OR a.correlation_id IS NULL OR a.field_category IS DISTINCT FROM 'SUPPORT_INTENT_PRIVATE' OR NOT EXISTS(SELECT 1 FROM public.admin_identities WHERE id=a.actor_id AND status='ACTIVE') THEN RAISE EXCEPTION 'order language audit authority invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER admin_order_message_locale_guard BEFORE INSERT OR UPDATE ON public.admin_order_message_locale_grants FOR EACH ROW EXECUTE FUNCTION public.guard_admin_order_message_locale();
CREATE TRIGGER admin_order_message_locale_no_delete BEFORE DELETE ON public.admin_order_message_locale_grants FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER admin_order_message_locale_no_truncate BEFORE TRUNCATE ON public.admin_order_message_locale_grants FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE TABLE public.admin_order_notes (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.orders(id), actor_id uuid NOT NULL REFERENCES public.admin_identities(id),
 session_id uuid NOT NULL REFERENCES public.admin_sessions(id), ciphertext public.ciphertext_bytes NOT NULL,
 encrypted_data_key public.ciphertext_bytes NOT NULL, key_version text NOT NULL CHECK(key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id), created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(id,order_id)
);
CREATE INDEX admin_order_notes_order ON public.admin_order_notes(order_id,created_at DESC,id DESC);
CREATE TABLE public.admin_order_private_accesses (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES public.admin_identities(id), session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 order_id uuid NOT NULL REFERENCES public.orders(id), kind text NOT NULL CHECK(kind IN('MESSAGE','NOTES')),
 item_id uuid, support_intent_id uuid REFERENCES public.support_intents(id), intent_version public.positive_version,
 review_locale public.supported_locale, material_hash public.sha256_hex, note_ids uuid[] NOT NULL DEFAULT '{}',
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id), request_id uuid NOT NULL,correlation_id uuid NOT NULL,
 created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(), expires_at public.finite_timestamptz NOT NULL,
 FOREIGN KEY(item_id,order_id) REFERENCES public.order_items(id,order_id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '300 seconds'),
 CHECK((kind='MESSAGE' AND num_nonnulls(item_id,support_intent_id,intent_version,review_locale,material_hash)=5 AND cardinality(note_ids)=0)
 OR(kind='NOTES' AND num_nonnulls(item_id,support_intent_id,intent_version,review_locale,material_hash)=0 AND cardinality(note_ids)<=50))
);
CREATE TABLE public.admin_order_private_confirmations (
 access_id uuid PRIMARY KEY REFERENCES public.admin_order_private_accesses(id), confirmed_at public.finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.admin_order_message_reviews (
 id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES public.orders(id),item_id uuid NOT NULL,support_intent_id uuid NOT NULL REFERENCES public.support_intents(id),
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id),session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 access_id uuid NOT NULL UNIQUE REFERENCES public.admin_order_private_accesses(id), expected_intent_version public.positive_version NOT NULL,
 result_intent_version public.positive_version NOT NULL,review_locale public.supported_locale NOT NULL,language_confirmed boolean NOT NULL CHECK(language_confirmed),
 decision text NOT NULL CHECK(decision IN('APPROVED','REJECTED')),reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{1,127}$'),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
 FOREIGN KEY(item_id,order_id) REFERENCES public.order_items(id,order_id),UNIQUE(support_intent_id,result_intent_version),CHECK(result_intent_version=expected_intent_version+1)
);
CREATE TABLE public.admin_order_operation_receipts (
 id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES public.admin_identities(id),session_id uuid NOT NULL REFERENCES public.admin_sessions(id),order_id uuid NOT NULL REFERENCES public.orders(id),
 action text NOT NULL CHECK(action IN('REVIEW_MESSAGE','PREPARE','DELIVER','HOLD','RESUME','ADD_NOTE')),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),request_hash public.sha256_hex NOT NULL,result_id uuid NOT NULL,
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),request_id uuid NOT NULL,correlation_id uuid NOT NULL,
 created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),UNIQUE(actor_id,action,idempotency_key)
);
CREATE TABLE public.admin_order_fulfillment_receipts (
 id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES public.orders(id),fulfillment_id uuid NOT NULL REFERENCES public.fulfillments(id),
 fulfillment_event_id uuid NOT NULL UNIQUE REFERENCES public.fulfillment_events(id),outbox_event_id uuid NOT NULL UNIQUE REFERENCES public.outbox_events(id),
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id),session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 action text NOT NULL CHECK(action IN('PREPARE','DELIVER','HOLD','RESUME')),expected_order_version public.positive_version NOT NULL,
 expected_fulfillment_version public.positive_version NOT NULL,reason_code text NOT NULL,confirmed boolean NOT NULL,
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CHECK(action NOT IN('HOLD','RESUME') OR confirmed)
);
CREATE FUNCTION public.assert_admin_order_access() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.audit_logs%ROWTYPE; s public.admin_sessions%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.audit_logs WHERE id=NEW.audit_log_id;
 SELECT * INTO s FROM public.admin_sessions WHERE id=NEW.session_id;
 IF a.actor_type IS DISTINCT FROM 'ADMIN' OR a.actor_id IS DISTINCT FROM NEW.actor_id OR a.subject_type IS DISTINCT FROM 'ORDER' OR a.subject_id IS DISTINCT FROM NEW.order_id OR a.action IS DISTINCT FROM 'ORDER_PRIVATE_READ' OR a.field_category IS DISTINCT FROM 'ORDER_PRIVATE' OR a.outcome IS DISTINCT FROM 'SUCCEEDED' OR a.created_at IS DISTINCT FROM NEW.created_at OR a.request_id IS DISTINCT FROM NEW.request_id OR a.correlation_id IS DISTINCT FROM NEW.correlation_id OR s.admin_identity_id IS DISTINCT FROM NEW.actor_id THEN RAISE EXCEPTION 'private order read requires exact session and audit' USING ERRCODE='23514'; END IF;
 IF NEW.kind='MESSAGE' AND NOT EXISTS(SELECT 1 FROM public.order_items i JOIN public.support_intents intent ON intent.id=i.support_intent_id WHERE i.id=NEW.item_id AND i.order_id=NEW.order_id AND intent.id=NEW.support_intent_id AND intent.version=NEW.intent_version AND intent.privacy_state='ACTIVE' AND public.cart_private_material_hash(intent.fan_message_ciphertext,intent.display_mode,intent.display_name_ciphertext,intent.encrypted_data_key,intent.encryption_key_version,intent.fan_message_locale)=NEW.material_hash) THEN RAISE EXCEPTION 'private access must bind exact active content' USING ERRCODE='23514'; END IF;
 IF NEW.kind='NOTES' AND EXISTS(SELECT 1 FROM unnest(NEW.note_ids) id WHERE NOT EXISTS(SELECT 1 FROM public.admin_order_notes n WHERE n.id=id AND n.order_id=NEW.order_id)) THEN RAISE EXCEPTION 'note access must bind exact order membership' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_order_access_complete AFTER INSERT ON public.admin_order_private_accesses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_order_access();
CREATE FUNCTION public.assert_admin_order_confirmation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.admin_order_private_accesses a JOIN public.admin_sessions s ON s.id=a.session_id JOIN public.admin_identities i ON i.id=a.actor_id WHERE a.id=NEW.access_id AND a.created_at<=NEW.confirmed_at AND a.expires_at>NEW.confirmed_at AND NEW.confirmed_at<=clock_timestamp() AND s.admin_identity_id=a.actor_id AND s.revoked_at IS NULL AND s.expires_at>NEW.confirmed_at AND i.status='ACTIVE') THEN RAISE EXCEPTION 'private confirmation requires live same-session access' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_order_confirmation_complete AFTER INSERT ON public.admin_order_private_confirmations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_order_confirmation();
CREATE FUNCTION public.assert_admin_order_review() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE intent public.support_intents%ROWTYPE; access public.admin_order_private_accesses%ROWTYPE; a public.audit_logs%ROWTYPE;
BEGIN
 SELECT * INTO intent FROM public.support_intents WHERE id=NEW.support_intent_id;
 SELECT * INTO access FROM public.admin_order_private_accesses WHERE id=NEW.access_id;
 SELECT * INTO a FROM public.audit_logs WHERE id=NEW.audit_log_id;
 IF intent.version IS DISTINCT FROM NEW.result_intent_version OR intent.moderation_status IS DISTINCT FROM NEW.decision OR intent.moderation_decision_kind IS DISTINCT FROM 'HUMAN' OR intent.moderation_reviewer_id IS DISTINCT FROM NEW.actor_id OR intent.reviewed_at IS DISTINCT FROM NEW.created_at OR intent.privacy_state IS DISTINCT FROM 'ACTIVE'
 OR access.kind IS DISTINCT FROM 'MESSAGE' OR access.actor_id IS DISTINCT FROM NEW.actor_id OR access.session_id IS DISTINCT FROM NEW.session_id OR access.order_id IS DISTINCT FROM NEW.order_id OR access.item_id IS DISTINCT FROM NEW.item_id OR access.support_intent_id IS DISTINCT FROM NEW.support_intent_id OR access.intent_version IS DISTINCT FROM NEW.expected_intent_version OR access.review_locale IS DISTINCT FROM NEW.review_locale OR access.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.admin_order_private_confirmations WHERE access_id=access.id)
 OR NOT EXISTS(SELECT 1 FROM public.admin_order_message_locale_grants WHERE admin_identity_id=NEW.actor_id AND locale=NEW.review_locale AND revoked_at IS NULL AND granted_at<=clock_timestamp())
 OR a.actor_type IS DISTINCT FROM 'ADMIN' OR a.actor_id IS DISTINCT FROM NEW.actor_id OR a.action IS DISTINCT FROM 'ORDER_MESSAGE_REVIEWED' OR a.subject_type IS DISTINCT FROM 'SUPPORT_INTENT' OR a.subject_id IS DISTINCT FROM NEW.support_intent_id OR a.reason_code IS DISTINCT FROM NEW.reason_code OR a.outcome IS DISTINCT FROM 'SUCCEEDED' OR a.created_at IS DISTINCT FROM NEW.created_at THEN RAISE EXCEPTION 'review requires exact private access, language, mutation and audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_order_review_complete AFTER INSERT ON public.admin_order_message_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_order_review();
CREATE FUNCTION public.assert_admin_order_operation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.audit_logs%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.audit_logs WHERE id=NEW.audit_log_id;
 IF a.actor_type IS DISTINCT FROM 'ADMIN' OR a.actor_id IS DISTINCT FROM NEW.actor_id OR a.outcome IS DISTINCT FROM 'SUCCEEDED' OR a.created_at IS DISTINCT FROM NEW.created_at OR a.request_id IS DISTINCT FROM NEW.request_id OR a.correlation_id IS DISTINCT FROM NEW.correlation_id OR NOT EXISTS(SELECT 1 FROM public.admin_sessions WHERE id=NEW.session_id AND admin_identity_id=NEW.actor_id) THEN RAISE EXCEPTION 'order operation receipt requires exact authority' USING ERRCODE='23514'; END IF;
 IF NOT(CASE NEW.action WHEN 'ADD_NOTE' THEN EXISTS(SELECT 1 FROM public.admin_order_notes r WHERE r.id=NEW.result_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.audit_log_id=NEW.audit_log_id AND r.created_at=NEW.created_at)
 WHEN 'REVIEW_MESSAGE' THEN EXISTS(SELECT 1 FROM public.admin_order_message_reviews r WHERE r.id=NEW.result_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.audit_log_id=NEW.audit_log_id AND r.created_at=NEW.created_at)
 ELSE EXISTS(SELECT 1 FROM public.admin_order_fulfillment_receipts r WHERE r.id=NEW.result_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.action=NEW.action AND r.audit_log_id=NEW.audit_log_id AND r.created_at=NEW.created_at) END) THEN RAISE EXCEPTION 'order operation receipt result must be exact' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_order_operation_complete AFTER INSERT ON public.admin_order_operation_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_order_operation();
CREATE FUNCTION public.assert_admin_order_fulfillment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.fulfillment_events%ROWTYPE; target text;
BEGIN
 SELECT * INTO e FROM public.fulfillment_events WHERE id=NEW.fulfillment_event_id;
 target:=CASE NEW.action WHEN 'PREPARE' THEN 'PREPARING' WHEN 'DELIVER' THEN 'DELIVERED' WHEN 'HOLD' THEN 'ON_HOLD' ELSE e.to_status END;
 IF e.order_id IS DISTINCT FROM NEW.order_id OR e.fulfillment_id IS DISTINCT FROM NEW.fulfillment_id OR e.sequence IS DISTINCT FROM NEW.expected_fulfillment_version+1 OR e.authority_kind IS DISTINCT FROM 'ADMIN' OR e.admin_identity_id IS DISTINCT FROM NEW.actor_id OR e.audit_log_id IS DISTINCT FROM NEW.audit_log_id OR e.reason_code IS DISTINCT FROM NEW.reason_code OR e.occurred_at IS DISTINCT FROM NEW.created_at OR e.to_status IS DISTINCT FROM target THEN RAISE EXCEPTION 'order fulfillment receipt must bind exact event' USING ERRCODE='23514'; END IF;
 IF NEW.action='RESUME' AND NOT EXISTS(SELECT 1 FROM public.fulfillment_events previous JOIN public.admin_order_fulfillment_receipts receipt ON receipt.fulfillment_event_id=previous.id WHERE previous.fulfillment_id=e.fulfillment_id AND previous.sequence=e.sequence-1 AND previous.to_status='ON_HOLD' AND previous.from_status=e.to_status AND receipt.action='HOLD') THEN RAISE EXCEPTION 'only an owned manager hold may resume' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.outbox_events x WHERE x.id=NEW.outbox_event_id AND x.event_type='FULFILLMENT_STATUS_CHANGED' AND x.aggregate_id=e.fulfillment_id AND x.aggregate_version=e.sequence AND x.secondary_subject_id=e.order_id AND x.primary_subject_id=e.fulfillment_id AND x.payload_status=e.to_status AND x.request_id=e.request_id AND x.correlation_id=e.correlation_id AND x.occurred_at=e.occurred_at) THEN RAISE EXCEPTION 'fulfillment requires exact transactional outbox' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_order_fulfillment_complete AFTER INSERT ON public.admin_order_fulfillment_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_order_fulfillment();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['admin_order_notes','admin_order_private_accesses','admin_order_private_confirmations','admin_order_message_reviews','admin_order_operation_receipts','admin_order_fulfillment_receipts'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_append_only()',name||'_append_only',name);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only()',name||'_no_truncate',name);
 END LOOP;
END $$;

-- These checks close the storage boundary as well as the request boundary. A
-- caller may not fabricate a receipt using an expired session or unrelated role.
CREATE FUNCTION public.admin_order_authorized(session_id uuid, actor uuid, permission text, event_time timestamptz)
RETURNS boolean LANGUAGE sql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.admin_sessions s JOIN public.admin_identities i ON i.id=s.admin_identity_id
  JOIN public.admin_identity_roles ar ON ar.admin_identity_id=i.id
  JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id
  WHERE s.id=session_id AND i.id=actor AND i.status='ACTIVE' AND s.authenticated_with_mfa
   AND s.revoked_at IS NULL AND s.created_at<=event_time AND event_time<=clock_timestamp()
   AND s.expires_at>clock_timestamp() AND p.permission_key=permission
   AND ar.granted_at<=event_time AND rp.granted_at<=event_time
 );
$$;
CREATE FUNCTION public.assert_admin_order_receipt_authority() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE required_permission text; intent public.support_intents%ROWTYPE; a public.admin_order_private_accesses%ROWTYPE;
BEGIN
 required_permission:=CASE TG_TABLE_NAME WHEN 'admin_order_notes' THEN 'orders.note'
 WHEN 'admin_order_private_accesses' THEN CASE to_jsonb(NEW)->>'kind' WHEN 'MESSAGE' THEN 'orders.message.read' ELSE 'orders.note' END
 WHEN 'admin_order_message_reviews' THEN 'orders.message.review'
 WHEN 'admin_order_fulfillment_receipts' THEN CASE WHEN to_jsonb(NEW)->>'action' IN('HOLD','RESUME') THEN 'orders.manage' ELSE 'orders.fulfillment' END END;
 IF NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.read',NEW.created_at)
 OR NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,required_permission,NEW.created_at) THEN
 RAISE EXCEPTION 'order receipt requires current canonical session permission' USING ERRCODE='23514'; END IF;
 IF (TG_TABLE_NAME='admin_order_private_accesses' AND to_jsonb(NEW)->>'kind'='MESSAGE') OR TG_TABLE_NAME='admin_order_message_reviews' THEN
  SELECT * INTO intent FROM public.support_intents WHERE id=NEW.support_intent_id;
  IF NOT EXISTS(SELECT 1 FROM public.admin_order_message_locale_grants WHERE admin_identity_id=NEW.actor_id AND locale=NEW.review_locale AND revoked_at IS NULL AND granted_at<=NEW.created_at)
   OR (intent.fan_message_locale<>NEW.review_locale AND NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.message.triage',NEW.created_at)) THEN
   RAISE EXCEPTION 'order message requires explicit language and triage authority' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='admin_order_private_accesses' THEN
  IF NEW.expires_at>(SELECT expires_at FROM public.admin_sessions WHERE id=NEW.session_id) THEN
   RAISE EXCEPTION 'private read may not outlive its session' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_order_notes_authority AFTER INSERT ON public.admin_order_notes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_order_receipt_authority();
CREATE CONSTRAINT TRIGGER admin_order_access_authority AFTER INSERT ON public.admin_order_private_accesses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_order_receipt_authority();
CREATE CONSTRAINT TRIGGER admin_order_review_authority AFTER INSERT ON public.admin_order_message_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_order_receipt_authority();
CREATE CONSTRAINT TRIGGER admin_order_fulfillment_authority AFTER INSERT ON public.admin_order_fulfillment_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_order_receipt_authority();
CREATE FUNCTION public.assert_admin_order_note() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.id=NEW.audit_log_id AND a.actor_type='ADMIN' AND a.actor_id=NEW.actor_id
  AND a.action='ORDER_NOTE_ADDED' AND a.subject_type='ORDER' AND a.subject_id=NEW.order_id AND a.field_category='ORDER_PRIVATE'
  AND a.outcome='SUCCEEDED' AND a.reason_code IS NOT NULL AND a.request_id IS NOT NULL AND a.correlation_id IS NOT NULL AND a.created_at=NEW.created_at)
 OR NOT EXISTS(SELECT 1 FROM public.admin_order_operation_receipts r WHERE r.action='ADD_NOTE' AND r.result_id=NEW.id AND r.audit_log_id=NEW.audit_log_id) THEN
  RAISE EXCEPTION 'private note requires exact audit and operation receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_order_note_complete AFTER INSERT ON public.admin_order_notes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_order_note();
CREATE FUNCTION public.require_admin_order_human_review() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.status='CONVERTED' AND NEW.moderation_decision_kind='HUMAN'
 AND ROW(NEW.moderation_status,NEW.moderation_reason_code,NEW.moderation_decision_kind,NEW.moderation_reviewer_id,NEW.reviewed_at)
 IS DISTINCT FROM ROW(OLD.moderation_status,OLD.moderation_reason_code,OLD.moderation_decision_kind,OLD.moderation_reviewer_id,OLD.reviewed_at)
 AND NOT EXISTS(SELECT 1 FROM public.admin_order_message_reviews r WHERE r.support_intent_id=NEW.id AND r.expected_intent_version=OLD.version AND r.result_intent_version=NEW.version AND r.actor_id=NEW.moderation_reviewer_id AND r.decision=NEW.moderation_status AND r.created_at=NEW.reviewed_at) THEN
  RAISE EXCEPTION 'converted human moderation requires an exact audited review receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_order_human_review_required AFTER UPDATE ON public.support_intents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_admin_order_human_review();
CREATE FUNCTION public.require_admin_order_fulfillment_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.authority_kind='ADMIN' AND NOT EXISTS(SELECT 1 FROM public.admin_order_fulfillment_receipts r WHERE r.fulfillment_event_id=NEW.id AND r.fulfillment_id=NEW.fulfillment_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.admin_identity_id AND r.audit_log_id=NEW.audit_log_id) THEN
  RAISE EXCEPTION 'admin fulfillment requires an exact operation receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_order_admin_event_required AFTER INSERT ON public.fulfillment_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_admin_order_fulfillment_receipt();
