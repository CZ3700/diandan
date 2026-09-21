SET search_path=public;
INSERT INTO public.permissions(id,permission_key,description) VALUES(gen_random_uuid(),'finance.manage','Manage refunds, cancellation and authenticated reconciliation') ON CONFLICT(permission_key) DO NOTHING;
INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.role_key='manager' AND p.permission_key='finance.manage' ON CONFLICT DO NOTHING;
CREATE TABLE public.admin_finance_operations (
 id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES orders(id),attempt_id uuid REFERENCES payment_attempts(id),refund_id uuid REFERENCES refunds(id),
 action text NOT NULL CHECK(action IN('REFUND','CANCEL','RECONCILE')),phase text NOT NULL CHECK(phase IN('REFUND_READY','REFUND_RECONCILE','CANCEL_READY','PAYMENT_RECONCILE','COMPLETE')),
 provider_account_id uuid REFERENCES payment_provider_accounts(id),environment text CHECK(environment IN('TEST','LIVE')),adapter_key text,
 reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{1,127}$'),generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),dispatch_count integer NOT NULL DEFAULT 0 CHECK(dispatch_count BETWEEN 0 AND 1),
 lease_token_digest bytea CHECK(lease_token_digest IS NULL OR octet_length(lease_token_digest)=32),lease_expires_at finite_timestamptz,claim jsonb,
 next_attempt_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(),last_error_code text,created_at finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),updated_at finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CHECK((lease_token_digest IS NULL)=(lease_expires_at IS NULL)),CHECK(updated_at>=created_at),CHECK((refund_id IS NOT NULL)=(phase IN('REFUND_READY','REFUND_RECONCILE') OR (phase='COMPLETE' AND refund_id IS NOT NULL)))
);
CREATE UNIQUE INDEX admin_finance_refund_operation_unique ON admin_finance_operations(refund_id) WHERE refund_id IS NOT NULL;
CREATE UNIQUE INDEX admin_finance_active_cancel_unique ON admin_finance_operations(attempt_id) WHERE action='CANCEL' AND phase<>'COMPLETE';
CREATE INDEX admin_finance_operations_due ON admin_finance_operations(next_attempt_at,id) WHERE phase<>'COMPLETE';
CREATE TABLE public.admin_finance_receipts (
 id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES admin_identities(id),session_id uuid NOT NULL REFERENCES admin_sessions(id),order_id uuid NOT NULL REFERENCES orders(id),operation_id uuid NOT NULL REFERENCES admin_finance_operations(id),refund_id uuid REFERENCES refunds(id),action text NOT NULL CHECK(action IN('REFUND','CANCEL','RECONCILE')),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),request_hash sha256_hex NOT NULL,expected_order_version positive_version NOT NULL,confirmed boolean NOT NULL CHECK(confirmed),reason_code text NOT NULL,
 audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id),request_id uuid NOT NULL,correlation_id uuid NOT NULL,created_at finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),UNIQUE(actor_id,action,idempotency_key)
);
CREATE TABLE public.admin_finance_application_receipts (
 provider_event_id uuid PRIMARY KEY REFERENCES provider_events(id),order_id uuid REFERENCES orders(id),decision text NOT NULL CHECK(decision IN('APPLIED','REVIEW','IGNORED')),reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{1,127}$'),request_id uuid NOT NULL,correlation_id uuid NOT NULL,created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.admin_finance_application_schedule (
 provider_event_id uuid PRIMARY KEY REFERENCES provider_events(id),next_attempt_at finite_timestamptz NOT NULL,attempt_count bigint NOT NULL CHECK(attempt_count>0)
);
CREATE FUNCTION public.guard_admin_finance_operation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
 IF NEW.generation<>0 OR NEW.dispatch_count<>0 OR NEW.lease_token_digest IS NOT NULL OR NEW.claim IS NOT NULL OR (NEW.phase='COMPLETE' AND NEW.action<>'CANCEL') THEN RAISE EXCEPTION 'financial operation must start unclaimed' USING ERRCODE='23514';END IF;
 IF NEW.attempt_id IS NULL AND (NEW.action<>'CANCEL' OR NEW.phase<>'COMPLETE' OR NEW.provider_account_id IS NOT NULL OR NEW.environment IS NOT NULL OR NEW.adapter_key IS NOT NULL OR EXISTS(SELECT 1 FROM payment_attempts WHERE order_id=NEW.order_id)) THEN RAISE EXCEPTION 'only an unattempted checkout may complete without provider binding' USING ERRCODE='23514';END IF;
 IF NEW.attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_attempts a JOIN payment_provider_accounts p ON p.id=a.provider_account_id WHERE a.id=NEW.attempt_id AND a.order_id=NEW.order_id AND a.provider_account_id=NEW.provider_account_id AND a.environment=NEW.environment AND p.adapter_key=NEW.adapter_key) THEN RAISE EXCEPTION 'financial operation must pin original payment identity' USING ERRCODE='23514';END IF;
 ELSE
 IF to_jsonb(NEW)-ARRAY['phase','generation','dispatch_count','lease_token_digest','lease_expires_at','claim','next_attempt_at','last_error_code','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['phase','generation','dispatch_count','lease_token_digest','lease_expires_at','claim','next_attempt_at','last_error_code','updated_at'] OR NEW.generation<OLD.generation OR NEW.generation>OLD.generation+1 OR NEW.dispatch_count<OLD.dispatch_count OR OLD.phase='COMPLETE' THEN RAISE EXCEPTION 'financial operation immutable binding or fence invalid' USING ERRCODE='55000';END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER admin_finance_operation_guard BEFORE INSERT OR UPDATE ON admin_finance_operations FOR EACH ROW EXECUTE FUNCTION guard_admin_finance_operation();
CREATE FUNCTION public.assert_admin_finance_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a audit_logs%ROWTYPE; op admin_finance_operations%ROWTYPE;
BEGIN
 SELECT * INTO a FROM audit_logs WHERE id=NEW.audit_log_id;SELECT * INTO op FROM admin_finance_operations WHERE id=NEW.operation_id;
 IF NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.read',NEW.created_at) OR NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'finance.manage',NEW.created_at) OR a.actor_type IS DISTINCT FROM 'ADMIN' OR a.actor_id IS DISTINCT FROM NEW.actor_id OR a.outcome IS DISTINCT FROM 'SUCCEEDED' OR a.reason_code IS DISTINCT FROM NEW.reason_code OR a.request_id IS DISTINCT FROM NEW.request_id OR a.correlation_id IS DISTINCT FROM NEW.correlation_id OR a.created_at IS DISTINCT FROM NEW.created_at OR op.order_id IS DISTINCT FROM NEW.order_id OR op.refund_id IS DISTINCT FROM NEW.refund_id THEN RAISE EXCEPTION 'financial operation requires exact live authority and audit' USING ERRCODE='23514';END IF;
 IF (NEW.action IN('CANCEL','RECONCILE') AND (a.action IS DISTINCT FROM 'FINANCE_'||NEW.action||'_REQUESTED' OR a.subject_type IS DISTINCT FROM 'ORDER' OR a.subject_id IS DISTINCT FROM NEW.order_id)) OR (NEW.action IN('REFUND','CANCEL') AND op.action IS DISTINCT FROM NEW.action) OR (NEW.action='RECONCILE' AND NOT ((op.action='REFUND' AND op.refund_id IS NOT NULL) OR (op.action='RECONCILE' AND op.refund_id IS NULL))) THEN RAISE EXCEPTION 'financial receipt must retain exact operation and requested audit action' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM orders o WHERE o.id=NEW.order_id AND o.version=NEW.expected_order_version+CASE WHEN NEW.action='CANCEL' AND op.phase='COMPLETE' AND o.order_status='CANCELED' THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'financial receipt requires exact expected order version' USING ERRCODE='23514';END IF;
 IF NEW.action='REFUND' AND (a.action IS DISTINCT FROM 'REFUND_REQUESTED' OR a.subject_type IS DISTINCT FROM 'REFUND' OR a.subject_id IS DISTINCT FROM NEW.refund_id OR NOT EXISTS(SELECT 1 FROM refunds r WHERE r.id=NEW.refund_id AND r.order_id=NEW.order_id AND r.requested_audit_log_id=NEW.audit_log_id)) THEN RAISE EXCEPTION 'refund receipt must bind exact request audit' USING ERRCODE='23514';END IF;
 RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER admin_finance_receipt_authority AFTER INSERT ON admin_finance_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_admin_finance_receipt();
CREATE FUNCTION public.assert_admin_finance_operation_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_finance_receipts WHERE operation_id=NEW.id) THEN RAISE EXCEPTION 'financial operation requires durable command receipt' USING ERRCODE='23514';END IF;RETURN NULL;END;$$;
CREATE CONSTRAINT TRIGGER admin_finance_operation_receipt AFTER INSERT ON admin_finance_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_admin_finance_operation_receipt();
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['admin_finance_receipts','admin_finance_application_receipts'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_append_only()',name||'_immutable',name);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only()',name||'_no_truncate',name);END LOOP;
 FOREACH name IN ARRAY ARRAY['admin_finance_operations','admin_finance_application_schedule'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_append_only()',name||'_no_delete',name);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only()',name||'_no_truncate',name);END LOOP;
END;$$;
CREATE FUNCTION public.guard_finance_cancel_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF EXISTS(SELECT 1 FROM admin_finance_operations WHERE order_id=NEW.order_id AND action='CANCEL' AND phase<>'COMPLETE') THEN RAISE EXCEPTION 'cancellation intent forbids a new payment attempt' USING ERRCODE='23514';END IF;RETURN NEW;END;$$;
CREATE TRIGGER finance_cancel_attempt_guard BEFORE INSERT ON payment_attempts FOR EACH ROW EXECUTE FUNCTION guard_finance_cancel_attempt();
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
    OR (NEW.dispute_status IN ('OPEN','WON','LOST'))
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

CREATE OR REPLACE FUNCTION validate_provider_event_canonical_alias()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.canonical_transaction_event_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.id=NEW.canonical_transaction_event_id OR NEW.provider_transaction_type NOT IN ('CAPTURE','REFUND','CHARGEBACK','VOID')
    OR NOT EXISTS (
      SELECT 1 FROM provider_events canonical
      JOIN provider_event_associations association ON association.provider_event_id=canonical.id AND association.association_status='MATCHED'
      JOIN payment_transactions ledger ON ledger.provider_event_id=canonical.id AND ledger.payment_attempt_id=association.payment_attempt_id
      WHERE canonical.id=NEW.canonical_transaction_event_id AND canonical.canonical_transaction_event_id IS NULL
        AND canonical.provider_account_id=NEW.provider_account_id AND canonical.environment=NEW.environment
        AND canonical.event_type=NEW.event_type AND (canonical.normalized_status=NEW.normalized_status OR (NEW.provider_transaction_type='CHARGEBACK' AND canonical.normalized_status IN('OPEN','LOST') AND NEW.normalized_status IN('OPEN','LOST')))
        AND canonical.provider_refund_reference IS NOT DISTINCT FROM NEW.provider_refund_reference AND canonical.provider_dispute_reference IS NOT DISTINCT FROM NEW.provider_dispute_reference
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
CREATE FUNCTION public.assert_finance_order_projection() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE total bigint; target text;
BEGIN
 IF NEW.event_type='PAYMENT_STATUS_CHANGED' AND NEW.authority_kind='REFUND_AGGREGATE' THEN
 SELECT coalesce(sum(processed_amount_minor),0) INTO total FROM refunds WHERE order_id=NEW.order_id AND status='SUCCEEDED';
 SELECT CASE WHEN total=o.total_amount_minor THEN 'REFUNDED' WHEN total>0 AND total<o.total_amount_minor THEN 'PARTIALLY_REFUNDED' ELSE 'PAID' END INTO target FROM orders o WHERE o.id=NEW.order_id;
 IF NEW.to_payment_status IS DISTINCT FROM target THEN RAISE EXCEPTION 'refund order projection requires exact successful total' USING ERRCODE='23514';END IF;
 ELSIF NEW.event_type='DISPUTE_STATUS_CHANGED' THEN
 SELECT CASE WHEN bool_or(status='LOST') THEN 'LOST' WHEN bool_or(status='OPEN') THEN 'OPEN' WHEN bool_and(status='WON') THEN 'WON' ELSE 'NONE' END INTO target FROM disputes WHERE order_id=NEW.order_id AND status<>'NONE';
 IF NEW.to_dispute_status IS DISTINCT FROM target OR NOT EXISTS(SELECT 1 FROM disputes WHERE order_id=NEW.order_id AND provider_event_id=NEW.provider_event_id) THEN RAISE EXCEPTION 'dispute projection requires exact trusted dispute collection' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER finance_order_projection AFTER INSERT ON order_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_finance_order_projection();

CREATE OR REPLACE FUNCTION validate_order_provider_cancel_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.authority_kind='PROVIDER_EVIDENCE' AND NEW.event_type='LIFECYCLE_CHANGED' AND NEW.from_order_status='PENDING_PAYMENT' AND NEW.to_order_status='CANCELED'
    AND EXISTS(SELECT 1 FROM admin_finance_operations x JOIN admin_finance_receipts r ON r.operation_id=x.id JOIN payment_attempts a ON a.id=x.attempt_id JOIN provider_events e ON e.id=NEW.provider_event_id JOIN provider_event_associations matched ON matched.provider_event_id=e.id AND matched.association_status='MATCHED' AND matched.payment_attempt_id=a.id
      WHERE x.order_id=NEW.order_id AND x.action='CANCEL' AND r.action='CANCEL' AND a.id=NEW.to_payment_attempt_id AND a.status IN('FAILED','CANCELED','EXPIRED') AND a.status=e.normalized_status AND a.provider_account_id=e.provider_account_id AND a.environment=e.environment AND a.external_reference=e.external_payment_reference AND a.amount_minor=e.amount_minor AND a.currency=e.currency AND e.event_type='PAYMENT_STATUS') THEN RETURN NEW; END IF;
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
CREATE FUNCTION public.assert_finance_projection_head() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target_order uuid := NEW.order_id; target text; current text; total bigint;
BEGIN
 IF TG_TABLE_NAME='disputes' THEN
 SELECT CASE WHEN bool_or(status='LOST') THEN 'LOST' WHEN bool_or(status='OPEN') THEN 'OPEN' WHEN bool_and(status='WON') THEN 'WON' ELSE 'NONE' END INTO target FROM disputes WHERE order_id=target_order AND status<>'NONE';
 SELECT dispute_status INTO current FROM orders WHERE id=target_order;
 ELSE
 SELECT coalesce(sum(processed_amount_minor),0) INTO total FROM refunds WHERE order_id=target_order AND status='SUCCEEDED';
 SELECT CASE WHEN total=o.total_amount_minor THEN 'REFUNDED' WHEN total>0 AND total<o.total_amount_minor THEN 'PARTIALLY_REFUNDED' ELSE 'PAID' END,payment_status INTO target,current FROM orders o WHERE o.id=target_order;
 END IF;
 IF target IS DISTINCT FROM current THEN RAISE EXCEPTION 'financial evidence must atomically project its complete order aggregate' USING ERRCODE='23514';END IF;RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER finance_refund_projection_head AFTER INSERT OR UPDATE ON refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_finance_projection_head();
CREATE CONSTRAINT TRIGGER finance_dispute_projection_head AFTER INSERT OR UPDATE ON disputes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_finance_projection_head();
CREATE FUNCTION public.guard_finance_fulfillment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF NEW.status IN('PENDING','PREPARING','DELIVERED') AND NEW.status IS DISTINCT FROM OLD.status THEN
 PERFORM 1 FROM orders WHERE id=NEW.order_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM disputes WHERE order_id=NEW.order_id AND status IN('OPEN','LOST')) THEN RAISE EXCEPTION 'open or lost dispute prevents fulfillment advancement' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM refunds WHERE order_id=NEW.order_id AND status IN('REQUESTED','SUBMITTING','PROCESSING','UNKNOWN')) THEN RAISE EXCEPTION 'pending refund prevents preparation or delivery' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;END;$$;
CREATE TRIGGER finance_fulfillment_guard BEFORE UPDATE OF status ON fulfillments FOR EACH ROW EXECUTE FUNCTION guard_finance_fulfillment();
CREATE FUNCTION public.guard_finance_refund_dispute() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF EXISTS(SELECT 1 FROM disputes WHERE payment_attempt_id=NEW.payment_attempt_id AND status IN('OPEN','LOST')) THEN RAISE EXCEPTION 'open or lost dispute prevents a new refund' USING ERRCODE='23514';END IF;RETURN NEW;END;$$;
CREATE TRIGGER finance_refund_dispute_guard BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION guard_finance_refund_dispute();
