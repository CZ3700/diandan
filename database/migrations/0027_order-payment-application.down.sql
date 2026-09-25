SET search_path = public;
LOCK TABLE provider_events, order_payment_application_receipts, order_payment_application_schedule IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM provider_events WHERE canonical_transaction_event_id IS NOT NULL)
    OR EXISTS(SELECT 1 FROM order_payment_application_receipts)
    OR EXISTS(SELECT 1 FROM order_payment_application_schedule) THEN
    RAISE EXCEPTION 'order payment application evidence prevents rollback' USING ERRCODE='55000';
  END IF;
END $$;
DROP TABLE order_payment_application_receipts;
DROP FUNCTION assert_order_payment_application_receipt();
DROP TABLE order_payment_application_schedule;
DROP TRIGGER provider_event_canonical_alias_validate ON provider_events;
DROP FUNCTION validate_provider_event_canonical_alias();
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
DROP INDEX provider_events_transaction_reference_unique;
ALTER TABLE provider_events DROP COLUMN canonical_transaction_event_id;
ALTER TABLE provider_events ADD CONSTRAINT provider_events_transaction_reference_unique UNIQUE(provider_account_id,environment,provider_transaction_type,provider_transaction_reference);
