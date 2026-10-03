SET search_path = public;
-- Restore the pre-0042 texts verbatim (0035 validate_order_event, 0027 receipt assertion).

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
    OR (NEW.to_dispute_status IN ('OPEN','WON','LOST'))
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

CREATE OR REPLACE FUNCTION assert_order_payment_application_receipt()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM provider_events e WHERE e.id=NEW.provider_event_id AND coalesce(e.canonical_transaction_event_id,e.id)=NEW.canonical_provider_event_id)
    OR (NEW.attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_attempts a WHERE a.id=NEW.attempt_id AND a.order_id=NEW.order_id)) THEN
    RAISE EXCEPTION 'order payment receipt must retain exact source and aggregate identity' USING ERRCODE='23514';
  END IF;
  IF NEW.decision<>'APPLIED' THEN RETURN NULL; END IF;
  -- A later source observes the already completed effect; later fulfillment/refund progression does not revoke that history.
  IF NEW.provider_event_id<>NEW.canonical_provider_event_id THEN
    IF NOT EXISTS(SELECT 1 FROM order_payment_application_receipts canonical
      WHERE canonical.provider_event_id=NEW.canonical_provider_event_id AND canonical.canonical_provider_event_id=canonical.provider_event_id
        AND canonical.decision='APPLIED' AND canonical.attempt_id=NEW.attempt_id AND canonical.order_id=NEW.order_id AND canonical.outcome=NEW.outcome) THEN
      RAISE EXCEPTION 'capture alias receipt requires the permanent canonical application' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM provider_events e JOIN provider_event_associations matched ON matched.provider_event_id=e.id AND matched.association_status='MATCHED' AND matched.payment_attempt_id=NEW.attempt_id JOIN payment_attempts a ON a.id=NEW.attempt_id JOIN orders o ON o.id=a.order_id
    WHERE e.id=NEW.canonical_provider_event_id AND e.event_type='PAYMENT_STATUS' AND e.normalized_status=a.status
      AND a.provider_event_id=e.id AND a.status_evidence_kind=e.evidence_kind AND a.evidence_audit_log_id IS NOT DISTINCT FROM e.reconcile_audit_log_id
      AND a.provider_account_id=e.provider_account_id AND a.environment=e.environment AND a.external_reference=e.external_payment_reference AND a.amount_minor=e.amount_minor AND a.currency=e.currency
      AND o.id=NEW.order_id AND o.current_payment_attempt_id=a.id
      AND ((NEW.outcome IN('PAID','PAID_REVIEW') AND a.status='SUCCEEDED' AND o.order_status='OPEN' AND o.payment_status='PAID'
        AND EXISTS(SELECT 1 FROM carts c WHERE c.id=o.cart_id AND c.status='CONVERTED' AND c.locked_order_id=o.id)
        AND NOT EXISTS(SELECT 1 FROM order_items i JOIN support_intents s ON s.id=i.support_intent_id WHERE i.order_id=o.id AND s.status<>'CONVERTED')
        AND NOT EXISTS(SELECT 1 FROM fulfillments f WHERE f.order_id=o.id AND f.status<>CASE WHEN NEW.outcome='PAID_REVIEW' THEN 'ON_HOLD' ELSE 'PENDING' END))
      OR (NEW.outcome='FAILED_RELEASED' AND a.status IN('FAILED','CANCELED','EXPIRED') AND o.payment_status='PENDING'))
      AND NOT EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.locked_order_id=o.id AND r.status='ACTIVE')
  ) THEN RAISE EXCEPTION 'order payment receipt requires the complete canonical aggregate' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
