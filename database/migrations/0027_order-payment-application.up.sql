SET search_path = public;

-- Each source retains its own authenticated event. Only the canonical source owns a capture ledger row.
ALTER TABLE provider_events ADD COLUMN canonical_transaction_event_id uuid REFERENCES provider_events(id) ON DELETE RESTRICT;
ALTER TABLE provider_events DROP CONSTRAINT provider_events_transaction_reference_unique;
CREATE UNIQUE INDEX provider_events_transaction_reference_unique ON provider_events(provider_account_id,environment,provider_transaction_type,provider_transaction_reference) WHERE canonical_transaction_event_id IS NULL;

CREATE FUNCTION validate_provider_event_canonical_alias()
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
CREATE TRIGGER provider_event_canonical_alias_validate BEFORE INSERT ON provider_events FOR EACH ROW EXECUTE FUNCTION validate_provider_event_canonical_alias();

CREATE TABLE order_payment_application_schedule (
  provider_event_id uuid PRIMARY KEY REFERENCES provider_events(id) ON DELETE RESTRICT,
  next_attempt_at finite_timestamptz NOT NULL,
  attempt_count bigint NOT NULL CHECK(attempt_count>0)
);
CREATE INDEX order_payment_application_due_idx ON order_payment_application_schedule(next_attempt_at,provider_event_id);
CREATE TABLE order_payment_application_receipts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
  provider_event_id uuid NOT NULL UNIQUE REFERENCES provider_events(id) ON DELETE RESTRICT,
  canonical_provider_event_id uuid NOT NULL REFERENCES provider_events(id) ON DELETE RESTRICT,
  attempt_id uuid REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK(decision IN('APPLIED','REVIEW','IGNORED')),
  outcome text CHECK(outcome IN('PAID','PAID_REVIEW','FAILED_RELEASED')),
  reason_code text CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  request_id uuid NOT NULL, correlation_id uuid NOT NULL,
  task_name text NOT NULL CHECK(task_name ~ '^[a-z][a-z0-9]*([-_:][a-z0-9]+)*$' AND length(task_name)<=128),
  result jsonb NOT NULL,
  created_at finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK((attempt_id IS NULL)=(order_id IS NULL)),
  CHECK((decision='APPLIED' AND attempt_id IS NOT NULL AND outcome IS NOT NULL AND reason_code IS NULL)
     OR (decision IN('REVIEW','IGNORED') AND outcome IS NULL AND reason_code IS NOT NULL)),
  CHECK(result=jsonb_build_object('schemaVersion',1,'receiptId',id,'providerEventId',provider_event_id,'decision',decision,'attemptId',attempt_id,'orderId',order_id)
    || CASE WHEN decision='APPLIED' THEN jsonb_build_object('outcome',outcome) ELSE jsonb_build_object('reasonCode',reason_code) END)
);
CREATE TRIGGER order_payment_receipt_immutable BEFORE UPDATE OR DELETE ON order_payment_application_receipts FOR EACH ROW EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER order_payment_receipt_no_truncate BEFORE TRUNCATE ON order_payment_application_receipts FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER order_payment_schedule_no_delete BEFORE DELETE ON order_payment_application_schedule FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER order_payment_schedule_no_truncate BEFORE TRUNCATE ON order_payment_application_schedule FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

CREATE FUNCTION assert_order_payment_application_receipt()
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
CREATE CONSTRAINT TRIGGER order_payment_application_receipt_validate AFTER INSERT ON order_payment_application_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_order_payment_application_receipt();

CREATE OR REPLACE FUNCTION assert_provider_transaction_ledger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_event_id uuid;
  event_row public.provider_events%ROWTYPE;
  matched_count integer;
  ledger_count integer;
BEGIN
  IF TG_TABLE_NAME = 'provider_events' THEN
    target_event_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'provider_event_associations' THEN
    target_event_id := NEW.provider_event_id;
  ELSE
    RAISE EXCEPTION 'unsupported provider transaction ledger source: %', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO event_row
  FROM public.provider_events
  WHERE id = target_event_id;

  SELECT count(*) INTO matched_count
  FROM public.provider_event_associations association
  WHERE association.provider_event_id = target_event_id
    AND association.association_status = 'MATCHED';

  IF event_row.canonical_transaction_event_id IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM payment_transactions WHERE provider_event_id=target_event_id)
      OR NOT EXISTS(SELECT 1 FROM provider_events canonical JOIN payment_transactions ledger ON ledger.provider_event_id=canonical.id
        WHERE canonical.id=event_row.canonical_transaction_event_id AND canonical.canonical_transaction_event_id IS NULL
          AND ledger.transaction_type=event_row.provider_transaction_type AND ledger.provider_transaction_reference=event_row.provider_transaction_reference
          AND ledger.amount_minor=event_row.amount_minor AND ledger.currency=event_row.currency
          AND (matched_count=0 OR EXISTS(SELECT 1 FROM provider_event_associations a WHERE a.provider_event_id=target_event_id AND a.association_status='MATCHED' AND a.payment_attempt_id=ledger.payment_attempt_id))) THEN
      RAISE EXCEPTION 'payment capture alias must reuse its exact canonical ledger' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
  END IF;

  SELECT count(*) INTO ledger_count
  FROM public.payment_transactions transaction_row
  JOIN public.provider_event_associations association
    ON association.provider_event_id = target_event_id
   AND association.association_status = 'MATCHED'
   AND association.payment_attempt_id = transaction_row.payment_attempt_id
  WHERE transaction_row.provider_event_id = target_event_id
    AND transaction_row.transaction_type = event_row.provider_transaction_type
    AND transaction_row.provider_transaction_reference = event_row.provider_transaction_reference
    AND transaction_row.amount_minor = event_row.amount_minor
    AND transaction_row.currency = event_row.currency
    AND transaction_row.evidence_kind = event_row.evidence_kind
    AND transaction_row.reconcile_audit_log_id IS NOT DISTINCT FROM event_row.reconcile_audit_log_id
    AND transaction_row.occurred_at = event_row.occurred_at;

  IF event_row.id IS NULL
     OR (matched_count = 0 AND ledger_count <> 0)
     OR (matched_count = 1 AND event_row.provider_transaction_type IS NULL
       AND ledger_count <> 0)
     OR (matched_count = 1 AND event_row.provider_transaction_type IS NOT NULL
       AND ledger_count <> 1) THEN
    RAISE EXCEPTION 'provider transaction evidence and exact ledger record must commit together'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION validate_payment_transaction_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM provider_events WHERE id=NEW.provider_event_id AND canonical_transaction_event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'capture aliases cannot create financial ledger rows' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM provider_events event
    JOIN provider_event_associations association
      ON association.provider_event_id = event.id
      AND association.association_status = 'MATCHED'
      AND association.payment_attempt_id = NEW.payment_attempt_id
    WHERE event.id = NEW.provider_event_id
      AND event.evidence_kind = NEW.evidence_kind
      AND event.reconcile_audit_log_id IS NOT DISTINCT FROM NEW.reconcile_audit_log_id
      AND event.amount_minor = NEW.amount_minor
      AND event.currency = NEW.currency
      AND event.provider_transaction_type = NEW.transaction_type
      AND event.provider_transaction_reference = NEW.provider_transaction_reference
      AND event.occurred_at = NEW.occurred_at
  ) THEN
    RAISE EXCEPTION 'payment transaction requires exact normalized provider evidence'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_events event
    WHERE event.id = NEW.provider_event_id
      AND (
        (NEW.transaction_type = 'AUTHORIZATION'
          AND event.event_type = 'PAYMENT_STATUS'
          AND event.normalized_status IN ('PROCESSING', 'SUCCEEDED'))
        OR (NEW.transaction_type = 'CAPTURE'
          AND event.event_type = 'PAYMENT_STATUS'
          AND event.normalized_status = 'SUCCEEDED')
        OR (NEW.transaction_type = 'VOID'
          AND event.event_type = 'PAYMENT_STATUS'
          AND event.normalized_status = 'CANCELED')
        OR (NEW.transaction_type = 'REFUND'
          AND event.event_type = 'REFUND_STATUS'
          AND event.normalized_status = 'SUCCEEDED')
        OR (NEW.transaction_type = 'CHARGEBACK'
          AND event.event_type = 'DISPUTE_STATUS'
          AND event.normalized_status IN ('OPEN', 'LOST'))
        OR (NEW.transaction_type = 'ADJUSTMENT'
          AND event.event_type = 'PAYMENT_STATUS'
          AND event.normalized_status = 'SUCCEEDED'
          AND NEW.evidence_kind = 'AUTHENTICATED_RECONCILE')
      )
  ) THEN
    RAISE EXCEPTION 'payment transaction type does not match provider evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
