SET search_path = public;
LOCK TABLE public.payment_create_receipts,public.payment_runtime_operations,public.payment_reconcile_receipts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.payment_create_receipts) OR EXISTS(SELECT 1 FROM public.payment_runtime_operations) OR EXISTS(SELECT 1 FROM public.payment_reconcile_receipts) THEN
    RAISE EXCEPTION 'payment runtime rollback would discard durable payment history' USING ERRCODE='55000';
  END IF;
END $$;
DROP TRIGGER payment_runtime_dispatch_guard ON public.payment_attempts;
ALTER TABLE public.payment_runtime_operations DROP CONSTRAINT payment_runtime_receipt_backlink;
DROP TABLE public.payment_reconcile_receipts;
DROP TABLE public.payment_create_receipts;
DROP TABLE public.payment_runtime_operations;
DROP FUNCTION public.assert_payment_reconcile_receipt();
DROP FUNCTION public.assert_payment_runtime_receipt();
DROP FUNCTION public.guard_payment_runtime_dispatch();
DROP FUNCTION public.guard_payment_runtime_operation();

CREATE OR REPLACE FUNCTION public.validate_payment_attempt_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  transition_allowed boolean;
  pinned_config_count integer;
  payable_order boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'CREATED' OR NEW.version <> 1
       OR NEW.status_evidence_kind <> 'ATTEMPT_CREATED'
       OR NEW.provider_event_id IS NOT NULL OR NEW.evidence_audit_log_id IS NOT NULL
       OR NEW.provider_call_started OR NEW.external_reference IS NOT NULL
       OR NEW.refund_occupied_minor <> 0 THEN
      RAISE EXCEPTION 'new payment attempt must start as an uncalled CREATED attempt'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO pinned_config_count
      FROM config_versions config
      WHERE config.id = NEW.config_version_id
        AND config.config_kind = 'PAYMENT_ROUTING'
        AND config.version = NEW.config_version
        AND config.lifecycle IN ('PUBLISHED', 'SUPERSEDED');
    IF pinned_config_count <> 1 THEN
      RAISE EXCEPTION 'payment attempt must pin an immutable published config version'
        USING ERRCODE = '23514';
    END IF;
    SELECT true INTO payable_order
      FROM orders
      WHERE id = NEW.order_id
        AND order_status = 'PENDING_PAYMENT'
        AND payment_status IN ('UNPAID', 'PENDING')
      FOR UPDATE;
    IF COALESCE(payable_order, false) = false OR EXISTS (
      SELECT 1 FROM payment_attempts predecessor
      WHERE predecessor.order_id = NEW.order_id
        AND predecessor.status NOT IN ('FAILED', 'CANCELED', 'EXPIRED')
    ) THEN
      RAISE EXCEPTION 'payment attempt retry requires a payable order and only terminal failed predecessors'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'refund_occupied_minor') IS NOT DISTINCT FROM
     (to_jsonb(OLD) - 'refund_occupied_minor') THEN
    IF NEW.refund_occupied_minor IS DISTINCT FROM OLD.refund_occupied_minor
       AND pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'refund capacity can only change from a refund trigger'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'provider_call_started' - 'external_reference'
      - 'action_type' - 'action_ciphertext' - 'action_encrypted_data_key'
      - 'action_key_version' - 'action_expires_at' - 'action_poll_after_ms'
      - 'status_evidence_kind' - 'provider_event_id' - 'evidence_audit_log_id'
      - 'evidence_reason_code' - 'version' - 'updated_at' - 'succeeded_at'
      - 'terminated_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'provider_call_started' - 'external_reference'
      - 'action_type' - 'action_ciphertext' - 'action_encrypted_data_key'
      - 'action_key_version' - 'action_expires_at' - 'action_poll_after_ms'
      - 'status_evidence_kind' - 'provider_event_id' - 'evidence_audit_log_id'
      - 'evidence_reason_code' - 'version' - 'updated_at' - 'succeeded_at'
      - 'terminated_at') THEN
    RAISE EXCEPTION 'payment attempt route, amount, locale, and identity are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.refund_occupied_minor <> OLD.refund_occupied_minor THEN
    RAISE EXCEPTION 'refund capacity can only change through a refund transaction'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED') THEN
    RAISE EXCEPTION 'terminal payment attempts are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'payment attempt transition requires one version increment and a later timestamp'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.provider_call_started AND NOT NEW.provider_call_started THEN
    RAISE EXCEPTION 'provider_call_started cannot be cleared'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.external_reference IS NOT NULL
     AND NEW.external_reference IS DISTINCT FROM OLD.external_reference THEN
    RAISE EXCEPTION 'provider external reference is immutable once bound'
      USING ERRCODE = '55000';
  END IF;

  transition_allowed := CASE OLD.status
    WHEN 'CREATED' THEN NEW.status IN (
      'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'UNKNOWN'
    )
    WHEN 'REQUIRES_ACTION' THEN NEW.status IN (
      'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'UNKNOWN'
    )
    WHEN 'PROCESSING' THEN NEW.status IN ('SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'UNKNOWN')
    WHEN 'UNKNOWN' THEN NEW.status IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED')
    ELSE false
  END;
  IF NEW.status = OLD.status OR NOT transition_allowed THEN
    RAISE EXCEPTION 'invalid payment attempt transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'UNKNOWN' AND NEW.status_evidence_kind <> 'NETWORK_UNCERTAINTY' THEN
    RAISE EXCEPTION 'UNKNOWN payment requires network uncertainty evidence'
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'CREATED' AND NEW.status IN ('REQUIRES_ACTION', 'PROCESSING')
        AND NEW.status_evidence_kind <> 'CREATE_RESULT' THEN
    RAISE EXCEPTION 'initial provider action requires CREATE_RESULT evidence'
      USING ERRCODE = '23514';
  ELSIF NEW.status = 'CANCELED' AND OLD.status = 'CREATED' AND NOT NEW.provider_call_started
        AND NEW.status_evidence_kind <> 'AUDITED_BUSINESS_CANCEL' THEN
    RAISE EXCEPTION 'pre-provider cancellation requires audited evidence'
      USING ERRCODE = '23514';
  ELSIF NEW.status = 'EXPIRED' AND OLD.status = 'CREATED' AND NOT NEW.provider_call_started
        AND NEW.status_evidence_kind <> 'SAFE_EXPIRY' THEN
    RAISE EXCEPTION 'pre-provider expiry requires safe-expiry evidence'
      USING ERRCODE = '23514';
  ELSIF NOT (
    NEW.status = 'UNKNOWN'
    OR (OLD.status = 'CREATED' AND NEW.status IN ('REQUIRES_ACTION', 'PROCESSING'))
    OR (NEW.status = 'CANCELED' AND OLD.status = 'CREATED' AND NOT NEW.provider_call_started)
    OR (NEW.status = 'EXPIRED' AND OLD.status = 'CREATED' AND NOT NEW.provider_call_started)
  ) AND NEW.status_evidence_kind NOT IN ('VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE') THEN
    RAISE EXCEPTION 'payment terminal or reconciled transition requires trusted provider evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status_evidence_kind IN ('VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE')
     AND NEW.provider_event_id IS NULL THEN
    RAISE EXCEPTION 'trusted payment evidence requires provider_event_id'
      USING ERRCODE = '23514';
  ELSIF NEW.status_evidence_kind = 'VERIFIED_WEBHOOK'
        AND NEW.evidence_audit_log_id IS NOT NULL THEN
    RAISE EXCEPTION 'verified webhook evidence cannot carry reconcile audit evidence'
      USING ERRCODE = '23514';
  ELSIF NEW.status_evidence_kind = 'AUTHENTICATED_RECONCILE'
        AND NEW.evidence_audit_log_id IS NULL THEN
    RAISE EXCEPTION 'reconciled payment evidence requires its audit_log_id'
      USING ERRCODE = '23514';
  ELSIF NEW.status_evidence_kind = 'AUDITED_BUSINESS_CANCEL'
        AND (NEW.evidence_audit_log_id IS NULL OR NEW.provider_event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'audited business cancellation requires only audit_log_id'
      USING ERRCODE = '23514';
  ELSIF NEW.status_evidence_kind IN ('CREATE_RESULT', 'NETWORK_UNCERTAINTY', 'SAFE_EXPIRY')
        AND (NEW.provider_event_id IS NOT NULL OR NEW.evidence_audit_log_id IS NOT NULL) THEN
    RAISE EXCEPTION 'local payment evidence cannot carry provider or audit evidence IDs'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

