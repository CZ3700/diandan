SET search_path=public;

-- An operator resend is a new dispatch. The original per-order/event delivery,
-- immutable template, source authority and receiver idempotency identity remain intact.
CREATE FUNCTION public.admin_notification_current_event(target uuid) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE fulfillment_status WHEN 'PENDING' THEN 'PAYMENT_CONFIRMED' WHEN 'PREPARING' THEN 'PREPARING' WHEN 'DELIVERED' THEN 'DELIVERED' END
 FROM public.orders WHERE id=target AND payment_status='PAID' AND dispute_status='NONE' AND order_status IN('OPEN','CLOSED')
$$;
CREATE TABLE public.admin_notification_resends (
 id uuid PRIMARY KEY, schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 order_id uuid NOT NULL REFERENCES public.orders(id),
 customer_contact_id uuid NOT NULL REFERENCES public.customer_contacts(id),
 base_notification_id uuid NOT NULL REFERENCES public.notification_deliveries(id),
 source_outbox_event_id uuid NOT NULL REFERENCES public.outbox_events(id),
 order_version public.positive_version NOT NULL,
 resend_sequence public.positive_version NOT NULL,
 event_type text NOT NULL CHECK(event_type IN('PAYMENT_CONFIRMED','PREPARING','DELIVERED')),
 event_rank integer NOT NULL CHECK(event_rank BETWEEN 1 AND 3),
 requested_locale public.supported_locale NOT NULL, resolved_locale public.supported_locale NOT NULL,
 fallback_used boolean NOT NULL, fallback_reason_code text,
 template_key text NOT NULL, template_version text NOT NULL,
 base_variables jsonb NOT NULL CHECK(jsonb_typeof(base_variables)='object'),
 public_storefront_origin text NOT NULL CHECK(public_storefront_origin ~ '^https://[^/?#@]+$'),
 transport_key text NOT NULL CHECK(transport_key ~ '^[a-f0-9]{64}$'),
 contact_lookup_hmac bytea NOT NULL CHECK(octet_length(contact_lookup_hmac)=32),
 contact_lookup_key_version text NOT NULL,
 link_nonce bytea NOT NULL CHECK(octet_length(link_nonce)=32), link_pepper_version text NOT NULL,
 link_ttl_seconds integer NOT NULL CHECK(link_ttl_seconds BETWEEN 1 AND 604800),
 dedupe_until public.finite_timestamptz NOT NULL,
 link_token_id uuid UNIQUE REFERENCES public.order_access_tokens(id), content_hash text CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id), session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 command_idempotency_key public.idempotency_key_value NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{1,127}$'),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),
 idempotency_key public.idempotency_key_value NOT NULL UNIQUE, request_id uuid NOT NULL, correlation_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN('REQUESTED','PROCESSING','RETRY_SCHEDULED','SENT','FAILED','CANCELED')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 6),
 next_attempt_at public.finite_timestamptz, sent_at public.finite_timestamptz,
 last_error_code text CHECK(last_error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
 lease_token uuid, lease_expires_at public.finite_timestamptz, lease_started_at public.finite_timestamptz,
 generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0), version public.positive_version NOT NULL DEFAULT 1,
 created_at public.finite_timestamptz NOT NULL, updated_at public.finite_timestamptz NOT NULL,
 UNIQUE(actor_id,command_idempotency_key), UNIQUE(order_id,resend_sequence),
 CHECK(dedupe_until>created_at AND dedupe_until<=created_at+interval '7 days'),
 CHECK(updated_at>=created_at),
 CHECK((status='PROCESSING' AND lease_token IS NOT NULL AND lease_expires_at>lease_started_at AND lease_started_at>=created_at AND generation>0)
  OR(status<>'PROCESSING' AND lease_token IS NULL AND lease_expires_at IS NULL AND lease_started_at IS NULL)),
 CHECK((status IN('REQUESTED','PROCESSING') AND next_attempt_at IS NULL AND sent_at IS NULL AND last_error_code IS NULL)
  OR(status='RETRY_SCHEDULED' AND next_attempt_at IS NOT NULL AND sent_at IS NULL AND last_error_code IS NOT NULL)
  OR(status='SENT' AND next_attempt_at IS NULL AND sent_at IS NOT NULL AND last_error_code IS NULL)
  OR(status IN('FAILED','CANCELED') AND next_attempt_at IS NULL AND sent_at IS NULL AND last_error_code IS NOT NULL))
);
CREATE UNIQUE INDEX admin_notification_one_pending_per_order ON public.admin_notification_resends(order_id) WHERE status IN('REQUESTED','PROCESSING','RETRY_SCHEDULED');
CREATE INDEX admin_notification_resend_due ON public.admin_notification_resends(next_attempt_at,created_at,id) WHERE status IN('REQUESTED','PROCESSING','RETRY_SCHEDULED');

-- ID-only transactional outbox, consumed by the existing Worker maintenance loop.
-- Pending/lease state is canonical on the referenced dispatch, never duplicated.
CREATE TABLE public.admin_notification_resend_outbox (
 resend_id uuid PRIMARY KEY REFERENCES public.admin_notification_resends(id),
 schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1), created_at public.finite_timestamptz NOT NULL
);
CREATE TABLE public.admin_notification_resend_attempts (
 id uuid PRIMARY KEY, resend_id uuid NOT NULL REFERENCES public.admin_notification_resends(id),
 sequence public.positive_version NOT NULL, outcome text NOT NULL CHECK(outcome IN('SUCCEEDED','FAILED','UNKNOWN')),
 provider_delivery_reference public.opaque_provider_reference, error_code text,
 started_at public.finite_timestamptz NOT NULL, completed_at public.finite_timestamptz NOT NULL,
 UNIQUE(resend_id,sequence), CHECK(completed_at>=started_at),
 CHECK((outcome='SUCCEEDED' AND provider_delivery_reference IS NOT NULL AND error_code IS NULL)
  OR(outcome IN('FAILED','UNKNOWN') AND provider_delivery_reference IS NULL AND error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'))
);
CREATE TABLE public.admin_notification_resend_contact_access (
 audit_log_id uuid PRIMARY KEY REFERENCES public.audit_logs(id), resend_id uuid NOT NULL REFERENCES public.admin_notification_resends(id),
 customer_contact_id uuid NOT NULL REFERENCES public.customer_contacts(id), lease_token uuid NOT NULL,
 generation public.positive_version NOT NULL, created_at public.finite_timestamptz NOT NULL
);
CREATE FUNCTION public.guard_admin_notification_resend() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'REQUESTED' OR NEW.version<>1 OR NEW.attempt_count<>0 OR NEW.generation<>0 OR NEW.link_token_id IS NOT NULL OR NEW.content_hash IS NOT NULL THEN
   RAISE EXCEPTION 'resend must start as a fresh dispatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.notification_deliveries d JOIN public.notification_runtime_state r ON r.notification_delivery_id=d.id
    JOIN public.orders o ON o.id=d.order_id JOIN public.admin_sessions s ON s.id=NEW.session_id
    JOIN public.admin_identities actor ON actor.id=s.admin_identity_id
    JOIN public.audit_logs a ON a.id=NEW.audit_log_id
    WHERE d.id=NEW.base_notification_id AND d.order_id=NEW.order_id AND d.customer_contact_id=NEW.customer_contact_id
    AND d.status IN('SENT','FAILED','CANCELED') AND NEW.event_type=public.admin_notification_current_event(o.id)
    AND o.version=NEW.order_version AND NEW.event_type=d.event_type AND NEW.event_rank=r.event_rank
    AND NEW.source_outbox_event_id=r.source_outbox_event_id AND NEW.base_variables=r.base_variables
    AND (NEW.requested_locale,NEW.resolved_locale,NEW.fallback_used,NEW.template_key,NEW.template_version)
      =(d.requested_locale,d.resolved_locale,d.fallback_used,d.template_key,d.template_version)
    AND NEW.public_storefront_origin=r.public_storefront_origin AND NEW.transport_key=r.transport_key
    AND NEW.contact_lookup_hmac=r.contact_lookup_hmac AND NEW.contact_lookup_key_version=r.contact_lookup_key_version
    AND NEW.link_pepper_version=r.link_pepper_version AND NEW.link_ttl_seconds=r.link_ttl_seconds
    AND NEW.fallback_reason_code IS NOT DISTINCT FROM r.fallback_reason_code
    AND NEW.dedupe_until-NEW.created_at=r.dedupe_until-r.created_at
    AND NEW.link_nonce<>r.link_nonce AND NEW.idempotency_key<>d.idempotency_key
    AND s.admin_identity_id=NEW.actor_id AND actor.status='ACTIVE' AND s.revoked_at IS NULL
    AND s.authenticated_with_mfa AND s.expires_at>clock_timestamp() AND s.created_at<=clock_timestamp()
    AND a.actor_type='ADMIN' AND a.actor_id=NEW.actor_id AND a.action='RESEND_ORDER_NOTIFICATION' AND a.subject_type='ORDER'
    AND a.subject_id=NEW.order_id AND a.reason_code=NEW.reason_code AND a.outcome='SUCCEEDED'
    AND a.request_id=NEW.request_id AND a.correlation_id=NEW.correlation_id AND a.created_at=NEW.created_at
    AND (SELECT count(DISTINCT p.permission_key) FROM public.admin_identity_roles ar JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id WHERE ar.admin_identity_id=NEW.actor_id AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp() AND p.permission_key IN('orders.read','orders.notification.resend'))=2
    AND EXISTS(SELECT 1 FROM public.notification_source_authority(r.source_outbox_event_id) authority WHERE authority.order_id=o.id AND authority.event_type=NEW.event_type)
  ) THEN RAISE EXCEPTION 'resend requires current order, canonical snapshot and authorized audit' USING ERRCODE='23514'; END IF;
  IF NEW.resend_sequence<>(SELECT coalesce(max(resend_sequence),0)+1 FROM public.admin_notification_resends WHERE order_id=NEW.order_id)
    OR EXISTS(SELECT 1 FROM public.notification_deliveries WHERE order_id=NEW.order_id AND status IN('REQUESTED','PROCESSING','RETRY_SCHEDULED'))
    OR EXISTS(SELECT 1 FROM public.admin_notification_resends WHERE order_id=NEW.order_id AND created_at>NEW.created_at-interval '60 seconds')
    OR EXISTS(SELECT 1 FROM public.notification_delivery_attempts a JOIN public.notification_deliveries d ON d.id=a.notification_delivery_id WHERE d.order_id=NEW.order_id AND d.status<>'SENT' AND a.outcome='UNKNOWN')
    OR EXISTS(SELECT 1 FROM public.admin_notification_resend_attempts a JOIN public.admin_notification_resends d ON d.id=a.resend_id WHERE d.order_id=NEW.order_id AND d.status<>'SENT' AND a.outcome='UNKNOWN')
  THEN RAISE EXCEPTION 'resend cannot bypass pending, unknown or throttled dispatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR OLD.status IN('SENT','FAILED','CANCELED')
 OR (to_jsonb(NEW)-ARRAY['status','attempt_count','next_attempt_at','sent_at','last_error_code','lease_token','lease_expires_at','lease_started_at','generation','version','updated_at','link_token_id','content_hash'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempt_count','next_attempt_at','sent_at','last_error_code','lease_token','lease_expires_at','lease_started_at','generation','version','updated_at','link_token_id','content_hash'])
 OR (OLD.link_token_id IS NOT NULL AND NEW.link_token_id IS DISTINCT FROM OLD.link_token_id)
 OR (OLD.content_hash IS NOT NULL AND NEW.content_hash IS DISTINCT FROM OLD.content_hash)
 THEN RAISE EXCEPTION 'resend snapshot and terminal history are immutable' USING ERRCODE='55000'; END IF;
 IF OLD.status IN('REQUESTED','RETRY_SCHEDULED') AND NEW.status='PROCESSING' THEN
  IF NEW.generation<>OLD.generation+1 OR NEW.attempt_count<>OLD.attempt_count THEN RAISE EXCEPTION 'resend lease must fence claims' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='PROCESSING' AND NEW.status IN('SENT','FAILED','RETRY_SCHEDULED') THEN
  IF NEW.attempt_count<>OLD.attempt_count+1 OR NEW.generation<>OLD.generation THEN RAISE EXCEPTION 'resend completion requires one attempt' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='PROCESSING' AND NEW.status='PROCESSING' THEN
  IF (NEW.lease_token,NEW.generation,NEW.attempt_count,NEW.lease_started_at,NEW.lease_expires_at) IS DISTINCT FROM (OLD.lease_token,OLD.generation,OLD.attempt_count,OLD.lease_started_at,OLD.lease_expires_at) THEN RAISE EXCEPTION 'resend metadata cannot replace lease' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status IN('REQUESTED','RETRY_SCHEDULED') AND NEW.status='CANCELED' THEN
  IF NEW.attempt_count<>OLD.attempt_count OR NEW.generation<>OLD.generation THEN RAISE EXCEPTION 'resend cancellation cannot rewrite attempts' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'invalid resend transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_notification_resend_guard BEFORE INSERT OR UPDATE ON public.admin_notification_resends FOR EACH ROW EXECUTE FUNCTION public.guard_admin_notification_resend();
CREATE FUNCTION public.assert_admin_notification_resend() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target uuid; dispatch public.admin_notification_resends%ROWTYPE; attempts bigint; last_outcome text;
BEGIN
 target:=coalesce((to_jsonb(NEW)->>'resend_id')::uuid,(to_jsonb(NEW)->>'id')::uuid);
 SELECT * INTO dispatch FROM public.admin_notification_resends WHERE id=target;
 SELECT count(*) INTO attempts FROM public.admin_notification_resend_attempts WHERE resend_id=target;
 SELECT outcome INTO last_outcome FROM public.admin_notification_resend_attempts WHERE resend_id=target ORDER BY sequence DESC LIMIT 1;
 IF dispatch.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.admin_notification_resend_outbox q WHERE q.resend_id=target AND q.created_at=dispatch.created_at)
 OR attempts<>dispatch.attempt_count
 OR (attempts>0 AND (SELECT max(sequence) FROM public.admin_notification_resend_attempts WHERE resend_id=target)<>attempts)
 OR (dispatch.status='SENT' AND last_outcome IS DISTINCT FROM 'SUCCEEDED')
 OR (dispatch.status IN('FAILED','RETRY_SCHEDULED') AND last_outcome IS DISTINCT FROM 'FAILED' AND last_outcome IS DISTINCT FROM 'UNKNOWN')
 OR (dispatch.link_token_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.order_access_tokens t WHERE t.id=dispatch.link_token_id AND t.order_id=dispatch.order_id AND t.purpose='LINK' AND t.token_pepper_version=dispatch.link_pepper_version))
 THEN RAISE EXCEPTION 'resend queue, link and attempts must agree' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER admin_notification_resend_consistency AFTER INSERT OR UPDATE ON public.admin_notification_resends DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_notification_resend();
CREATE CONSTRAINT TRIGGER admin_notification_resend_attempt_consistency AFTER INSERT ON public.admin_notification_resend_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_notification_resend();
CREATE CONSTRAINT TRIGGER admin_notification_resend_outbox_consistency AFTER INSERT ON public.admin_notification_resend_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_notification_resend();
CREATE FUNCTION public.guard_admin_notification_contact_access() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.admin_notification_resends r JOIN public.customer_contacts c ON c.id=r.customer_contact_id JOIN public.audit_logs a ON a.id=NEW.audit_log_id
  WHERE r.id=NEW.resend_id AND r.status='PROCESSING' AND r.lease_token=NEW.lease_token AND r.generation=NEW.generation AND r.lease_expires_at>clock_timestamp()
  AND c.id=NEW.customer_contact_id AND c.retention_status='ACTIVE' AND c.email_lookup_hmac=r.contact_lookup_hmac AND c.lookup_key_version=r.contact_lookup_key_version
  AND a.actor_type='WORKER' AND a.task_name='admin-order-resend' AND a.action='AUTHORIZE_NOTIFICATION_CONTACT_READ' AND a.subject_type='CUSTOMER_CONTACT'
  AND a.subject_id=c.id AND a.field_category='CUSTOMER_CONTACT_EMAIL' AND a.outcome='SUCCEEDED' AND a.request_id=r.request_id AND a.correlation_id=r.correlation_id AND a.created_at=NEW.created_at)
 THEN RAISE EXCEPTION 'resend contact read requires scoped lease and audit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_notification_resend_contact_guard BEFORE INSERT ON public.admin_notification_resend_contact_access FOR EACH ROW EXECUTE FUNCTION public.guard_admin_notification_contact_access();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['admin_notification_resend_outbox','admin_notification_resend_attempts','admin_notification_resend_contact_access'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_append_only()',name||'_immutable',name);
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only()',name||'_no_truncate',name);
 END LOOP;
END $$;
CREATE TRIGGER admin_notification_resend_no_delete BEFORE DELETE ON public.admin_notification_resends FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER admin_notification_resend_no_truncate BEFORE TRUNCATE ON public.admin_notification_resends FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
