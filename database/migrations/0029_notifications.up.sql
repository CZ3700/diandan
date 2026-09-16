SET search_path = public;

-- Public links remain unique; internal bootstrap capabilities must be consumed in
-- the granting transaction and are never eligible for the public exchange API.
ALTER TABLE public.order_access_tokens ADD COLUMN purpose text NOT NULL DEFAULT 'LINK'
  CHECK (purpose IN ('LINK','CHECKOUT_BOOTSTRAP'));
DROP INDEX public.order_access_tokens_one_active_per_order_idx;
CREATE UNIQUE INDEX order_access_tokens_one_active_per_order_idx
  ON public.order_access_tokens(order_id) WHERE status = 'ACTIVE' AND purpose = 'LINK';
CREATE FUNCTION public.assert_order_access_bootstrap_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE token public.order_access_tokens%ROWTYPE;
BEGIN
  SELECT * INTO token FROM public.order_access_tokens WHERE id=NEW.id;
  IF token.purpose='CHECKOUT_BOOTSTRAP' AND (token.status<>'EXCHANGED' OR token.version<>2 OR NOT EXISTS(
    SELECT 1 FROM public.order_access_sessions s JOIN public.order_access_audits a
      ON a.session_id=s.id AND a.token_id=token.id AND a.order_id=token.order_id AND a.action='BOOTSTRAP'
    WHERE s.exchanged_token_id=token.id AND s.order_id=token.order_id
      AND token.exchanged_at=s.created_at
  )) THEN RAISE EXCEPTION 'internal bootstrap must atomically consume its token and audit its session' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER order_access_bootstrap_complete AFTER INSERT OR UPDATE ON public.order_access_tokens
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_order_access_bootstrap_complete();

-- Authority is the immutable source event, including canonical capture evidence.
CREATE FUNCTION public.notification_source_authority(source_id uuid)
RETURNS TABLE(order_id uuid,event_type text,event_rank integer,source_sequence bigint)
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT o.id,'PAYMENT_CONFIRMED'::text,1,e.sequence
  FROM public.outbox_events x JOIN public.orders o ON o.id=x.aggregate_id
  JOIN public.order_events e ON e.order_id=o.id AND e.sequence=x.aggregate_version
    AND e.request_id=x.request_id AND e.correlation_id=x.correlation_id AND e.occurred_at=x.occurred_at
    AND e.to_payment_status='PAID' AND e.to_payment_attempt_id=x.secondary_subject_id
  JOIN public.order_payment_application_receipts receipt ON receipt.order_id=o.id
    AND receipt.attempt_id=e.to_payment_attempt_id AND receipt.provider_event_id=e.provider_event_id
    AND receipt.provider_event_id=receipt.canonical_provider_event_id
    AND receipt.decision='APPLIED' AND receipt.outcome IN('PAID','PAID_REVIEW')
  JOIN public.provider_events evidence ON evidence.id=receipt.provider_event_id
    AND evidence.canonical_transaction_event_id IS NULL AND evidence.normalized_status='SUCCEEDED'
  JOIN public.payment_transactions ledger ON ledger.provider_event_id=evidence.id
    AND ledger.payment_attempt_id=receipt.attempt_id AND ledger.transaction_type='CAPTURE'
    AND ledger.currency=o.currency AND ledger.amount_minor=o.total_amount_minor
  WHERE x.id=source_id AND x.event_type='ORDER_PAYMENT_CONFIRMED'
    AND x.primary_subject_id=o.id AND x.locale=o.presentation_locale
    AND x.market=o.market AND x.currency=o.currency
  UNION ALL
  SELECT o.id,e.to_status,CASE e.to_status WHEN 'PREPARING' THEN 2 ELSE 3 END,e.sequence
  FROM public.outbox_events x JOIN public.fulfillment_events e ON e.fulfillment_id=x.aggregate_id
    AND e.order_id=x.secondary_subject_id AND e.sequence=x.aggregate_version
    AND e.request_id=x.request_id AND e.correlation_id=x.correlation_id AND e.occurred_at=x.occurred_at
    AND e.to_status=x.payload_status
  JOIN public.orders o ON o.id=e.order_id
  WHERE x.id=source_id AND x.event_type='FULFILLMENT_STATUS_CHANGED' AND e.to_status IN('PREPARING','DELIVERED')
    AND x.primary_subject_id=e.fulfillment_id AND x.locale=o.presentation_locale
    AND x.market=o.market AND x.currency=o.currency
    AND EXISTS(SELECT 1 FROM public.order_payment_application_receipts paid WHERE paid.order_id=o.id AND paid.provider_event_id=paid.canonical_provider_event_id AND paid.decision='APPLIED' AND paid.outcome IN('PAID','PAID_REVIEW'))
    AND EXISTS(SELECT 1 FROM public.order_events oe WHERE oe.order_id=o.id
      AND oe.to_fulfillment_status=e.to_status AND oe.occurred_at<=e.occurred_at)
$$;

CREATE FUNCTION public.notification_order_snapshot(target_order_id uuid,site_name text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('schemaVersion',1,'siteName',site_name,'publicOrderId',o.public_order_id,
    'orderedAt',to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'currency',o.currency,'totalMinor',o.total_amount_minor,'items',(
      SELECT jsonb_agg(jsonb_build_object('idolName',i.idol_display_name,'idolLocale',i.idol_translation_resolved_locale,
        'giftName',i.gift_title,'giftLocale',i.gift_translation_resolved_locale,
        'variantName',CASE WHEN i.schema_version=1 THEN NULL ELSE original.line->>'giftVariantLabel' END,
        'variantLocale',CASE WHEN i.schema_version=1 THEN NULL ELSE i.gift_translation_resolved_locale END,
        'quantity',i.quantity,'lineTotalMinor',i.line_total_minor) ORDER BY i.created_at,i.id)
      FROM public.order_items i LEFT JOIN public.checkout_preflight_observations observation ON observation.id=i.checkout_preflight_id
      LEFT JOIN LATERAL(SELECT line FROM jsonb_array_elements(observation.observation#>'{consent,lines}') line
        WHERE (line->>'cartItemId')::uuid=i.cart_item_id) original ON true WHERE i.order_id=o.id))
  FROM public.orders o WHERE o.id=target_order_id
$$;

-- The JSON value is a narrow immutable rendering snapshot validated against its
-- source rows below. It never carries private contacts or capability-bearing HTML.
CREATE TABLE public.notification_runtime_state (
  notification_delivery_id uuid PRIMARY KEY REFERENCES public.notification_deliveries(id) ON DELETE RESTRICT,
  source_outbox_event_id uuid NOT NULL UNIQUE REFERENCES public.outbox_events(id) ON DELETE RESTRICT,
  event_rank integer NOT NULL CHECK(event_rank BETWEEN 1 AND 3),
  base_variables jsonb NOT NULL CHECK(jsonb_typeof(base_variables)='object'),
  public_storefront_origin text NOT NULL CHECK(public_storefront_origin ~ '^https://[^/?#@]+$'),
  transport_key text NOT NULL CHECK(transport_key ~ '^[a-f0-9]{64}$'),
  contact_lookup_hmac bytea NOT NULL CHECK(octet_length(contact_lookup_hmac)=32),
  contact_lookup_key_version text NOT NULL CHECK(contact_lookup_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  link_nonce bytea NOT NULL CHECK(octet_length(link_nonce)=32),
  link_pepper_version text NOT NULL CHECK(link_pepper_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  link_ttl_seconds integer NOT NULL CHECK(link_ttl_seconds BETWEEN 1 AND 604800),
  dedupe_until public.finite_timestamptz NOT NULL,
  fallback_reason_code text CHECK(fallback_reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  link_token_id uuid UNIQUE REFERENCES public.order_access_tokens(id) ON DELETE RESTRICT,
  content_hash text CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  lease_token uuid,
  lease_expires_at public.finite_timestamptz,
  lease_started_at public.finite_timestamptz,
  generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
  created_at public.finite_timestamptz NOT NULL,
  updated_at public.finite_timestamptz NOT NULL,
  CHECK(dedupe_until>created_at AND dedupe_until<=created_at+interval '7 days'),
  CHECK(updated_at>=created_at),
  CHECK((lease_token IS NULL AND lease_expires_at IS NULL AND lease_started_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at>lease_started_at AND lease_started_at>=created_at AND generation>0))
);
CREATE INDEX notification_runtime_lease_due ON public.notification_runtime_state(lease_expires_at) WHERE lease_token IS NOT NULL;
CREATE FUNCTION public.guard_notification_runtime_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF (to_jsonb(NEW)-'lease_token'-'lease_expires_at'-'lease_started_at'-'generation'-'updated_at'-'link_token_id'-'content_hash')
    IS DISTINCT FROM (to_jsonb(OLD)-'lease_token'-'lease_expires_at'-'lease_started_at'-'generation'-'updated_at'-'link_token_id'-'content_hash')
    OR (OLD.link_token_id IS NOT NULL AND NEW.link_token_id IS DISTINCT FROM OLD.link_token_id)
    OR (OLD.content_hash IS NOT NULL AND NEW.content_hash IS DISTINCT FROM OLD.content_hash)
    OR NEW.generation<OLD.generation OR NEW.generation>OLD.generation+1
    OR NEW.updated_at<OLD.updated_at
    OR (NEW.lease_token IS DISTINCT FROM OLD.lease_token AND NEW.lease_token IS NOT NULL AND NEW.generation<>OLD.generation+1)
  THEN RAISE EXCEPTION 'notification frozen source and dispatch identity are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER notification_runtime_immutable BEFORE UPDATE ON public.notification_runtime_state FOR EACH ROW EXECUTE FUNCTION public.guard_notification_runtime_immutable();
CREATE TRIGGER notification_runtime_no_delete BEFORE DELETE ON public.notification_runtime_state FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER notification_runtime_no_truncate BEFORE TRUNCATE ON public.notification_runtime_state FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE FUNCTION public.assert_notification_runtime_consistency() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target_id uuid; runtime public.notification_runtime_state%ROWTYPE; delivery public.notification_deliveries%ROWTYPE;
BEGIN
  target_id:=COALESCE((to_jsonb(NEW)->>'notification_delivery_id')::uuid,(to_jsonb(NEW)->>'id')::uuid);
  SELECT * INTO runtime FROM public.notification_runtime_state WHERE notification_delivery_id=target_id;
  IF runtime.notification_delivery_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO delivery FROM public.notification_deliveries WHERE id=target_id;
  IF NOT EXISTS(SELECT 1 FROM public.notification_source_authority(runtime.source_outbox_event_id) s
    WHERE s.order_id=delivery.order_id AND s.event_type=delivery.event_type AND s.event_rank=runtime.event_rank)
    OR runtime.base_variables IS DISTINCT FROM public.notification_order_snapshot(delivery.order_id,runtime.base_variables->>'siteName')
    OR runtime.created_at<>delivery.created_at
    OR ((delivery.status='PROCESSING') IS DISTINCT FROM (runtime.lease_token IS NOT NULL))
    OR ((runtime.fallback_reason_code IS NOT NULL) IS DISTINCT FROM delivery.fallback_used)
    OR NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.id=delivery.order_id AND o.customer_contact_id=delivery.customer_contact_id
      AND o.presentation_locale=delivery.requested_locale AND runtime.base_variables->>'publicOrderId'=o.public_order_id::text
      AND runtime.base_variables->>'currency'=o.currency AND (runtime.base_variables->>'totalMinor')::bigint=o.total_amount_minor)
    OR (runtime.link_token_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.order_access_tokens t WHERE t.id=runtime.link_token_id
      AND t.order_id=delivery.order_id AND t.purpose='LINK' AND t.token_pepper_version=runtime.link_pepper_version))
  THEN RAISE EXCEPTION 'notification runtime must bind its exact source, lease and order link' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='notification_runtime_state' AND TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.customer_contacts c WHERE c.id=delivery.customer_contact_id AND c.email_lookup_hmac=runtime.contact_lookup_hmac AND c.lookup_key_version=runtime.contact_lookup_key_version) THEN RAISE EXCEPTION 'notification must freeze its exact recipient lookup identity' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER notification_runtime_consistency AFTER INSERT OR UPDATE ON public.notification_runtime_state
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_notification_runtime_consistency();
CREATE CONSTRAINT TRIGGER notification_runtime_delivery_consistency AFTER INSERT OR UPDATE ON public.notification_deliveries
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_notification_runtime_consistency();

CREATE OR REPLACE FUNCTION public.validate_notification_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM orders o
    WHERE o.id = NEW.order_id
      AND o.customer_contact_id = NEW.customer_contact_id
      AND o.presentation_locale = NEW.requested_locale
      AND (
        (NEW.event_type = 'PAYMENT_CONFIRMED'
          AND o.payment_status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'))
        OR (NEW.event_type = 'PREPARING'
          AND o.fulfillment_status IN ('PREPARING', 'DELIVERED'))
        OR (NEW.event_type = 'DELIVERED' AND o.fulfillment_status = 'DELIVERED')
        OR EXISTS(SELECT 1 FROM public.notification_runtime_state runtime
          CROSS JOIN LATERAL public.notification_source_authority(runtime.source_outbox_event_id) source
          WHERE runtime.notification_delivery_id=NEW.id AND source.order_id=o.id AND source.event_type=NEW.event_type)
      )
  ) THEN
    RAISE EXCEPTION 'notification must use the order contact, locale, and achieved state'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TABLE public.notification_contact_access_receipts (
  audit_log_id uuid PRIMARY KEY REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  notification_delivery_id uuid NOT NULL REFERENCES public.notification_deliveries(id) ON DELETE RESTRICT,
  customer_contact_id uuid NOT NULL REFERENCES public.customer_contacts(id) ON DELETE RESTRICT,
  lease_token uuid NOT NULL,
  generation bigint NOT NULL CHECK(generation>0),
  created_at public.finite_timestamptz NOT NULL
);
CREATE FUNCTION public.assert_notification_contact_access_authority() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.notification_deliveries d
    JOIN public.notification_runtime_state r ON r.notification_delivery_id=d.id
    JOIN public.customer_contacts c ON c.id=d.customer_contact_id
    JOIN public.audit_logs a ON a.id=NEW.audit_log_id
    WHERE d.id=NEW.notification_delivery_id AND d.status='PROCESSING'
      AND c.id=NEW.customer_contact_id AND c.retention_status='ACTIVE' AND c.email_lookup_hmac=r.contact_lookup_hmac AND c.lookup_key_version=r.contact_lookup_key_version
      AND r.lease_token=NEW.lease_token AND r.generation=NEW.generation AND r.lease_expires_at>clock_timestamp()
      AND a.actor_type='WORKER' AND a.action='AUTHORIZE_NOTIFICATION_CONTACT_READ' AND a.subject_type='CUSTOMER_CONTACT'
      AND a.subject_id=c.id AND a.field_category='CUSTOMER_CONTACT_EMAIL' AND a.outcome='SUCCEEDED'
      AND a.request_id=d.request_id AND a.correlation_id=d.correlation_id AND a.created_at=NEW.created_at)
  THEN RAISE EXCEPTION 'notification contact access requires a current scoped delivery and audit' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER notification_contact_access_authority BEFORE INSERT ON public.notification_contact_access_receipts FOR EACH ROW EXECUTE FUNCTION public.assert_notification_contact_access_authority();
CREATE TRIGGER notification_contact_access_no_modify BEFORE UPDATE OR DELETE ON public.notification_contact_access_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER notification_contact_access_no_truncate BEFORE TRUNCATE ON public.notification_contact_access_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE OR REPLACE FUNCTION public.validate_order_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  previous_event order_events%ROWTYPE;
  authority_and_fields_valid boolean;
BEGIN
  IF NEW.authority_kind = 'ADMIN' THEN
    PERFORM 1 FROM audit_logs audit
    WHERE audit.id = NEW.audit_log_id
    FOR UPDATE;

    IF NOT EXISTS (
      SELECT 1 FROM audit_logs audit
      WHERE audit.id = NEW.audit_log_id
        AND audit.actor_type = 'ADMIN'
        AND audit.actor_id = NEW.admin_identity_id
        AND audit.action = 'ORDER_CANCELED'
        AND audit.subject_type = 'ORDER'
        AND audit.subject_id = NEW.order_id
        AND audit.reason_code = NEW.reason_code
        AND audit.request_id = NEW.request_id
        AND audit.correlation_id = NEW.correlation_id
        AND audit.outcome = 'SUCCEEDED'
        AND audit.created_at = NEW.occurred_at
        AND NEW.occurred_at = transaction_timestamp()
    ) THEN
      RAISE EXCEPTION 'admin order event requires exact fresh successful audit evidence'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM order_events event WHERE event.audit_log_id = NEW.audit_log_id
      UNION ALL
      SELECT 1 FROM fulfillment_events event WHERE event.audit_log_id = NEW.audit_log_id
    ) THEN
      RAISE EXCEPTION 'admin authority audit evidence was already consumed'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.sequence = 1 THEN
    IF NEW.event_type <> 'ORDER_CREATED'
       OR NEW.authority_kind <> 'CHECKOUT'
       OR NEW.from_order_status IS NOT NULL
       OR NEW.from_payment_status IS NOT NULL
       OR NEW.from_dispute_status IS NOT NULL
       OR NEW.from_fulfillment_status IS NOT NULL
       OR NEW.from_payment_attempt_id IS NOT NULL
       OR NEW.to_order_status <> 'DRAFT'
       OR NEW.to_payment_status <> 'UNPAID'
       OR NEW.to_dispute_status <> 'NONE'
       OR NEW.to_fulfillment_status <> 'PENDING'
       OR NEW.to_payment_attempt_id IS NOT NULL THEN
      RAISE EXCEPTION 'first order event must be an origin snapshot' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO previous_event
  FROM order_events
  WHERE order_id = NEW.order_id AND sequence = NEW.sequence - 1;

  IF previous_event.id IS NULL THEN
    RAISE EXCEPTION 'order event sequence must be contiguous' USING ERRCODE = '23514';
  END IF;

  IF NEW.event_type = 'ORDER_CREATED'
     OR NEW.from_order_status <> previous_event.to_order_status
     OR NEW.from_payment_status <> previous_event.to_payment_status
     OR NEW.from_dispute_status <> previous_event.to_dispute_status
     OR NEW.from_fulfillment_status <> previous_event.to_fulfillment_status
     OR NEW.from_payment_attempt_id IS DISTINCT FROM previous_event.to_payment_attempt_id THEN
    RAISE EXCEPTION 'order event must continue the prior aggregate snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    NEW.to_order_status = NEW.from_order_status
    OR (NEW.from_order_status = 'DRAFT' AND NEW.to_order_status = 'PENDING_PAYMENT')
    OR (NEW.from_order_status = 'PENDING_PAYMENT' AND NEW.to_order_status IN ('OPEN', 'CANCELED'))
    OR (NEW.from_order_status = 'OPEN' AND NEW.to_order_status = 'CLOSED')
    OR (NEW.from_order_status = 'CANCELED' AND NEW.to_order_status = 'OPEN')
  ) THEN
    RAISE EXCEPTION 'order event contains an invalid lifecycle edge' USING ERRCODE = '23514';
  END IF;

  IF NOT (
    NEW.to_payment_status = NEW.from_payment_status
    OR (NEW.from_payment_status = 'UNPAID' AND NEW.to_payment_status = 'PENDING')
    OR (NEW.from_payment_status = 'PENDING' AND NEW.to_payment_status = 'PAID')
    OR (NEW.from_payment_status = 'PAID' AND NEW.to_payment_status IN ('PARTIALLY_REFUNDED', 'REFUNDED'))
    OR (NEW.from_payment_status = 'PARTIALLY_REFUNDED' AND NEW.to_payment_status = 'REFUNDED')
  ) THEN
    RAISE EXCEPTION 'order event contains an invalid payment edge' USING ERRCODE = '23514';
  END IF;

  IF NOT (
    NEW.to_dispute_status = NEW.from_dispute_status
    OR (NEW.from_dispute_status = 'NONE' AND NEW.to_dispute_status = 'OPEN')
    OR (NEW.from_dispute_status = 'OPEN' AND NEW.to_dispute_status IN ('WON', 'LOST'))
  ) THEN
    RAISE EXCEPTION 'order event contains an invalid dispute edge' USING ERRCODE = '23514';
  END IF;

  IF NEW.to_order_status = NEW.from_order_status
     AND NEW.to_payment_status = NEW.from_payment_status
     AND NEW.to_dispute_status = NEW.from_dispute_status
     AND NEW.to_fulfillment_status = NEW.from_fulfillment_status
     AND NEW.to_payment_attempt_id IS NOT DISTINCT FROM NEW.from_payment_attempt_id THEN
    RAISE EXCEPTION 'order event must record a state or attempt binding change'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.event_type = 'LIFECYCLE_CHANGED' AND NEW.to_order_status = NEW.from_order_status THEN
    RAISE EXCEPTION 'lifecycle event must change lifecycle status' USING ERRCODE = '23514';
  ELSIF NEW.event_type = 'PAYMENT_STATUS_CHANGED' AND NEW.to_payment_status = NEW.from_payment_status THEN
    RAISE EXCEPTION 'payment event must change payment status' USING ERRCODE = '23514';
  ELSIF NEW.event_type = 'DISPUTE_STATUS_CHANGED' AND NEW.to_dispute_status = NEW.from_dispute_status THEN
    RAISE EXCEPTION 'dispute event must change dispute status' USING ERRCODE = '23514';
  ELSIF NEW.event_type = 'FULFILLMENT_AGGREGATE_CHANGED'
        AND NEW.to_fulfillment_status = NEW.from_fulfillment_status THEN
    RAISE EXCEPTION 'fulfillment aggregate event must change fulfillment status' USING ERRCODE = '23514';
  ELSIF NEW.event_type = 'PAYMENT_ATTEMPT_BOUND'
        AND NEW.to_payment_attempt_id IS NOT DISTINCT FROM NEW.from_payment_attempt_id THEN
    RAISE EXCEPTION 'attempt binding event must change payment attempt' USING ERRCODE = '23514';
  ELSIF NEW.event_type = 'LATE_PAYMENT_RECOVERED'
        AND NOT (NEW.from_order_status = 'CANCELED' AND NEW.to_order_status = 'OPEN') THEN
    RAISE EXCEPTION 'late payment recovery must reopen a canceled order' USING ERRCODE = '23514';
  END IF;

  authority_and_fields_valid := CASE NEW.event_type
    WHEN 'LIFECYCLE_CHANGED' THEN
      NEW.to_payment_status = NEW.from_payment_status
      AND NEW.to_dispute_status = NEW.from_dispute_status
      AND NEW.to_fulfillment_status = NEW.from_fulfillment_status
      AND NEW.to_payment_attempt_id IS NOT DISTINCT FROM NEW.from_payment_attempt_id
      AND (
        (NEW.from_order_status = 'DRAFT' AND NEW.to_order_status = 'PENDING_PAYMENT'
          AND NEW.authority_kind = 'CHECKOUT' AND NEW.reason_code = 'ORDER_CHECKOUT_CREATED')
        OR (NEW.from_order_status = 'PENDING_PAYMENT' AND NEW.to_order_status = 'CANCELED'
          AND NEW.authority_kind IN ('PROVIDER_EVIDENCE', 'ADMIN')
          AND NEW.reason_code = 'ORDER_CANCELED')
        OR (NEW.from_order_status = 'PENDING_PAYMENT' AND NEW.to_order_status = 'CANCELED'
          AND NEW.authority_kind = 'SYSTEM' AND NEW.reason_code = 'CHECKOUT_QUOTE_EXPIRED'
          AND NEW.occurred_at = transaction_timestamp()
          AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id=NEW.order_id
            AND o.quote_expires_at<=transaction_timestamp() AND o.payment_status IN('UNPAID','PENDING')
            AND NOT EXISTS(SELECT 1 FROM public.payment_attempts a WHERE a.order_id=o.id AND a.status NOT IN('FAILED','CANCELED','EXPIRED'))
            AND ((o.current_payment_attempt_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.payment_attempts a WHERE a.order_id=o.id))
              OR EXISTS(SELECT 1 FROM public.payment_attempts a WHERE a.id=o.current_payment_attempt_id AND a.order_id=o.id AND a.status IN('FAILED','CANCELED','EXPIRED'))))
          AND EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.id=NEW.audit_log_id
            AND a.actor_type='SYSTEM' AND a.actor_id IS NULL AND a.task_name IS NOT NULL
            AND a.action='ORDER_CHECKOUT_EXPIRED' AND a.subject_type='ORDER' AND a.subject_id=NEW.order_id
            AND a.reason_code='CHECKOUT_QUOTE_EXPIRED' AND a.request_id=NEW.request_id AND a.correlation_id=NEW.correlation_id
            AND a.outcome='SUCCEEDED' AND a.created_at=NEW.occurred_at)
          AND NOT EXISTS(SELECT 1 FROM public.order_events e WHERE e.audit_log_id=NEW.audit_log_id)
          AND NOT EXISTS(SELECT 1 FROM public.fulfillment_events e WHERE e.audit_log_id=NEW.audit_log_id))
        OR (NEW.from_order_status = 'OPEN' AND NEW.to_order_status = 'CLOSED'
          AND NEW.authority_kind = 'FULFILLMENT'
          AND NEW.reason_code = 'ORDER_FULFILLMENT_COMPLETED')
      )
    WHEN 'PAYMENT_STATUS_CHANGED' THEN
      NEW.to_dispute_status = NEW.from_dispute_status
      AND (
        (NEW.from_payment_status = 'UNPAID' AND NEW.to_payment_status = 'PENDING'
          AND NEW.to_order_status = NEW.from_order_status
          AND NEW.to_fulfillment_status = NEW.from_fulfillment_status
          AND NEW.from_payment_attempt_id IS NULL
          AND NEW.to_payment_attempt_id IS NOT NULL
          AND NEW.authority_kind = 'CHECKOUT'
          AND NEW.reason_code = 'ORDER_PAYMENT_ATTEMPT_CREATED')
        OR (NEW.from_payment_status = 'PENDING' AND NEW.to_payment_status = 'PAID'
          AND NEW.from_order_status = 'PENDING_PAYMENT' AND NEW.to_order_status = 'OPEN'
          AND NEW.from_fulfillment_status = 'PENDING'
          AND NEW.to_fulfillment_status IN ('PENDING', 'ON_HOLD')
          AND NEW.to_payment_attempt_id IS NOT DISTINCT FROM NEW.from_payment_attempt_id
          AND NEW.to_payment_attempt_id IS NOT NULL
          AND NEW.authority_kind = 'PROVIDER_EVIDENCE'
          AND NEW.reason_code = 'ORDER_PAYMENT_CONFIRMED')
        OR (NEW.from_payment_status IN ('PAID', 'PARTIALLY_REFUNDED')
          AND NEW.to_payment_status IN ('PARTIALLY_REFUNDED', 'REFUNDED')
          AND NEW.to_order_status = NEW.from_order_status
          AND NEW.to_fulfillment_status = NEW.from_fulfillment_status
          AND NEW.to_payment_attempt_id IS NOT DISTINCT FROM NEW.from_payment_attempt_id
          AND NEW.authority_kind = 'REFUND_AGGREGATE'
          AND NEW.reason_code = 'ORDER_REFUND_TOTAL_CONFIRMED')
      )
    WHEN 'DISPUTE_STATUS_CHANGED' THEN
      NEW.to_order_status = NEW.from_order_status
      AND NEW.to_payment_status = NEW.from_payment_status
      AND NEW.to_fulfillment_status = NEW.from_fulfillment_status
      AND NEW.to_payment_attempt_id IS NOT DISTINCT FROM NEW.from_payment_attempt_id
      AND NEW.authority_kind = 'PROVIDER_EVIDENCE'
    WHEN 'FULFILLMENT_AGGREGATE_CHANGED' THEN
      NEW.to_order_status = NEW.from_order_status
      AND NEW.to_payment_status = NEW.from_payment_status
      AND NEW.to_dispute_status = NEW.from_dispute_status
      AND NEW.to_payment_attempt_id IS NOT DISTINCT FROM NEW.from_payment_attempt_id
      AND NEW.authority_kind = 'FULFILLMENT'
    WHEN 'PAYMENT_ATTEMPT_BOUND' THEN
      NEW.to_order_status = NEW.from_order_status
      AND NEW.to_payment_status = NEW.from_payment_status
      AND NEW.to_dispute_status = NEW.from_dispute_status
      AND NEW.to_fulfillment_status = NEW.from_fulfillment_status
      AND NEW.authority_kind IN ('CHECKOUT', 'SYSTEM')
      AND NEW.reason_code = 'PAYMENT_ATTEMPT_BOUND'
    WHEN 'LATE_PAYMENT_RECOVERED' THEN
      NEW.from_order_status = 'CANCELED' AND NEW.to_order_status = 'OPEN'
      AND NEW.from_payment_status = 'PENDING' AND NEW.to_payment_status = 'PAID'
      AND NEW.to_dispute_status = NEW.from_dispute_status
      AND NEW.to_payment_attempt_id IS NOT NULL
      AND NEW.authority_kind = 'PROVIDER_EVIDENCE'
      AND NEW.reason_code IN ('PAYMENT_SUCCESS_RECONCILED', 'LATE_PAYMENT_INVENTORY_UNAVAILABLE')
    ELSE false
  END;

  IF NOT authority_and_fields_valid THEN
    RAISE EXCEPTION 'order event authority or changed-field set is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.assert_checkout_expiry_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.authority_kind='SYSTEM' AND NEW.reason_code='CHECKOUT_QUOTE_EXPIRED' THEN
    IF NOT EXISTS(SELECT 1 FROM public.orders o JOIN public.carts c ON c.id=o.cart_id JOIN public.checkout_sessions s ON s.id=o.checkout_session_id
      WHERE o.id=NEW.order_id AND o.order_status='CANCELED' AND c.status='EXPIRED' AND s.status='EXPIRED')
      OR EXISTS(SELECT 1 FROM public.inventory_reservations r WHERE r.locked_order_id=NEW.order_id AND r.status='ACTIVE')
      OR EXISTS(SELECT 1 FROM public.order_items i JOIN public.support_intents s ON s.id=i.support_intent_id WHERE i.order_id=NEW.order_id AND s.status<>'CANCELED')
    THEN RAISE EXCEPTION 'checkout expiry must atomically close its original locked aggregate' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER checkout_expiry_complete AFTER INSERT ON public.order_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_checkout_expiry_complete();
