SET search_path = public;
LOCK TABLE public.notification_runtime_state,public.notification_contact_access_receipts,public.order_access_tokens IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.notification_runtime_state) OR EXISTS(SELECT 1 FROM public.notification_contact_access_receipts)
    OR EXISTS(SELECT 1 FROM public.order_access_tokens WHERE purpose='CHECKOUT_BOOTSTRAP')
    OR EXISTS(SELECT 1 FROM public.order_events WHERE authority_kind='SYSTEM' AND reason_code='CHECKOUT_QUOTE_EXPIRED')
  THEN RAISE EXCEPTION 'notification rollback would discard durable notification or bootstrap history' USING ERRCODE='55000'; END IF;
END $$;
DROP TRIGGER checkout_expiry_complete ON public.order_events;
DROP FUNCTION public.assert_checkout_expiry_complete();
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
      )
  ) THEN
    RAISE EXCEPTION 'notification must use the order contact, locale, and achieved state'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TABLE public.notification_contact_access_receipts;
DROP FUNCTION public.assert_notification_contact_access_authority();
DROP TRIGGER notification_runtime_delivery_consistency ON public.notification_deliveries;
DROP TABLE public.notification_runtime_state;
DROP FUNCTION public.assert_notification_runtime_consistency();
DROP FUNCTION public.guard_notification_runtime_immutable();
DROP FUNCTION public.notification_source_authority(uuid);
DROP FUNCTION public.notification_order_snapshot(uuid,text);
DROP TRIGGER order_access_bootstrap_complete ON public.order_access_tokens;
DROP FUNCTION public.assert_order_access_bootstrap_complete();
DROP INDEX public.order_access_tokens_one_active_per_order_idx;
ALTER TABLE public.order_access_tokens DROP COLUMN purpose;
CREATE UNIQUE INDEX order_access_tokens_one_active_per_order_idx ON public.order_access_tokens(order_id) WHERE status='ACTIVE';
