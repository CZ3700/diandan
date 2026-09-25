SET search_path = public;

CREATE TABLE public.payment_runtime_operations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
  attempt_id uuid NOT NULL UNIQUE REFERENCES public.payment_attempts(id) ON DELETE RESTRICT,
  phase text NOT NULL CHECK(phase IN('CREATE','RECONCILE','EVIDENCE_PENDING','COMPLETE')),
  dispatch_authorized boolean NOT NULL DEFAULT true CHECK(dispatch_authorized),
  generation public.positive_version NOT NULL DEFAULT 1,
  version public.positive_version NOT NULL DEFAULT 1,
  lease_token_digest bytea CHECK(lease_token_digest IS NULL OR octet_length(lease_token_digest)=32),
  lease_expires_at public.finite_timestamptz,
  next_attempt_at public.finite_timestamptz,
  audit_log_id uuid,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  task_name text NOT NULL CHECK(length(task_name) BETWEEN 1 AND 128 AND task_name ~ '^[a-z][a-z0-9]*([-_:][a-z0-9]+)*$'),
  last_error_code text CHECK(last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  created_at public.finite_timestamptz NOT NULL,
  updated_at public.finite_timestamptz NOT NULL,
  CHECK(updated_at>=created_at),
  CHECK((lease_token_digest IS NULL)=(lease_expires_at IS NULL)),
  CHECK((phase IN('CREATE','RECONCILE') AND next_attempt_at IS NOT NULL)
    OR (phase IN('EVIDENCE_PENDING','COMPLETE') AND next_attempt_at IS NULL AND lease_token_digest IS NULL)),
  CHECK(audit_log_id IS NULL OR phase='RECONCILE')
);
CREATE INDEX payment_runtime_operations_due_idx ON public.payment_runtime_operations(next_attempt_at,id) WHERE phase IN('CREATE','RECONCILE');

CREATE TABLE public.payment_create_receipts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
  operation_id uuid NOT NULL UNIQUE REFERENCES public.payment_runtime_operations(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL UNIQUE REFERENCES public.payment_attempts(id) ON DELETE RESTRICT,
  cart_id uuid NOT NULL REFERENCES public.carts(id) ON DELETE RESTRICT,
  checkout_session_id uuid NOT NULL REFERENCES public.checkout_sessions(id) ON DELETE RESTRICT,
  idempotency_key public.idempotency_key_value NOT NULL,
  canonical_request_hash public.sha256_hex NOT NULL,
  create_command jsonb NOT NULL CHECK(jsonb_typeof(create_command)='object' AND create_command->>'operation'='CREATE_PAYMENT' AND create_command->>'schemaVersion'='1'),
  create_command_hash public.sha256_hex NOT NULL,
  supported_action_types jsonb NOT NULL CHECK(jsonb_typeof(supported_action_types)='array' AND jsonb_array_length(supported_action_types) BETWEEN 1 AND 4),
  country public.country_code NOT NULL,
  config_publication_id uuid NOT NULL REFERENCES public.payment_config_publications(id) ON DELETE RESTRICT,
  original_order_version public.positive_version NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at public.finite_timestamptz NOT NULL,
  UNIQUE(cart_id,checkout_session_id,idempotency_key),
  UNIQUE(operation_id,attempt_id),
  CHECK(create_command_hash=encode(sha256(convert_to(public.canonical_publication_json(create_command),'UTF8')),'hex'))
);

ALTER TABLE public.payment_runtime_operations ADD CONSTRAINT payment_runtime_receipt_backlink
  FOREIGN KEY(id,attempt_id) REFERENCES public.payment_create_receipts(operation_id,attempt_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.payment_reconcile_receipts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
  operation_id uuid NOT NULL REFERENCES public.payment_runtime_operations(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL REFERENCES public.payment_attempts(id) ON DELETE RESTRICT,
  provider_event_id uuid NOT NULL UNIQUE REFERENCES public.provider_events(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  disposition text NOT NULL CHECK(disposition IN('OBSERVED','APPLIED_NONFINANCIAL','PENDING')),
  created_at public.finite_timestamptz NOT NULL
);

CREATE FUNCTION public.guard_payment_runtime_operation() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.version<>1 OR NEW.generation<>1 OR NEW.phase<>'CREATE' OR NEW.lease_token_digest IS NULL OR NEW.audit_log_id IS NOT NULL OR NEW.lease_expires_at<=clock_timestamp()
      OR NOT EXISTS(SELECT 1 FROM public.payment_attempts a WHERE a.id=NEW.attempt_id AND a.status='CREATED' AND NOT a.provider_call_started) THEN
      RAISE EXCEPTION 'payment runtime must begin with one leased CREATED attempt' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id<>OLD.id OR NEW.attempt_id<>OLD.attempt_id OR NEW.schema_version<>OLD.schema_version OR NEW.created_at<>OLD.created_at
    OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR OLD.phase IN('EVIDENCE_PENDING','COMPLETE')
    OR NEW.generation NOT IN(OLD.generation,OLD.generation+1)
    OR (NEW.phase='CREATE' AND OLD.phase<>'CREATE') THEN
    RAISE EXCEPTION 'payment runtime identity, generation and phase are fenced' USING ERRCODE='23514';
  END IF;
  IF NEW.generation=OLD.generation+1 THEN
    IF OLD.lease_expires_at>clock_timestamp() OR NEW.lease_token_digest IS NULL OR NEW.lease_expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'payment runtime cannot replace a live lease' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.lease_token_digest IS NOT NULL AND NEW.lease_token_digest IS DISTINCT FROM OLD.lease_token_digest THEN
    RAISE EXCEPTION 'a replacement payment lease requires a new generation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER payment_runtime_operation_guard BEFORE INSERT OR UPDATE ON public.payment_runtime_operations FOR EACH ROW EXECUTE FUNCTION public.guard_payment_runtime_operation();

CREATE FUNCTION public.guard_payment_runtime_dispatch() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.status_evidence_kind IN('SAFE_EXPIRY','AUDITED_BUSINESS_CANCEL') AND EXISTS(
    SELECT 1 FROM public.payment_runtime_operations operation WHERE operation.attempt_id=NEW.id AND operation.dispatch_authorized
  ) THEN
    RAISE EXCEPTION 'a dispatched payment cannot use pre-provider cancellation or expiry' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER payment_runtime_dispatch_guard BEFORE UPDATE ON public.payment_attempts FOR EACH ROW EXECUTE FUNCTION public.guard_payment_runtime_dispatch();

CREATE FUNCTION public.assert_payment_runtime_receipt() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.payment_attempts%ROWTYPE; o public.orders%ROWTYPE; operation public.payment_runtime_operations%ROWTYPE; valid boolean;
BEGIN
  SELECT * INTO a FROM public.payment_attempts WHERE id=NEW.attempt_id;
  SELECT * INTO o FROM public.orders WHERE id=a.order_id FOR UPDATE;
  SELECT * INTO operation FROM public.payment_runtime_operations WHERE id=NEW.operation_id;
  SELECT true INTO valid FROM public.carts c JOIN public.checkout_sessions session ON session.id=NEW.checkout_session_id AND session.cart_id=c.id
    JOIN public.payment_route_rules rule ON rule.id=a.route_rule_id AND rule.provider_account_id=a.provider_account_id AND rule.config_version_id=a.config_version_id AND rule.rule_version=a.rule_version AND rule.payment_method=a.payment_method
    JOIN public.payment_provider_configs config ON config.id=rule.provider_config_id AND config.config_version_id=a.config_version_id
    JOIN public.payment_provider_accounts account ON account.id=a.provider_account_id AND account.environment=a.environment
    JOIN public.merchant_entities merchant ON merchant.id=account.merchant_entity_id
    JOIN public.payment_config_publication_heads head ON head.publication_id=NEW.config_publication_id AND head.config_version_id=a.config_version_id AND head.config_version=a.config_version
    WHERE c.id=NEW.cart_id AND c.id=o.cart_id AND c.status='LOCKED' AND c.locked_order_id=o.id AND c.expires_at>NEW.created_at
      AND session.id=o.checkout_session_id AND session.quote_id=o.checkout_quote_id AND session.quote_expires_at>NEW.created_at
      AND session.status IN('READY','PAYMENT_PENDING') AND o.quote_expires_at>NEW.created_at AND o.order_status='PENDING_PAYMENT' AND o.payment_status='PENDING'
      AND o.current_payment_attempt_id=a.id AND o.version=NEW.original_order_version+1
      AND a.status='CREATED' AND a.version=1 AND NOT a.provider_call_started AND a.external_reference IS NULL AND a.created_at=NEW.created_at
      AND a.amount_minor=o.total_amount_minor AND a.currency=o.currency AND a.requested_locale=o.presentation_locale
      AND operation.attempt_id=a.id AND operation.phase='CREATE' AND operation.generation=1 AND operation.created_at=NEW.created_at
      AND operation.request_id=NEW.request_id AND operation.correlation_id=NEW.correlation_id
      AND account.status IN('INTERNAL','ACTIVE') AND account.health_status='HEALTHY' AND merchant.status='ACTIVE'
      AND rule.enabled AND config.enabled AND rule.rollout_basis_points=10000 AND config.rollout_basis_points=10000
      AND a.amount_minor BETWEEN rule.minimum_amount_minor AND rule.maximum_amount_minor
      AND EXISTS(SELECT 1 FROM public.payment_route_rule_countries WHERE payment_route_rule_id=rule.id AND country=NEW.country)
      AND EXISTS(SELECT 1 FROM public.payment_route_rule_markets WHERE payment_route_rule_id=rule.id AND market=o.market)
      AND EXISTS(SELECT 1 FROM public.payment_route_rule_currencies WHERE payment_route_rule_id=rule.id AND currency=o.currency)
      AND NOT EXISTS(SELECT 1 FROM public.payment_route_rule_device_capabilities d WHERE d.payment_route_rule_id=rule.id AND NOT NEW.supported_action_types ? d.capability);
  IF COALESCE(valid,false)=false OR (
    NEW.create_command->>'attemptId'=a.id::text AND NEW.create_command->>'orderId'=a.order_id::text
    AND NEW.create_command->>'merchantReference'=a.id::text AND NEW.create_command->>'providerIdempotencyKey'=a.id::text
    AND NEW.create_command->>'providerAccountId'=a.provider_account_id::text AND NEW.create_command->>'environment'=a.environment
    AND NEW.create_command->>'amountMinor'=a.amount_minor::text AND NEW.create_command->>'currency'=a.currency
    AND NEW.create_command->>'requestedLocale'=a.requested_locale AND NEW.create_command->>'paymentMethod'=a.payment_method
  ) IS NOT TRUE OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.supported_action_types) AS selected(action) WHERE action NOT IN('REDIRECT','PROVIDER_HOSTED_IFRAME','PROVIDER_COMPONENT','QR_CODE'))
    OR (SELECT count(DISTINCT action) FROM jsonb_array_elements_text(NEW.supported_action_types) AS selected(action))<>jsonb_array_length(NEW.supported_action_types) THEN
    RAISE EXCEPTION 'payment create receipt must bind its exact authorized checkout and route' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.order_items item JOIN public.gift_variants variant ON variant.id=item.gift_variant_id JOIN public.support_intents intent ON intent.id=item.support_intent_id
    WHERE item.order_id=o.id AND (intent.status<>'CHECKOUT_LOCKED' OR intent.privacy_state<>'ACTIVE' OR intent.expires_at<=NEW.created_at
      OR (variant.inventory_policy='TRACKED' AND (
        (SELECT count(*) FROM public.inventory_reservations r WHERE r.checkout_session_id=o.checkout_session_id AND r.cart_item_id=item.cart_item_id AND r.status='ACTIVE')<>1
        OR NOT EXISTS(SELECT 1 FROM public.inventory_reservations r WHERE r.checkout_session_id=o.checkout_session_id AND r.checkout_quote_id=o.checkout_quote_id AND r.cart_item_id=item.cart_item_id AND r.gift_variant_id=item.gift_variant_id AND r.locked_order_id=o.id AND r.quantity=item.quantity AND r.status='ACTIVE' AND r.expires_at>NEW.created_at)))
      OR (variant.inventory_policy<>'TRACKED' AND EXISTS(SELECT 1 FROM public.inventory_reservations r WHERE r.checkout_session_id=o.checkout_session_id AND r.cart_item_id=item.cart_item_id))
    )) THEN RAISE EXCEPTION 'new payment requires the exact valid checkout reservations and intents' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER payment_runtime_receipt_validate AFTER INSERT ON public.payment_create_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_payment_runtime_receipt();

CREATE FUNCTION public.assert_payment_reconcile_receipt() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.provider_events event
    JOIN public.provider_event_associations association ON association.provider_event_id=event.id AND association.association_status='MATCHED' AND association.payment_attempt_id=NEW.attempt_id
    JOIN public.payment_runtime_operations operation ON operation.id=NEW.operation_id AND operation.attempt_id=NEW.attempt_id
    JOIN public.payment_attempts attempt ON attempt.id=NEW.attempt_id
    WHERE event.id=NEW.provider_event_id AND event.reconcile_audit_log_id=NEW.audit_log_id AND event.evidence_kind='AUTHENTICATED_RECONCILE' AND event.event_type='PAYMENT_STATUS'
      AND event.provider_account_id=attempt.provider_account_id AND event.environment=attempt.environment AND event.currency=attempt.currency AND event.amount_minor=attempt.amount_minor
      AND ((NEW.disposition='PENDING' AND event.normalized_status='SUCCEEDED' AND operation.phase='EVIDENCE_PENDING' AND attempt.status<>'SUCCEEDED')
        OR (NEW.disposition='APPLIED_NONFINANCIAL' AND event.normalized_status<>'SUCCEEDED' AND attempt.status=event.normalized_status AND attempt.provider_event_id=event.id)
        OR (NEW.disposition='OBSERVED' AND event.normalized_status<>'SUCCEEDED'))
  ) THEN RAISE EXCEPTION 'payment reconcile receipt requires exact authenticated provider evidence' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER payment_reconcile_receipt_validate AFTER INSERT ON public.payment_reconcile_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_payment_reconcile_receipt();

CREATE TRIGGER payment_create_receipts_immutable BEFORE UPDATE OR DELETE ON public.payment_create_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER payment_create_receipts_no_truncate BEFORE TRUNCATE ON public.payment_create_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER payment_runtime_operations_no_delete BEFORE DELETE ON public.payment_runtime_operations FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER payment_runtime_operations_no_truncate BEFORE TRUNCATE ON public.payment_runtime_operations FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER payment_reconcile_receipts_immutable BEFORE UPDATE OR DELETE ON public.payment_reconcile_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER payment_reconcile_receipts_no_truncate BEFORE TRUNCATE ON public.payment_reconcile_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

-- Recover the original customer action only from audited reconciliation; all other original mutation checks are byte-for-byte retained.
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
    WHEN 'UNKNOWN' THEN NEW.status IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED') OR (NEW.status='REQUIRES_ACTION' AND NEW.status_evidence_kind='AUTHENTICATED_RECONCILE' AND NEW.action_type IN('REDIRECT','PROVIDER_HOSTED_IFRAME','PROVIDER_COMPONENT','QR_CODE') AND NEW.action_ciphertext IS NOT NULL AND NEW.action_encrypted_data_key IS NOT NULL AND NEW.action_key_version IS NOT NULL)
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

