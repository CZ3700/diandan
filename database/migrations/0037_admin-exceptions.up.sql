SET search_path=public;
INSERT INTO public.permissions(id,permission_key,description) VALUES
(gen_random_uuid(),'exceptions.read','Read redacted operational exceptions'),
(gen_random_uuid(),'exceptions.replay','Replay trusted webhook and reliable dead-letter sources') ON CONFLICT(permission_key) DO NOTHING;
INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.role_key='manager' AND p.permission_key IN('exceptions.read','exceptions.replay') ON CONFLICT DO NOTHING;
CREATE TABLE public.admin_exception_operations (
 id uuid PRIMARY KEY,schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 action text NOT NULL CHECK(action IN('REPLAY_WEBHOOK','RETRY_DEAD_LETTER')),
 webhook_inbox_id uuid REFERENCES public.webhook_inbox(id),outbox_event_id uuid REFERENCES public.outbox_events(id),consumer_key text,
 status text NOT NULL CHECK(status IN('REQUESTED','PROCESSING','SUCCEEDED','FAILED')),
 generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),version public.positive_version NOT NULL DEFAULT 1,
 lease_token_digest bytea,lease_expires_at public.finite_timestamptz,reason_code text,
 request_id uuid NOT NULL,correlation_id uuid NOT NULL,
 created_at public.finite_timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at public.finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((action='REPLAY_WEBHOOK' AND webhook_inbox_id IS NOT NULL AND outbox_event_id IS NULL AND consumer_key IS NULL) OR (action='RETRY_DEAD_LETTER' AND outbox_event_id IS NOT NULL AND webhook_inbox_id IS NULL AND consumer_key IS NOT NULL AND consumer_key='order-notifications-v1')),
 CHECK((status='PROCESSING' AND lease_token_digest IS NOT NULL AND octet_length(lease_token_digest)=32 AND lease_expires_at IS NOT NULL AND generation>0) OR (status<>'PROCESSING' AND lease_token_digest IS NULL AND lease_expires_at IS NULL)),
 CHECK((status IN('REQUESTED','PROCESSING') AND reason_code IS NULL) OR(status='SUCCEEDED' AND reason_code IS NOT NULL AND reason_code='PROCESSED') OR(status='FAILED' AND reason_code IS NOT NULL AND reason_code='PROCESSING_FAILED')),CHECK(updated_at>=created_at)
);
CREATE UNIQUE INDEX admin_exception_webhook_pending ON public.admin_exception_operations(webhook_inbox_id) WHERE status IN('REQUESTED','PROCESSING');
CREATE UNIQUE INDEX admin_exception_outbox_pending ON public.admin_exception_operations(outbox_event_id,consumer_key) WHERE status IN('REQUESTED','PROCESSING');
CREATE INDEX admin_exception_webhook_history ON public.admin_exception_operations(webhook_inbox_id,created_at,id) WHERE webhook_inbox_id IS NOT NULL;
CREATE INDEX admin_exception_outbox_history ON public.admin_exception_operations(outbox_event_id,consumer_key,created_at,id) WHERE outbox_event_id IS NOT NULL;
CREATE INDEX admin_exception_operations_due ON public.admin_exception_operations(created_at,id) WHERE status IN('REQUESTED','PROCESSING');
CREATE TABLE public.admin_exception_receipts (
 id uuid PRIMARY KEY,schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),actor_id uuid NOT NULL REFERENCES public.admin_identities(id),session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 action text NOT NULL CHECK(action IN('REPLAY_WEBHOOK','RETRY_DEAD_LETTER','RECONCILE_PAYMENT','RETRY_NOTIFICATION')),
 target_kind text NOT NULL CHECK(target_kind IN('WEBHOOK','DEAD_LETTER','PAYMENT','NOTIFICATION')),target_id uuid NOT NULL,consumer_key text,
 operation_id uuid REFERENCES public.admin_exception_operations(id) DEFERRABLE INITIALLY DEFERRED,
 finance_operation_id uuid REFERENCES public.admin_finance_operations(id),notification_resend_id uuid REFERENCES public.admin_notification_resends(id),
 idempotency_key public.idempotency_key_value NOT NULL,request_hash public.sha256_hex NOT NULL,expected_version public.sha256_hex NOT NULL,
 confirmed boolean NOT NULL CHECK(confirmed),reason_code text NOT NULL CHECK(reason_code IN('RETRY_AFTER_REPAIR','VERIFY_PROVIDER_STATUS','RETRY_FAILED_NOTIFICATION','OPERATOR_REVIEW')),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),request_id uuid NOT NULL,correlation_id uuid NOT NULL,created_at public.finite_timestamptz NOT NULL,
 UNIQUE(actor_id,action,idempotency_key),
 CHECK((action='REPLAY_WEBHOOK' AND target_kind='WEBHOOK' AND consumer_key IS NULL AND operation_id IS NOT NULL AND finance_operation_id IS NULL AND notification_resend_id IS NULL)
 OR(action='RETRY_DEAD_LETTER' AND target_kind='DEAD_LETTER' AND consumer_key IS NOT NULL AND consumer_key='order-notifications-v1' AND operation_id IS NOT NULL AND finance_operation_id IS NULL AND notification_resend_id IS NULL)
 OR(action='RECONCILE_PAYMENT' AND target_kind='PAYMENT' AND consumer_key IS NULL AND operation_id IS NULL AND finance_operation_id IS NOT NULL AND notification_resend_id IS NULL)
 OR(action='RETRY_NOTIFICATION' AND target_kind='NOTIFICATION' AND consumer_key IS NULL AND operation_id IS NULL AND finance_operation_id IS NULL AND notification_resend_id IS NOT NULL))
);
CREATE INDEX admin_exception_receipts_target ON public.admin_exception_receipts(target_kind,target_id,consumer_key,created_at DESC);
-- A version is a digest of canonical, non-sensitive state and retained recovery generations.
CREATE FUNCTION public.admin_exception_source_version(kind text,target uuid,consumer text,excluded_operation uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source jsonb; recoveries jsonb; notification_base uuid;
BEGIN
 CASE kind
 WHEN 'WEBHOOK' THEN
  SELECT jsonb_build_array(i.id,e.id,e.event_type,e.normalized_status,
   (SELECT jsonb_agg(jsonb_build_array(a.attempt_number,a.outcome) ORDER BY a.attempt_number) FROM webhook_processing_attempts a WHERE a.webhook_inbox_id=i.id),
   (SELECT jsonb_agg(jsonb_build_array(a.association_status,a.payment_attempt_id) ORDER BY a.created_at,a.id) FROM provider_event_associations a WHERE a.provider_event_id=e.id),
   (SELECT jsonb_agg(jsonb_build_array(r.decision,r.reason_code)) FROM admin_finance_application_receipts r WHERE r.provider_event_id=e.id),
   (SELECT jsonb_agg(jsonb_build_array(r.decision,r.outcome,r.reason_code)) FROM order_payment_application_receipts r WHERE r.provider_event_id=e.id)) INTO source FROM webhook_inbox i JOIN provider_events e ON e.webhook_inbox_id=i.id WHERE i.id=target;
 WHEN 'DEAD_LETTER' THEN
  SELECT jsonb_build_array(e.id,e.event_type,e.aggregate_version,consumer,
   (SELECT jsonb_agg(jsonb_build_array(a.attempt_number,a.outcome) ORDER BY a.attempt_number) FROM outbox_dispatch_attempts a WHERE a.outbox_event_id=e.id AND a.consumer_key=consumer)) INTO source FROM outbox_events e WHERE e.id=target AND EXISTS(SELECT 1 FROM outbox_dispatch_attempts a WHERE a.outbox_event_id=e.id AND a.consumer_key=consumer AND a.outcome='DEAD_LETTER');
 WHEN 'PAYMENT' THEN SELECT jsonb_build_array(a.id,a.version,a.status,o.id,o.version,o.current_payment_attempt_id) INTO source FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE a.id=target;
 WHEN 'NOTIFICATION' THEN
  SELECT jsonb_build_array(d.id,d.version,d.status,o.id,o.version),d.id INTO source,notification_base FROM notification_deliveries d JOIN orders o ON o.id=d.order_id WHERE d.id=target;
  IF source IS NULL THEN SELECT jsonb_build_array(d.id,d.version,d.status,o.id,o.version),d.base_notification_id INTO source,notification_base FROM admin_notification_resends d JOIN orders o ON o.id=d.order_id WHERE d.id=target;END IF;
  IF source IS NOT NULL THEN
   SELECT jsonb_build_array(source,coalesce(jsonb_agg(jsonb_build_array(r.id,r.version,r.status,r.generation) ORDER BY r.resend_sequence),'[]'::jsonb)) INTO source FROM admin_notification_resends r WHERE r.base_notification_id=notification_base AND r.id IS DISTINCT FROM excluded_operation;
  END IF;
 ELSE RETURN NULL;
 END CASE;
 IF source IS NULL THEN RETURN NULL;END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_array(x.id,x.version,x.status,x.generation) ORDER BY x.created_at,x.id),'[]'::jsonb) INTO recoveries FROM admin_exception_operations x
 WHERE x.id IS DISTINCT FROM excluded_operation AND ((kind='WEBHOOK' AND x.webhook_inbox_id=target) OR(kind='DEAD_LETTER' AND x.outbox_event_id=target AND x.consumer_key=consumer));
 RETURN encode(sha256(convert_to(jsonb_build_array(source,recoveries)::text,'UTF8')),'hex');
END;$$;
CREATE FUNCTION public.guard_admin_exception_operation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'REQUESTED' OR NEW.generation<>0 OR NEW.version<>1 THEN RAISE EXCEPTION 'recovery must begin with a durable unclaimed request' USING ERRCODE='23514';END IF;
 ELSE
  IF OLD.status IN('SUCCEEDED','FAILED') OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR to_jsonb(NEW)-ARRAY['status','generation','version','lease_token_digest','lease_expires_at','reason_code','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','generation','version','lease_token_digest','lease_expires_at','reason_code','updated_at'] THEN RAISE EXCEPTION 'recovery identity and terminal history are immutable' USING ERRCODE='55000';END IF;
  IF NEW.status='PROCESSING' THEN
   IF NEW.generation<>OLD.generation+1 OR (OLD.status='PROCESSING' AND OLD.lease_expires_at>clock_timestamp()) OR NEW.lease_expires_at<=clock_timestamp() OR NEW.lease_expires_at>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'recovery lease must be fresh and fenced' USING ERRCODE='23514';END IF;
  ELSIF OLD.status<>'PROCESSING' OR NEW.status NOT IN('SUCCEEDED','FAILED') OR NEW.generation<>OLD.generation OR OLD.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'completion requires an active recovery lease' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.status='SUCCEEDED' AND NOT (
  (NEW.action='REPLAY_WEBHOOK' AND EXISTS(SELECT 1 FROM webhook_processing_attempts a WHERE a.webhook_inbox_id=NEW.webhook_inbox_id AND a.outcome='SUCCEEDED'))
  OR (NEW.action='RETRY_DEAD_LETTER' AND EXISTS(SELECT 1 FROM outbox_dispatch_attempts a WHERE a.outbox_event_id=NEW.outbox_event_id AND a.consumer_key=NEW.consumer_key AND a.outcome='SUCCEEDED'))
 ) THEN RAISE EXCEPTION 'recovery success requires original processing evidence' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER admin_exception_operation_guard BEFORE INSERT OR UPDATE ON public.admin_exception_operations FOR EACH ROW EXECUTE FUNCTION public.guard_admin_exception_operation();
CREATE FUNCTION public.assert_admin_exception_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE audit public.audit_logs%ROWTYPE; required_permission text;
BEGIN
 required_permission:=CASE NEW.action WHEN 'RECONCILE_PAYMENT' THEN 'finance.manage' WHEN 'RETRY_NOTIFICATION' THEN 'orders.notification.resend' ELSE 'exceptions.replay' END;
 SELECT * INTO audit FROM audit_logs WHERE id=NEW.audit_log_id;
 IF NOT admin_order_authorized(NEW.session_id,NEW.actor_id,'exceptions.read',NEW.created_at) OR NOT admin_order_authorized(NEW.session_id,NEW.actor_id,required_permission,NEW.created_at)
 OR (NEW.action IN('RECONCILE_PAYMENT','RETRY_NOTIFICATION') AND NOT admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.read',NEW.created_at))
 OR audit.actor_type IS DISTINCT FROM 'ADMIN' OR audit.actor_id IS DISTINCT FROM NEW.actor_id OR audit.action IS DISTINCT FROM 'EXCEPTION_'||NEW.action OR audit.subject_type IS DISTINCT FROM 'EXCEPTION_SOURCE' OR audit.subject_id IS DISTINCT FROM NEW.target_id OR audit.reason_code IS DISTINCT FROM NEW.reason_code OR audit.request_id IS DISTINCT FROM NEW.request_id OR audit.correlation_id IS DISTINCT FROM NEW.correlation_id OR audit.outcome IS DISTINCT FROM 'SUCCEEDED' OR audit.created_at IS DISTINCT FROM NEW.created_at
 THEN RAISE EXCEPTION 'exception request requires exact current permission and audit' USING ERRCODE='23514';END IF;
 IF admin_exception_source_version(NEW.target_kind,NEW.target_id,NEW.consumer_key,coalesce(NEW.operation_id,NEW.notification_resend_id)) IS DISTINCT FROM NEW.expected_version THEN RAISE EXCEPTION 'exception source version changed' USING ERRCODE='23514';END IF;
 IF NEW.operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM admin_exception_operations x WHERE x.id=NEW.operation_id AND x.action=NEW.action AND coalesce(x.webhook_inbox_id,x.outbox_event_id)=NEW.target_id AND x.consumer_key IS NOT DISTINCT FROM NEW.consumer_key AND x.request_id=NEW.request_id AND x.correlation_id=NEW.correlation_id) THEN RAISE EXCEPTION 'recovery receipt must bind its exact source' USING ERRCODE='23514';END IF;
 IF NEW.finance_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM admin_finance_receipts r JOIN admin_finance_operations x ON x.id=r.operation_id WHERE x.id=NEW.finance_operation_id AND x.attempt_id=NEW.target_id AND EXISTS(SELECT 1 FROM payment_attempts p WHERE p.id=NEW.target_id AND p.status='UNKNOWN') AND r.action='RECONCILE' AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.idempotency_key='exception:'||NEW.id AND r.reason_code=NEW.reason_code AND r.request_id=NEW.request_id AND r.correlation_id=NEW.correlation_id) THEN RAISE EXCEPTION 'payment recovery must delegate to audited finance' USING ERRCODE='23514';END IF;
 IF NEW.notification_resend_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM admin_notification_resends r WHERE r.id=NEW.notification_resend_id AND r.id<>NEW.target_id
  AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.command_idempotency_key='exception:'||NEW.id
  AND r.reason_code=NEW.reason_code AND r.request_id=NEW.request_id AND r.correlation_id=NEW.correlation_id
  AND (
   (r.base_notification_id=NEW.target_id
    AND EXISTS(SELECT 1 FROM notification_deliveries source WHERE source.id=NEW.target_id AND source.status IN('FAILED','CANCELED'))
    AND NOT EXISTS(SELECT 1 FROM admin_notification_resends prior WHERE prior.base_notification_id=r.base_notification_id AND prior.resend_sequence<r.resend_sequence))
   OR EXISTS(SELECT 1 FROM admin_notification_resends prior WHERE prior.id=NEW.target_id AND prior.base_notification_id=r.base_notification_id
    AND prior.status IN('FAILED','CANCELED') AND prior.resend_sequence=(SELECT max(previous.resend_sequence) FROM admin_notification_resends previous WHERE previous.base_notification_id=r.base_notification_id AND previous.resend_sequence<r.resend_sequence))
  )
  AND NOT EXISTS(SELECT 1 FROM notification_delivery_attempts a JOIN notification_deliveries d ON d.id=a.notification_delivery_id WHERE d.order_id=r.order_id AND d.status<>'SENT' AND a.outcome='UNKNOWN')
  AND NOT EXISTS(SELECT 1 FROM admin_notification_resend_attempts a JOIN admin_notification_resends d ON d.id=a.resend_id WHERE d.order_id=r.order_id AND d.status<>'SENT' AND a.outcome='UNKNOWN')
 ) THEN RAISE EXCEPTION 'notification recovery requires exact failed source and audited resend' USING ERRCODE='23514';END IF;
 RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER admin_exception_receipt_authority AFTER INSERT ON public.admin_exception_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_exception_receipt();
CREATE FUNCTION public.assert_admin_exception_operation_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_exception_receipts r WHERE r.operation_id=NEW.id) THEN RAISE EXCEPTION 'recovery requires a permanent authorized receipt' USING ERRCODE='23514';END IF;RETURN NULL;END;$$;
CREATE CONSTRAINT TRIGGER admin_exception_operation_receipt AFTER INSERT ON public.admin_exception_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_exception_operation_receipt();
CREATE TRIGGER admin_exception_receipts_immutable BEFORE UPDATE OR DELETE ON public.admin_exception_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER admin_exception_receipts_no_truncate BEFORE TRUNCATE ON public.admin_exception_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER admin_exception_operations_no_delete BEFORE DELETE ON public.admin_exception_operations FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER admin_exception_operations_no_truncate BEFORE TRUNCATE ON public.admin_exception_operations FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
