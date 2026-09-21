SET search_path=public;
LOCK TABLE admin_finance_operations,admin_finance_receipts,admin_finance_application_receipts,admin_finance_application_schedule,provider_events,audit_logs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM admin_finance_receipts) OR EXISTS(SELECT 1 FROM admin_finance_application_receipts) OR EXISTS(SELECT 1 FROM admin_finance_operations) OR EXISTS(SELECT 1 FROM admin_finance_application_schedule) OR EXISTS(SELECT 1 FROM audit_logs WHERE task_name='admin-finance' OR action IN('REFUND_REQUESTED','FINANCE_CANCEL_REQUESTED','FINANCE_RECONCILE_REQUESTED','FINANCE_PAYMENT_CANCELED')) OR EXISTS(SELECT 1 FROM provider_events WHERE canonical_transaction_event_id IS NOT NULL AND provider_transaction_type<>'CAPTURE') THEN RAISE EXCEPTION 'financial operations history cannot be downgraded' USING ERRCODE='55000';END IF;END;$$;
DROP TRIGGER finance_fulfillment_guard ON fulfillments;
DROP TRIGGER finance_refund_dispute_guard ON refunds;
DROP FUNCTION guard_finance_fulfillment();
DROP FUNCTION guard_finance_refund_dispute();
DROP TRIGGER finance_refund_projection_head ON refunds;
DROP TRIGGER finance_dispute_projection_head ON disputes;
DROP FUNCTION assert_finance_projection_head();
DROP TRIGGER finance_order_projection ON order_events;
DROP FUNCTION assert_finance_order_projection();
DROP TRIGGER finance_cancel_attempt_guard ON payment_attempts;
DROP FUNCTION guard_finance_cancel_attempt();
DROP TABLE admin_finance_application_schedule;
DROP TABLE admin_finance_application_receipts;
DROP TABLE admin_finance_receipts;
DROP TABLE admin_finance_operations;
DROP FUNCTION assert_admin_finance_operation_receipt();
DROP FUNCTION assert_admin_finance_receipt();
DROP FUNCTION guard_admin_finance_operation();
DELETE FROM role_permissions WHERE permission_id IN(SELECT id FROM permissions WHERE permission_key='finance.manage');
DELETE FROM permissions WHERE permission_key='finance.manage';
CREATE OR REPLACE FUNCTION guard_order_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'order version must increment exactly once' USING ERRCODE = '23514';
  END IF;

  IF (to_jsonb(NEW)
        - 'order_status' - 'payment_status' - 'dispute_status' - 'fulfillment_status'
        - 'current_payment_attempt_id' - 'version' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(OLD)
        - 'order_status' - 'payment_status' - 'dispute_status' - 'fulfillment_status'
        - 'current_payment_attempt_id' - 'version' - 'updated_at') THEN
    RAISE EXCEPTION 'order identity and amount snapshot are immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'order updated_at cannot move backwards' USING ERRCODE = '23514';
  END IF;

  IF NOT (
    NEW.order_status = OLD.order_status
    OR (OLD.order_status = 'DRAFT' AND NEW.order_status = 'PENDING_PAYMENT')
    OR (OLD.order_status = 'PENDING_PAYMENT' AND NEW.order_status IN ('OPEN', 'CANCELED'))
    OR (OLD.order_status = 'OPEN' AND NEW.order_status = 'CLOSED')
    OR (OLD.order_status = 'CANCELED' AND NEW.order_status = 'OPEN')
  ) THEN
    RAISE EXCEPTION 'invalid order lifecycle transition' USING ERRCODE = '23514';
  END IF;

  IF NOT (
    NEW.payment_status = OLD.payment_status
    OR (OLD.payment_status = 'UNPAID' AND NEW.payment_status = 'PENDING')
    OR (OLD.payment_status = 'PENDING' AND NEW.payment_status = 'PAID')
    OR (OLD.payment_status = 'PAID' AND NEW.payment_status IN ('PARTIALLY_REFUNDED', 'REFUNDED'))
    OR (OLD.payment_status = 'PARTIALLY_REFUNDED' AND NEW.payment_status = 'REFUNDED')
  ) THEN
    RAISE EXCEPTION 'invalid order payment transition' USING ERRCODE = '23514';
  END IF;

  IF NOT (
    NEW.dispute_status = OLD.dispute_status
    OR (OLD.dispute_status = 'NONE' AND NEW.dispute_status = 'OPEN')
    OR (OLD.dispute_status = 'OPEN' AND NEW.dispute_status IN ('WON', 'LOST'))
  ) THEN
    RAISE EXCEPTION 'invalid order dispute transition' USING ERRCODE = '23514';
  END IF;

  IF OLD.payment_status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
     AND NEW.current_payment_attempt_id IS DISTINCT FROM OLD.current_payment_attempt_id THEN
    RAISE EXCEPTION 'captured order payment attempt binding is immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.order_status = OLD.order_status
     AND NEW.payment_status = OLD.payment_status
     AND NEW.dispute_status = OLD.dispute_status
     AND NEW.fulfillment_status = OLD.fulfillment_status
     AND NEW.current_payment_attempt_id IS NOT DISTINCT FROM OLD.current_payment_attempt_id THEN
    RAISE EXCEPTION 'order update must change a versioned aggregate field' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION validate_provider_event_canonical_alias()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.canonical_transaction_event_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.id=NEW.canonical_transaction_event_id OR NEW.provider_transaction_type IS DISTINCT FROM 'CAPTURE'
    OR NOT EXISTS (
      SELECT 1 FROM provider_events canonical
      JOIN provider_event_associations association ON association.provider_event_id=canonical.id AND association.association_status='MATCHED'
      JOIN payment_transactions ledger ON ledger.provider_event_id=canonical.id AND ledger.payment_attempt_id=association.payment_attempt_id
      WHERE canonical.id=NEW.canonical_transaction_event_id AND canonical.canonical_transaction_event_id IS NULL
        AND canonical.provider_account_id=NEW.provider_account_id AND canonical.environment=NEW.environment
        AND canonical.event_type=NEW.event_type AND canonical.normalized_status=NEW.normalized_status
        AND canonical.external_payment_reference=NEW.external_payment_reference
        AND canonical.provider_transaction_type=NEW.provider_transaction_type
        AND canonical.provider_transaction_reference=NEW.provider_transaction_reference
        AND canonical.amount_minor=NEW.amount_minor AND canonical.currency=NEW.currency
        AND ledger.transaction_type=canonical.provider_transaction_type AND ledger.provider_transaction_reference=canonical.provider_transaction_reference
        AND ledger.amount_minor=canonical.amount_minor AND ledger.currency=canonical.currency
        AND ledger.evidence_kind=canonical.evidence_kind AND ledger.reconcile_audit_log_id IS NOT DISTINCT FROM canonical.reconcile_audit_log_id
        AND ledger.occurred_at=canonical.occurred_at
    ) THEN
    RAISE EXCEPTION 'payment capture alias requires exact canonical authenticated ledger' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_order_provider_cancel_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.authority_kind <> 'PROVIDER_EVIDENCE'
     OR NEW.event_type <> 'LIFECYCLE_CHANGED'
     OR NEW.from_order_status <> 'PENDING_PAYMENT'
     OR NEW.to_order_status <> 'CANCELED' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders order_row
    JOIN public.payment_attempts attempt
      ON attempt.id = NEW.to_payment_attempt_id
     AND attempt.order_id = NEW.order_id
    JOIN public.provider_event_associations association
      ON association.provider_event_id = NEW.provider_event_id
     AND association.association_status = 'MATCHED'
     AND association.payment_attempt_id = attempt.id
    JOIN public.provider_events event
      ON event.id = association.provider_event_id
     AND event.provider_account_id = attempt.provider_account_id
     AND event.environment = attempt.environment
     AND event.external_payment_reference = attempt.external_reference
    JOIN public.payment_attempt_events attempt_event
      ON attempt_event.payment_attempt_id = attempt.id
     AND attempt_event.sequence = attempt.version
     AND attempt_event.to_status = attempt.status
     AND attempt_event.provider_event_id = event.id
     AND attempt_event.request_id = NEW.request_id
     AND attempt_event.correlation_id = NEW.correlation_id
     AND attempt_event.occurred_at = NEW.occurred_at
    WHERE order_row.id = NEW.order_id
      AND order_row.current_payment_attempt_id = attempt.id
      AND NEW.from_payment_attempt_id = attempt.id
      AND NEW.to_payment_attempt_id = attempt.id
      AND attempt.status = event.normalized_status
      AND event.event_type = 'PAYMENT_STATUS'
      AND event.normalized_status IN ('FAILED', 'CANCELED', 'EXPIRED')
      AND event.evidence_kind = attempt.status_evidence_kind
      AND event.reconcile_audit_log_id IS NOT DISTINCT FROM attempt.evidence_audit_log_id
      AND event.occurred_at = NEW.occurred_at
  ) THEN
    RAISE EXCEPTION 'provider order cancellation requires the current attempt terminal evidence chain'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
