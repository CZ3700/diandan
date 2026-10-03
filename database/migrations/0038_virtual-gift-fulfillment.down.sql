SET search_path = public;
LOCK TABLE public.notification_runtime_state, public.fulfillment_events, public.order_items IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.notification_runtime_state)
    OR EXISTS(SELECT 1 FROM public.fulfillment_events WHERE authority_kind = 'SYSTEM' AND reason_code = 'VIRTUAL_GIFT_AUTO_DELIVERED') THEN
    RAISE EXCEPTION 'virtual gift fulfillment rollback would discard frozen notification variables or digital delivery history' USING ERRCODE = '55000';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.notification_order_snapshot(target_order_id uuid,site_name text)
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

CREATE OR REPLACE FUNCTION public.notification_source_authority(source_id uuid)
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

CREATE OR REPLACE FUNCTION validate_fulfillment_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  previous_event fulfillment_events%ROWTYPE;
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
        AND audit.action = 'FULFILLMENT_STATUS_CHANGED'
        AND audit.subject_type = 'FULFILLMENT'
        AND audit.subject_id = NEW.fulfillment_id
        AND audit.reason_code = NEW.reason_code
        AND audit.request_id = NEW.request_id
        AND audit.correlation_id = NEW.correlation_id
        AND audit.outcome = 'SUCCEEDED'
        AND audit.created_at = NEW.occurred_at
        AND NEW.occurred_at = transaction_timestamp()
    ) THEN
      RAISE EXCEPTION 'admin fulfillment event requires exact fresh successful audit evidence'
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

  IF NOT EXISTS (
    SELECT 1 FROM fulfillments fulfillment
    WHERE fulfillment.id = NEW.fulfillment_id AND fulfillment.order_id = NEW.order_id
  ) THEN
    RAISE EXCEPTION 'fulfillment event order does not own fulfillment'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.sequence = 1 THEN
    IF NEW.from_status IS NOT NULL OR NEW.to_status <> 'PENDING' THEN
      RAISE EXCEPTION 'first fulfillment event must create PENDING state'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO previous_event
  FROM fulfillment_events
  WHERE fulfillment_id = NEW.fulfillment_id AND sequence = NEW.sequence - 1;

  IF previous_event.id IS NULL OR NEW.from_status <> previous_event.to_status THEN
    RAISE EXCEPTION 'fulfillment event sequence must be contiguous'
      USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (NEW.from_status = 'PENDING' AND NEW.to_status IN ('PREPARING', 'ON_HOLD', 'CANCELED'))
    OR (NEW.from_status = 'PREPARING' AND NEW.to_status IN ('DELIVERED', 'ON_HOLD', 'CANCELED'))
    OR (NEW.from_status = 'ON_HOLD' AND NEW.to_status IN ('PENDING', 'PREPARING', 'CANCELED'))
  ) THEN
    RAISE EXCEPTION 'fulfillment event contains an invalid transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_fulfillment_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.status <> 'PENDING'
       OR NEW.hold_reason_code IS NOT NULL OR NEW.prepared_at IS NOT NULL
       OR NEW.delivered_at IS NOT NULL THEN
      RAISE EXCEPTION 'fulfillment must start PENDING at version one'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'fulfillment version must increment exactly once' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW)
        - 'status' - 'version' - 'hold_reason_code' - 'prepared_at' - 'delivered_at' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(OLD)
        - 'status' - 'version' - 'hold_reason_code' - 'prepared_at' - 'delivered_at' - 'updated_at') THEN
    RAISE EXCEPTION 'fulfillment ownership and profile snapshot are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'PENDING' AND NEW.status IN ('PREPARING', 'ON_HOLD', 'CANCELED'))
    OR (OLD.status = 'PREPARING' AND NEW.status IN ('DELIVERED', 'ON_HOLD', 'CANCELED'))
    OR (OLD.status = 'ON_HOLD' AND NEW.status IN ('PENDING', 'PREPARING', 'CANCELED'))
  ) THEN
    RAISE EXCEPTION 'invalid fulfillment transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.prepared_at IS NOT NULL AND NEW.prepared_at IS DISTINCT FROM OLD.prepared_at THEN
    RAISE EXCEPTION 'fulfillment prepared timestamp is immutable once set'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status IN ('PREPARING', 'DELIVERED') AND NEW.prepared_at IS NULL THEN
    RAISE EXCEPTION 'prepared and delivered fulfillment requires prepared_at'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('PREPARING', 'DELIVERED') AND NOT EXISTS (
    SELECT 1
    FROM public.order_items item
    JOIN public.support_intents intent ON intent.id = item.support_intent_id
    JOIN public.cart_items cart_item ON cart_item.id = item.cart_item_id
    WHERE item.id = NEW.order_item_id
      AND item.order_id = NEW.order_id
      AND (
        ((cart_item.has_fan_message OR intent.fan_message_ciphertext IS NOT NULL)
          AND intent.moderation_status = 'APPROVED'
          AND intent.privacy_state <> 'PURGED')
        OR (NOT cart_item.has_fan_message
          AND intent.fan_message_ciphertext IS NULL
          AND intent.moderation_status NOT IN ('REJECTED', 'REDACTED'))
      )
  ) THEN
    RAISE EXCEPTION 'fulfillment cannot prepare or deliver an unsafe support intent'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
    RAISE EXCEPTION 'fulfillment delivered timestamp is immutable once set'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.order_items DROP COLUMN gift_kind;
