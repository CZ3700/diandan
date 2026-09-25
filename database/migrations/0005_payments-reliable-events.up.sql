SET search_path = public;

-- Merchant and provider configuration contains identifiers and Secret Manager
-- references only. Provider code remains a deployed adapter concern.
CREATE TABLE merchant_entities (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  entity_key text NOT NULL CHECK (entity_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  legal_country country_code NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  version positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT merchant_entities_entity_key_unique UNIQUE (entity_key),
  CONSTRAINT merchant_entities_time_check CHECK (updated_at >= created_at)
);

CREATE TABLE payment_provider_accounts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  merchant_entity_id uuid NOT NULL REFERENCES merchant_entities(id) ON DELETE RESTRICT,
  adapter_key text NOT NULL CHECK (adapter_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  environment text NOT NULL CHECK (environment IN ('TEST', 'LIVE')),
  account_reference_digest bytea NOT NULL CHECK (octet_length(account_reference_digest) >= 32),
  credential_secret_ref secret_reference NOT NULL,
  status text NOT NULL CHECK (status IN ('DISABLED', 'INTERNAL', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  health_status text NOT NULL DEFAULT 'HEALTHY' CHECK (health_status IN ('HEALTHY', 'UNAVAILABLE')),
  version positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT payment_provider_accounts_id_environment_unique UNIQUE (id, environment),
  CONSTRAINT payment_provider_accounts_identity_unique UNIQUE (
    merchant_entity_id,
    adapter_key,
    environment,
    account_reference_digest
  ),
  CONSTRAINT payment_provider_accounts_time_check CHECK (updated_at >= created_at)
);

CREATE TABLE payment_provider_health_events (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  provider_account_id uuid NOT NULL REFERENCES payment_provider_accounts(id) ON DELETE RESTRICT,
  sequence positive_version NOT NULL,
  from_status text CHECK (from_status IS NULL OR from_status IN ('HEALTHY', 'UNAVAILABLE')),
  to_status text NOT NULL CHECK (to_status IN ('HEALTHY', 'UNAVAILABLE')),
  observer_kind text NOT NULL CHECK (observer_kind IN ('SYSTEM', 'WORKER')),
  task_name text NOT NULL CHECK (
    length(task_name) BETWEEN 1 AND 128
    AND task_name ~ '^[a-z][a-z0-9]*([-_:][a-z0-9]+)*$'
  ),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT payment_provider_health_events_sequence_unique UNIQUE (
    provider_account_id,
    sequence
  ),
  CONSTRAINT payment_provider_health_events_origin_check CHECK (
    (sequence = 1 AND from_status IS NULL)
    OR (sequence > 1 AND from_status IS NOT NULL)
  )
);

CREATE TABLE payment_webhook_endpoints (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  provider_account_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('TEST', 'LIVE')),
  verification_secret_ref secret_reference NOT NULL,
  verification_key_reference_hash sha256_hex NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'ROTATION_OVERLAP', 'RETIRED')),
  rotated_from_endpoint_id uuid,
  active_from finite_timestamptz NOT NULL,
  overlap_started_at finite_timestamptz,
  retired_at finite_timestamptz,
  lifecycle_audit_log_id uuid NOT NULL REFERENCES audit_logs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT payment_webhook_endpoints_account_environment_fk
    FOREIGN KEY (provider_account_id, environment)
    REFERENCES payment_provider_accounts(id, environment) ON DELETE RESTRICT,
  CONSTRAINT payment_webhook_endpoints_id_binding_unique UNIQUE (
    id,
    provider_account_id,
    environment
  ),
  CONSTRAINT payment_webhook_endpoints_rotation_predecessor_fk
    FOREIGN KEY (rotated_from_endpoint_id, provider_account_id, environment)
    REFERENCES payment_webhook_endpoints(id, provider_account_id, environment)
    ON DELETE RESTRICT,
  CONSTRAINT payment_webhook_endpoints_key_binding_unique UNIQUE (
    id,
    provider_account_id,
    environment,
    verification_key_reference_hash
  ),
  CONSTRAINT payment_webhook_endpoints_key_history_unique UNIQUE (
    provider_account_id,
    environment,
    verification_key_reference_hash
  ),
  CONSTRAINT payment_webhook_endpoints_secret_history_unique UNIQUE (
    provider_account_id,
    environment,
    verification_secret_ref
  ),
  CONSTRAINT payment_webhook_endpoints_rotation_check CHECK (
    rotated_from_endpoint_id IS NULL OR rotated_from_endpoint_id <> id
  ),
  CONSTRAINT payment_webhook_endpoints_lifecycle_audit_unique UNIQUE (
    lifecycle_audit_log_id
  ),
  CONSTRAINT payment_webhook_endpoints_status_time_check CHECK (
    isfinite(active_from)
    AND (
      (status = 'ACTIVE' AND overlap_started_at IS NULL AND retired_at IS NULL)
      OR (status = 'ROTATION_OVERLAP'
        AND overlap_started_at IS NOT NULL AND isfinite(overlap_started_at)
        AND retired_at IS NOT NULL AND isfinite(retired_at)
        AND overlap_started_at >= active_from
        AND retired_at > overlap_started_at
        AND retired_at <= overlap_started_at + interval '24 hours')
      OR (status = 'RETIRED'
        AND retired_at IS NOT NULL AND isfinite(retired_at)
        AND retired_at >= active_from
        AND (
          overlap_started_at IS NULL
          OR (isfinite(overlap_started_at)
            AND overlap_started_at >= active_from
            AND retired_at > overlap_started_at
            AND retired_at <= overlap_started_at + interval '24 hours')
        ))
    )
  )
);

CREATE UNIQUE INDEX payment_webhook_endpoints_one_active_per_account_environment_idx
  ON payment_webhook_endpoints (provider_account_id, environment)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX payment_webhook_endpoints_one_overlap_per_account_environment_idx
  ON payment_webhook_endpoints (provider_account_id, environment)
  WHERE status = 'ROTATION_OVERLAP';

ALTER TABLE config_versions
  ADD CONSTRAINT config_versions_payment_identity_unique
    UNIQUE (id, config_kind, version);

CREATE TABLE payment_provider_configs (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  config_version_id uuid NOT NULL,
  config_kind text NOT NULL DEFAULT 'PAYMENT_ROUTING' CHECK (config_kind = 'PAYMENT_ROUTING'),
  config_version positive_version NOT NULL,
  provider_account_id uuid NOT NULL REFERENCES payment_provider_accounts(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL,
  display_order integer NOT NULL CHECK (display_order >= 0),
  rollout_basis_points integer NOT NULL DEFAULT 10000 CHECK (rollout_basis_points BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT payment_provider_configs_version_fk
    FOREIGN KEY (config_version_id, config_kind, config_version)
    REFERENCES config_versions(id, config_kind, version) ON DELETE RESTRICT,
  CONSTRAINT payment_provider_configs_version_account_unique UNIQUE (
    config_version_id,
    provider_account_id
  ),
  CONSTRAINT payment_provider_configs_id_version_account_unique UNIQUE (
    id,
    config_version_id,
    provider_account_id
  )
);

CREATE TABLE payment_provider_config_translations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  config_version_id uuid NOT NULL REFERENCES config_versions(id) ON DELETE RESTRICT,
  provider_config_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  locale supported_locale NOT NULL,
  source_hash sha256_hex NOT NULL,
  translated_from_source_hash sha256_hex NOT NULL,
  origin text NOT NULL CHECK (origin IN ('HUMAN', 'MACHINE', 'IMPORT')),
  import_batch_id uuid,
  editor_id uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  edited_at timestamptz NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  customer_hint text NOT NULL CHECK (length(customer_hint) BETWEEN 1 AND 280),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT payment_provider_config_translations_parent_fk
    FOREIGN KEY (provider_config_id, config_version_id, provider_account_id)
    REFERENCES payment_provider_configs(id, config_version_id, provider_account_id) ON DELETE RESTRICT,
  CONSTRAINT payment_provider_config_translation_locale_unique UNIQUE (
    provider_config_id,
    locale
  )
);

CREATE TABLE payment_provider_config_translation_reviews (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  provider_config_translation_id uuid NOT NULL
    REFERENCES payment_provider_config_translations(id) ON DELETE RESTRICT,
  sequence positive_version NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')),
  submitted_at timestamptz,
  reviewer_id uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  reviewed_source_hash sha256_hex,
  reviewed_content_hash sha256_hex,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT payment_provider_config_translation_review_sequence_unique UNIQUE (
    provider_config_translation_id,
    sequence
  )
);

CREATE TABLE payment_route_rules (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  config_version_id uuid NOT NULL,
  provider_config_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  rule_key text NOT NULL CHECK (rule_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  rule_version positive_version NOT NULL,
  payment_method text NOT NULL CHECK (payment_method ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  enabled boolean NOT NULL,
  minimum_amount_minor minor_amount NOT NULL,
  maximum_amount_minor minor_amount NOT NULL,
  priority integer NOT NULL,
  rollout_basis_points integer NOT NULL DEFAULT 10000 CHECK (rollout_basis_points BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT payment_route_rules_provider_config_fk
    FOREIGN KEY (provider_config_id, config_version_id, provider_account_id)
    REFERENCES payment_provider_configs(id, config_version_id, provider_account_id) ON DELETE RESTRICT,
  CONSTRAINT payment_route_rules_amount_check CHECK (
    minimum_amount_minor <= maximum_amount_minor
  ),
  CONSTRAINT payment_route_rules_key_unique UNIQUE (config_version_id, rule_key),
  CONSTRAINT payment_route_rules_attempt_binding_unique UNIQUE (
    id,
    config_version_id,
    provider_account_id,
    payment_method,
    rule_version
  )
);

CREATE TABLE payment_route_rule_countries (
  payment_route_rule_id uuid NOT NULL REFERENCES payment_route_rules(id) ON DELETE RESTRICT,
  country country_code NOT NULL,
  PRIMARY KEY (payment_route_rule_id, country)
);

CREATE TABLE payment_route_rule_markets (
  payment_route_rule_id uuid NOT NULL REFERENCES payment_route_rules(id) ON DELETE RESTRICT,
  market market_code NOT NULL,
  PRIMARY KEY (payment_route_rule_id, market)
);

CREATE TABLE payment_route_rule_currencies (
  payment_route_rule_id uuid NOT NULL REFERENCES payment_route_rules(id) ON DELETE RESTRICT,
  currency currency_code NOT NULL,
  PRIMARY KEY (payment_route_rule_id, currency)
);

CREATE TABLE payment_route_rule_device_capabilities (
  payment_route_rule_id uuid NOT NULL REFERENCES payment_route_rules(id) ON DELETE RESTRICT,
  capability text NOT NULL CHECK (
    capability IN ('REDIRECT', 'PROVIDER_HOSTED_IFRAME', 'PROVIDER_COMPONENT', 'QR_CODE')
  ),
  PRIMARY KEY (payment_route_rule_id, capability)
);

CREATE TABLE payment_config_publications (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  config_version_id uuid NOT NULL REFERENCES config_versions(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('PUBLISH', 'ROLLBACK')),
  replaces_publication_id uuid REFERENCES payment_config_publications(id) ON DELETE RESTRICT,
  manifest_hash sha256_hex NOT NULL,
  published_by uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL REFERENCES audit_logs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT payment_config_publications_replaces_unique UNIQUE (replaces_publication_id),
  CONSTRAINT payment_config_publications_rollback_check CHECK (
    action = 'PUBLISH' OR replaces_publication_id IS NOT NULL
  )
);

CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  order_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('TEST', 'LIVE')),
  config_version_id uuid NOT NULL,
  config_version positive_version NOT NULL,
  route_rule_id uuid NOT NULL,
  rule_version positive_version NOT NULL,
  payment_method text NOT NULL CHECK (payment_method ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  status text NOT NULL CHECK (
    status IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'UNKNOWN')
  ),
  amount_minor minor_amount NOT NULL,
  currency currency_code NOT NULL,
  requested_locale supported_locale NOT NULL,
  provider_locale text NOT NULL CHECK (length(provider_locale) BETWEEN 1 AND 35),
  provider_locale_fallback_used boolean NOT NULL,
  merchant_reference text NOT NULL CHECK (merchant_reference ~ '^[0-9a-f-]{36}$'),
  provider_idempotency_key text NOT NULL CHECK (provider_idempotency_key ~ '^[0-9a-f-]{36}$'),
  external_reference opaque_provider_reference,
  provider_call_started boolean NOT NULL DEFAULT false,
  action_type text CHECK (
    action_type IS NULL OR action_type IN (
      'REDIRECT', 'PROVIDER_HOSTED_IFRAME', 'PROVIDER_COMPONENT', 'QR_CODE', 'WAIT'
    )
  ),
  action_ciphertext ciphertext_bytes,
  action_encrypted_data_key bytea CHECK (
    action_encrypted_data_key IS NULL OR octet_length(action_encrypted_data_key) >= 16
  ),
  action_key_version positive_version,
  action_expires_at finite_timestamptz,
  action_poll_after_ms integer CHECK (
    action_poll_after_ms IS NULL OR action_poll_after_ms BETWEEN 500 AND 60000
  ),
  return_state_digest bytea NOT NULL CHECK (octet_length(return_state_digest) >= 32),
  return_state_expires_at finite_timestamptz NOT NULL,
  status_evidence_kind text NOT NULL CHECK (
    status_evidence_kind IN (
      'ATTEMPT_CREATED', 'CREATE_RESULT', 'NETWORK_UNCERTAINTY',
      'VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE',
      'AUDITED_BUSINESS_CANCEL', 'SAFE_EXPIRY'
    )
  ),
  provider_event_id uuid,
  evidence_audit_log_id uuid REFERENCES audit_logs(id) ON DELETE RESTRICT,
  evidence_reason_code text CHECK (
    evidence_reason_code IS NULL OR evidence_reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  refund_occupied_minor minor_amount NOT NULL DEFAULT 0,
  version positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  succeeded_at timestamptz,
  terminated_at timestamptz,
  CONSTRAINT payment_attempts_order_amount_fk
    FOREIGN KEY (order_id, currency, amount_minor)
    REFERENCES orders(id, currency, total_amount_minor) ON DELETE RESTRICT,
  CONSTRAINT payment_attempts_provider_account_environment_fk
    FOREIGN KEY (provider_account_id, environment)
    REFERENCES payment_provider_accounts(id, environment) ON DELETE RESTRICT,
  CONSTRAINT payment_attempts_route_binding_fk
    FOREIGN KEY (
      route_rule_id,
      config_version_id,
      provider_account_id,
      payment_method,
      rule_version
    )
    REFERENCES payment_route_rules(
      id,
      config_version_id,
      provider_account_id,
      payment_method,
      rule_version
    ) ON DELETE RESTRICT,
  CONSTRAINT payment_attempts_id_order_unique UNIQUE (id, order_id),
  CONSTRAINT payment_attempts_order_id_identity_unique UNIQUE (order_id, id),
  CONSTRAINT payment_attempts_capture_binding_unique UNIQUE (
    id,
    order_id,
    currency,
    amount_minor
  ),
  CONSTRAINT payment_attempts_merchant_reference_unique UNIQUE (
    provider_account_id,
    environment,
    merchant_reference
  ),
  CONSTRAINT payment_attempts_provider_idempotency_unique UNIQUE (
    provider_account_id,
    environment,
    provider_idempotency_key
  ),
  CONSTRAINT payment_attempts_external_reference_unique UNIQUE (
    provider_account_id,
    environment,
    external_reference
  ),
  CONSTRAINT payment_attempts_reference_identity_check CHECK (
    merchant_reference = id::text AND provider_idempotency_key = id::text
  ),
  CONSTRAINT payment_attempts_refund_capacity_check CHECK (
    refund_occupied_minor <= amount_minor
  ),
  CONSTRAINT payment_attempts_action_shape_check CHECK (
    (action_type IS NULL AND action_ciphertext IS NULL
      AND action_encrypted_data_key IS NULL AND action_key_version IS NULL
      AND action_expires_at IS NULL AND action_poll_after_ms IS NULL)
    OR (action_type = 'WAIT' AND action_ciphertext IS NULL
      AND action_encrypted_data_key IS NULL AND action_key_version IS NULL
      AND action_expires_at IS NULL AND action_poll_after_ms IS NOT NULL)
    OR (action_type IN ('REDIRECT', 'PROVIDER_HOSTED_IFRAME', 'PROVIDER_COMPONENT', 'QR_CODE')
      AND action_ciphertext IS NOT NULL AND action_encrypted_data_key IS NOT NULL
      AND action_key_version IS NOT NULL AND action_poll_after_ms IS NULL)
  ),
  CONSTRAINT payment_attempts_status_action_check CHECK (
    (status = 'REQUIRES_ACTION' AND action_type IN (
      'REDIRECT', 'PROVIDER_HOSTED_IFRAME', 'PROVIDER_COMPONENT', 'QR_CODE'
    ))
    OR (status = 'PROCESSING' AND (action_type IS NULL OR action_type = 'WAIT'))
    OR (status NOT IN ('REQUIRES_ACTION', 'PROCESSING') AND action_type IS NULL)
  ),
  CONSTRAINT payment_attempts_status_time_check CHECK (
    (status = 'SUCCEEDED' AND succeeded_at IS NOT NULL AND terminated_at IS NULL)
    OR (status IN ('FAILED', 'CANCELED', 'EXPIRED') AND succeeded_at IS NULL AND terminated_at IS NOT NULL)
    OR (status IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'UNKNOWN')
      AND succeeded_at IS NULL AND terminated_at IS NULL)
  ),
  CONSTRAINT payment_attempts_time_check CHECK (
    updated_at >= created_at
    AND return_state_expires_at > created_at
    AND (succeeded_at IS NULL OR succeeded_at >= created_at)
    AND (terminated_at IS NULL OR terminated_at >= created_at)
  )
);

CREATE UNIQUE INDEX payment_attempts_one_nonterminal_or_succeeded_per_order_idx
  ON payment_attempts (order_id)
  WHERE status IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED');

CREATE INDEX payment_attempts_reconciliation_idx
  ON payment_attempts (updated_at)
  WHERE status = 'UNKNOWN';

ALTER TABLE orders
  ADD CONSTRAINT orders_current_payment_attempt_owner_fk
    FOREIGN KEY (id, current_payment_attempt_id)
    REFERENCES payment_attempts(order_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE payment_attempts
  ADD CONSTRAINT payment_attempts_provider_capture_binding_unique UNIQUE (
    id,
    order_id,
    currency,
    amount_minor,
    provider_account_id,
    environment
  ),
  ADD CONSTRAINT payment_attempts_provider_order_binding_unique UNIQUE (
    id,
    order_id,
    provider_account_id,
    environment
  );

-- Raw webhook bodies remain encrypted in a separately purgeable envelope. The
-- deduplicating inbox record itself is immutable.
CREATE TABLE webhook_payloads (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  payload_ciphertext ciphertext_bytes,
  encrypted_data_key bytea CHECK (
    encrypted_data_key IS NULL OR octet_length(encrypted_data_key) >= 16
  ),
  encryption_key_version positive_version,
  payload_sha256 sha256_hex NOT NULL,
  status text NOT NULL CHECK (status IN ('RETAINED', 'PURGED')),
  retention_expires_at finite_timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  purged_at timestamptz,
  CONSTRAINT webhook_payloads_id_hash_unique UNIQUE (id, payload_sha256),
  CONSTRAINT webhook_payloads_retention_check CHECK (
    isfinite(created_at)
    AND isfinite(retention_expires_at)
    AND retention_expires_at > created_at
    AND retention_expires_at <= created_at + interval '7 days'
    AND (purged_at IS NULL OR isfinite(purged_at))
  ),
  CONSTRAINT webhook_payloads_retention_state_check CHECK (
    (status = 'RETAINED' AND payload_ciphertext IS NOT NULL
      AND encrypted_data_key IS NOT NULL AND encryption_key_version IS NOT NULL
      AND purged_at IS NULL)
    OR (status = 'PURGED' AND payload_ciphertext IS NULL
      AND encrypted_data_key IS NULL AND encryption_key_version IS NULL
      AND purged_at IS NOT NULL AND purged_at >= created_at)
  )
);

CREATE TABLE webhook_inbox (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  provider_account_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('TEST', 'LIVE')),
  endpoint_id uuid NOT NULL,
  provider_event_id opaque_provider_reference NOT NULL,
  webhook_payload_id uuid NOT NULL UNIQUE,
  payload_sha256 sha256_hex NOT NULL,
  signature_verified boolean NOT NULL CHECK (signature_verified),
  verification_key_reference_hash sha256_hex NOT NULL,
  signature_timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT webhook_inbox_endpoint_binding_fk
    FOREIGN KEY (
      endpoint_id,
      provider_account_id,
      environment,
      verification_key_reference_hash
    )
    REFERENCES payment_webhook_endpoints(
      id,
      provider_account_id,
      environment,
      verification_key_reference_hash
    ) ON DELETE RESTRICT,
  CONSTRAINT webhook_inbox_payload_hash_fk
    FOREIGN KEY (webhook_payload_id, payload_sha256)
    REFERENCES webhook_payloads(id, payload_sha256) ON DELETE RESTRICT,
  CONSTRAINT webhook_inbox_provider_event_unique UNIQUE (
    provider_account_id,
    environment,
    provider_event_id
  ),
  CONSTRAINT webhook_inbox_evidence_binding_unique UNIQUE (
    id,
    provider_account_id,
    environment,
    provider_event_id
  ),
  CONSTRAINT webhook_inbox_time_check CHECK (
    isfinite(signature_timestamp)
    AND isfinite(received_at)
    AND signature_timestamp BETWEEN received_at - interval '10 minutes'
      AND received_at + interval '5 minutes'
  )
);

CREATE TABLE provider_events (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  provider_account_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('TEST', 'LIVE')),
  provider_event_id opaque_provider_reference NOT NULL,
  evidence_kind text NOT NULL CHECK (
    evidence_kind IN ('VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE')
  ),
  webhook_inbox_id uuid,
  reconcile_audit_log_id uuid REFERENCES audit_logs(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (
    event_type IN ('PAYMENT_STATUS', 'REFUND_STATUS', 'DISPUTE_STATUS')
  ),
  normalized_status text NOT NULL CHECK (
    normalized_status IN (
      'CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED',
      'CANCELED', 'EXPIRED', 'UNKNOWN', 'REQUESTED', 'SUBMITTING',
      'NONE', 'OPEN', 'WON', 'LOST'
    )
  ),
  external_payment_reference opaque_provider_reference NOT NULL,
  provider_refund_reference opaque_provider_reference,
  provider_dispute_reference opaque_provider_reference,
  provider_transaction_type text CHECK (
    provider_transaction_type IS NULL
    OR provider_transaction_type IN (
      'AUTHORIZATION', 'CAPTURE', 'VOID', 'REFUND', 'CHARGEBACK', 'ADJUSTMENT'
    )
  ),
  provider_transaction_reference opaque_provider_reference,
  amount_minor minor_amount NOT NULL,
  currency currency_code NOT NULL,
  occurred_at timestamptz NOT NULL,
  normalized_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT provider_events_account_environment_fk
    FOREIGN KEY (provider_account_id, environment)
    REFERENCES payment_provider_accounts(id, environment) ON DELETE RESTRICT,
  CONSTRAINT provider_events_webhook_evidence_fk
    FOREIGN KEY (webhook_inbox_id, provider_account_id, environment, provider_event_id)
    REFERENCES webhook_inbox(id, provider_account_id, environment, provider_event_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT provider_events_provider_event_unique UNIQUE (
    provider_account_id,
    environment,
    provider_event_id
  ),
  CONSTRAINT provider_events_id_binding_unique UNIQUE (
    id,
    provider_account_id,
    environment,
    provider_event_id
  ),
  CONSTRAINT provider_events_transaction_reference_unique UNIQUE (
    provider_account_id,
    environment,
    provider_transaction_type,
    provider_transaction_reference
  ),
  CONSTRAINT provider_events_transaction_shape_check CHECK (
    (provider_transaction_type IS NULL AND provider_transaction_reference IS NULL)
    OR (provider_transaction_type IS NOT NULL AND provider_transaction_reference IS NOT NULL)
  ),
  CONSTRAINT provider_events_evidence_shape_check CHECK (
    (evidence_kind = 'VERIFIED_WEBHOOK'
      AND webhook_inbox_id IS NOT NULL AND reconcile_audit_log_id IS NULL)
    OR (evidence_kind = 'AUTHENTICATED_RECONCILE'
      AND webhook_inbox_id IS NULL AND reconcile_audit_log_id IS NOT NULL)
  ),
  CONSTRAINT provider_events_type_shape_check CHECK (
    (event_type = 'PAYMENT_STATUS'
      AND normalized_status IN (
        'CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED',
        'CANCELED', 'EXPIRED', 'UNKNOWN'
      )
      AND provider_refund_reference IS NULL AND provider_dispute_reference IS NULL)
    OR (event_type = 'REFUND_STATUS'
      AND normalized_status IN ('REQUESTED', 'SUBMITTING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN')
      AND provider_refund_reference IS NOT NULL AND provider_dispute_reference IS NULL)
    OR (event_type = 'DISPUTE_STATUS'
      AND normalized_status IN ('OPEN', 'WON', 'LOST')
      AND provider_refund_reference IS NULL AND provider_dispute_reference IS NOT NULL)
  ),
  CONSTRAINT provider_events_time_check CHECK (normalized_at >= occurred_at)
);

CREATE TABLE provider_event_associations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  provider_event_id uuid NOT NULL REFERENCES provider_events(id) ON DELETE RESTRICT,
  association_status text NOT NULL CHECK (association_status IN ('UNMATCHED', 'MATCHED')),
  payment_attempt_id uuid REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT provider_event_associations_status_unique UNIQUE (
    provider_event_id,
    association_status
  ),
  CONSTRAINT provider_event_associations_shape_check CHECK (
    (association_status = 'UNMATCHED' AND payment_attempt_id IS NULL)
    OR (association_status = 'MATCHED' AND payment_attempt_id IS NOT NULL)
  )
);

ALTER TABLE payment_attempts
  ADD CONSTRAINT payment_attempts_provider_event_fk
    FOREIGN KEY (provider_event_id) REFERENCES provider_events(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE order_events
  ADD CONSTRAINT order_events_from_payment_attempt_owner_fk
    FOREIGN KEY (from_payment_attempt_id, order_id)
    REFERENCES payment_attempts(id, order_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT order_events_to_payment_attempt_owner_fk
    FOREIGN KEY (to_payment_attempt_id, order_id)
    REFERENCES payment_attempts(id, order_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT order_events_provider_event_fk
    FOREIGN KEY (provider_event_id) REFERENCES provider_events(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  payment_attempt_id uuid NOT NULL REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  transaction_type text NOT NULL CHECK (
    transaction_type IN ('AUTHORIZATION', 'CAPTURE', 'VOID', 'REFUND', 'CHARGEBACK', 'ADJUSTMENT')
  ),
  provider_transaction_reference opaque_provider_reference NOT NULL,
  amount_minor minor_amount NOT NULL,
  currency currency_code NOT NULL,
  evidence_kind text NOT NULL CHECK (
    evidence_kind IN ('VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE')
  ),
  provider_event_id uuid REFERENCES provider_events(id) ON DELETE RESTRICT,
  reconcile_audit_log_id uuid REFERENCES audit_logs(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT payment_transactions_provider_reference_unique UNIQUE (
    payment_attempt_id,
    transaction_type,
    provider_transaction_reference
  ),
  CONSTRAINT payment_transactions_provider_event_type_unique UNIQUE (
    provider_event_id,
    transaction_type
  ),
  CONSTRAINT payment_transactions_evidence_shape_check CHECK (
    (evidence_kind = 'VERIFIED_WEBHOOK'
      AND provider_event_id IS NOT NULL AND reconcile_audit_log_id IS NULL)
    OR (evidence_kind = 'AUTHENTICATED_RECONCILE'
      AND provider_event_id IS NOT NULL AND reconcile_audit_log_id IS NOT NULL)
  ),
  CONSTRAINT payment_transactions_time_check CHECK (recorded_at >= occurred_at)
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  order_id uuid NOT NULL,
  payment_attempt_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('TEST', 'LIVE')),
  provider_reference opaque_provider_reference NOT NULL,
  idempotency_key idempotency_key_value NOT NULL,
  requested_audit_log_id uuid NOT NULL REFERENCES audit_logs(id) ON DELETE RESTRICT,
  captured_currency currency_code NOT NULL,
  currency currency_code NOT NULL,
  captured_amount_minor minor_amount NOT NULL,
  requested_amount_minor minor_amount NOT NULL CHECK (requested_amount_minor > 0),
  processed_amount_minor minor_amount NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (
    status IN ('REQUESTED', 'SUBMITTING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN')
  ),
  status_evidence_kind text NOT NULL CHECK (
    status_evidence_kind IN (
      'REFUND_REQUESTED', 'SUBMIT_COMMAND', 'NETWORK_UNCERTAINTY',
      'VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE'
    )
  ),
  provider_event_id uuid REFERENCES provider_events(id) ON DELETE RESTRICT,
  evidence_audit_log_id uuid REFERENCES audit_logs(id) ON DELETE RESTRICT,
  version positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  completed_at timestamptz,
  CONSTRAINT refunds_capture_binding_fk
    FOREIGN KEY (
      payment_attempt_id,
      order_id,
      captured_currency,
      captured_amount_minor,
      provider_account_id,
      environment
    )
    REFERENCES payment_attempts(
      id,
      order_id,
      currency,
      amount_minor,
      provider_account_id,
      environment
    ) ON DELETE RESTRICT,
  CONSTRAINT refunds_id_order_unique UNIQUE (id, order_id),
  CONSTRAINT refunds_provider_reference_unique UNIQUE (
    provider_account_id,
    environment,
    provider_reference
  ),
  CONSTRAINT refunds_idempotency_unique UNIQUE (payment_attempt_id, idempotency_key),
  CONSTRAINT refunds_amount_check CHECK (
    currency = captured_currency
    AND requested_amount_minor <= captured_amount_minor
    AND processed_amount_minor <= requested_amount_minor
  ),
  CONSTRAINT refunds_status_amount_check CHECK (
    (status = 'SUCCEEDED' AND processed_amount_minor = requested_amount_minor
      AND completed_at IS NOT NULL)
    OR (status = 'FAILED' AND processed_amount_minor = 0 AND completed_at IS NOT NULL)
    OR (status IN ('REQUESTED', 'SUBMITTING', 'PROCESSING', 'UNKNOWN')
      AND processed_amount_minor = 0 AND completed_at IS NULL)
  ),
  CONSTRAINT refunds_time_check CHECK (
    updated_at >= created_at AND (completed_at IS NULL OR completed_at >= created_at)
  )
);

CREATE TABLE refund_items (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  refund_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_item_id uuid NOT NULL,
  amount_minor minor_amount NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT refund_items_refund_order_fk
    FOREIGN KEY (refund_id, order_id) REFERENCES refunds(id, order_id) ON DELETE RESTRICT,
  CONSTRAINT refund_items_order_item_fk
    FOREIGN KEY (order_item_id, order_id) REFERENCES order_items(id, order_id) ON DELETE RESTRICT,
  CONSTRAINT refund_items_refund_order_item_unique UNIQUE (refund_id, order_item_id)
);

CREATE TABLE disputes (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  order_id uuid NOT NULL,
  payment_attempt_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('TEST', 'LIVE')),
  provider_reference opaque_provider_reference NOT NULL,
  status text NOT NULL CHECK (status IN ('NONE', 'OPEN', 'WON', 'LOST')),
  amount_minor minor_amount NOT NULL,
  currency currency_code NOT NULL,
  status_evidence_kind text NOT NULL CHECK (
    status_evidence_kind IN ('DISPUTE_PLACEHOLDER', 'VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE')
  ),
  provider_event_id uuid REFERENCES provider_events(id) ON DELETE RESTRICT,
  evidence_audit_log_id uuid REFERENCES audit_logs(id) ON DELETE RESTRICT,
  version positive_version NOT NULL DEFAULT 1,
  opened_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT disputes_capture_binding_fk
    FOREIGN KEY (
      payment_attempt_id,
      order_id,
      provider_account_id,
      environment
    )
    REFERENCES payment_attempts(
      id,
      order_id,
      provider_account_id,
      environment
    ) ON DELETE RESTRICT,
  CONSTRAINT disputes_provider_reference_unique UNIQUE (
    provider_account_id,
    environment,
    provider_reference
  ),
  CONSTRAINT disputes_status_time_check CHECK (
    (status = 'NONE' AND opened_at IS NULL)
    OR (status IN ('OPEN', 'WON', 'LOST') AND opened_at IS NOT NULL)
  ),
  CONSTRAINT disputes_time_check CHECK (
    updated_at >= created_at AND (opened_at IS NULL OR opened_at >= created_at)
  )
);

CREATE TABLE payment_attempt_events (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  payment_attempt_id uuid NOT NULL REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  sequence positive_version NOT NULL,
  from_status text,
  to_status text NOT NULL CHECK (
    to_status IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'UNKNOWN')
  ),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  evidence_kind text NOT NULL,
  provider_event_id uuid REFERENCES provider_events(id) ON DELETE RESTRICT,
  audit_log_id uuid REFERENCES audit_logs(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT payment_attempt_events_sequence_unique UNIQUE (payment_attempt_id, sequence),
  CONSTRAINT payment_attempt_events_from_status_check CHECK (
    from_status IS NULL OR from_status IN (
      'CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'UNKNOWN'
    )
  )
);

CREATE TABLE refund_events (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  refund_id uuid NOT NULL REFERENCES refunds(id) ON DELETE RESTRICT,
  sequence positive_version NOT NULL,
  from_status text,
  to_status text NOT NULL CHECK (
    to_status IN ('REQUESTED', 'SUBMITTING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN')
  ),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  evidence_kind text NOT NULL,
  provider_event_id uuid REFERENCES provider_events(id) ON DELETE RESTRICT,
  audit_log_id uuid REFERENCES audit_logs(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT refund_events_sequence_unique UNIQUE (refund_id, sequence),
  CONSTRAINT refund_events_from_status_check CHECK (
    from_status IS NULL OR from_status IN (
      'REQUESTED', 'SUBMITTING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'
    )
  )
);

CREATE TABLE dispute_events (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  dispute_id uuid NOT NULL REFERENCES disputes(id) ON DELETE RESTRICT,
  sequence positive_version NOT NULL,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('NONE', 'OPEN', 'WON', 'LOST')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  evidence_kind text NOT NULL,
  provider_event_id uuid REFERENCES provider_events(id) ON DELETE RESTRICT,
  audit_log_id uuid REFERENCES audit_logs(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT dispute_events_sequence_unique UNIQUE (dispute_id, sequence),
  CONSTRAINT dispute_events_from_status_check CHECK (
    from_status IS NULL OR from_status IN ('NONE', 'OPEN', 'WON', 'LOST')
  )
);

CREATE TABLE webhook_processing_attempts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  webhook_inbox_id uuid NOT NULL REFERENCES webhook_inbox(id) ON DELETE RESTRICT,
  attempt_number positive_version NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'RETRYABLE_FAILURE', 'DEAD_LETTER')),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  CONSTRAINT webhook_processing_attempts_number_unique UNIQUE (
    webhook_inbox_id,
    attempt_number
  ),
  CONSTRAINT webhook_processing_attempts_outcome_error_shape_check CHECK (
    (outcome = 'SUCCEEDED' AND error_code IS NULL)
    OR (outcome IN ('RETRYABLE_FAILURE', 'DEAD_LETTER') AND error_code IS NOT NULL)
  ),
  CONSTRAINT webhook_processing_attempts_time_check CHECK (finished_at >= started_at)
);

CREATE TABLE webhook_effects (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  webhook_inbox_id uuid NOT NULL REFERENCES webhook_inbox(id) ON DELETE RESTRICT,
  effect_key text NOT NULL CHECK (effect_key ~ '^[A-Z][A-Z0-9_:-]{0,127}$'),
  subject_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT webhook_effects_once_unique UNIQUE (webhook_inbox_id, effect_key, subject_id)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  event_type text NOT NULL CHECK (
    event_type IN (
      'CART_ITEM_ADDED', 'CONTENT_PUBLICATION_CHANGED', 'PAYMENT_STATUS_CHANGED',
      'ORDER_PAYMENT_CONFIRMED', 'REFUND_STATUS_CHANGED', 'DISPUTE_STATUS_CHANGED',
      'FULFILLMENT_STATUS_CHANGED', 'NOTIFICATION_REQUESTED',
      'PAYMENT_CONFIG_PUBLISHED'
    )
  ),
  aggregate_type text NOT NULL CHECK (
    aggregate_type IN (
      'CART', 'CONTENT_PUBLICATION', 'ORDER', 'PAYMENT_ATTEMPT', 'REFUND',
      'DISPUTE', 'FULFILLMENT', 'NOTIFICATION_DELIVERY', 'PAYMENT_CONFIG'
    )
  ),
  aggregate_id uuid NOT NULL,
  aggregate_version positive_version NOT NULL,
  primary_subject_id uuid NOT NULL,
  secondary_subject_id uuid,
  locale supported_locale,
  market market_code,
  currency currency_code,
  idempotency_key idempotency_key_value NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid REFERENCES outbox_events(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  trace_id text CHECK (trace_id IS NULL OR trace_id ~ '^[0-9a-f]{32}$'),
  occurred_at timestamptz NOT NULL,
  available_at finite_timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT outbox_events_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT outbox_events_time_check CHECK (
    available_at >= occurred_at AND created_at >= occurred_at
  )
);

CREATE INDEX outbox_events_available_idx ON outbox_events (available_at, id);

-- Publication events deliberately allow multiple publication records to point at
-- the same immutable revision during rollback. Migration 0006 gives those
-- publication records their own publication-id uniqueness rule.
CREATE UNIQUE INDEX outbox_events_state_transition_unique_idx
  ON outbox_events (event_type, aggregate_type, aggregate_id, aggregate_version)
  WHERE event_type NOT IN ('CONTENT_PUBLICATION_CHANGED', 'PAYMENT_CONFIG_PUBLISHED', 'PRICE_BOOK_PUBLISHED');

CREATE TABLE outbox_dispatch_attempts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  outbox_event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE RESTRICT,
  consumer_key text NOT NULL CHECK (consumer_key ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  attempt_number positive_version NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'RETRYABLE_FAILURE', 'DEAD_LETTER')),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  CONSTRAINT outbox_dispatch_attempts_number_unique UNIQUE (
    outbox_event_id,
    consumer_key,
    attempt_number
  ),
  CONSTRAINT outbox_dispatch_attempts_outcome_error_shape_check CHECK (
    (outcome = 'SUCCEEDED' AND error_code IS NULL)
    OR (outcome IN ('RETRYABLE_FAILURE', 'DEAD_LETTER') AND error_code IS NOT NULL)
  ),
  CONSTRAINT outbox_dispatch_attempts_time_check CHECK (finished_at >= started_at)
);

CREATE UNIQUE INDEX outbox_dispatch_attempts_success_once_idx
  ON outbox_dispatch_attempts (outbox_event_id, consumer_key)
  WHERE outcome = 'SUCCEEDED';

CREATE TABLE outbox_effect_receipts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  outbox_event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE RESTRICT,
  consumer_key text NOT NULL CHECK (consumer_key ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  effect_key text NOT NULL CHECK (effect_key ~ '^[A-Z][A-Z0-9_:-]{0,127}$'),
  subject_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT outbox_effect_receipts_once_unique UNIQUE (
    outbox_event_id,
    consumer_key,
    effect_key,
    subject_id
  )
);

CREATE FUNCTION guard_payment_provider_account_health()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'new payment provider account must start at version 1'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'health_status' - 'version' - 'updated_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'health_status' - 'version' - 'updated_at')
     OR NEW.health_status = OLD.health_status
     OR NEW.version <> OLD.version + 1
     OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'payment provider health updates require one versioned transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_payment_provider_health_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  previous_event public.payment_provider_health_events%ROWTYPE;
BEGIN
  IF NEW.sequence > 1 THEN
    SELECT * INTO previous_event
      FROM public.payment_provider_health_events
      WHERE provider_account_id = NEW.provider_account_id
        AND sequence = NEW.sequence - 1;
    IF previous_event.id IS NULL OR NEW.from_status <> previous_event.to_status THEN
      RAISE EXCEPTION 'payment provider health event sequence is not contiguous'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION assert_payment_provider_health_head()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  account_id uuid := COALESCE(
    (to_jsonb(NEW) ->> 'provider_account_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid
  );
  matching_count integer;
BEGIN
  SELECT count(*) INTO matching_count
    FROM public.payment_provider_accounts account
    JOIN public.payment_provider_health_events event
      ON event.provider_account_id = account.id
      AND event.sequence = account.version
      AND event.to_status = account.health_status
    WHERE account.id = account_id;
  IF matching_count <> 1 THEN
    RAISE EXCEPTION 'payment provider health and append-only evidence diverge'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION guard_payment_config_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.config_kind <> 'PAYMENT_ROUTING' AND NEW.config_kind <> 'PAYMENT_ROUTING' THEN
    RETURN NEW;
  END IF;
  IF NEW.config_kind IS DISTINCT FROM OLD.config_kind THEN
    RAISE EXCEPTION 'config_kind cannot be changed into or out of PAYMENT_ROUTING'
      USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - 'lifecycle' - 'published_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'lifecycle' - 'published_at') THEN
    RAISE EXCEPTION 'payment config version identity is immutable; create a new version'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    NEW.lifecycle = OLD.lifecycle
    OR (OLD.lifecycle = 'DRAFT' AND NEW.lifecycle = 'VALIDATED')
    OR (OLD.lifecycle = 'VALIDATED' AND NEW.lifecycle = 'PUBLISHED')
    OR (OLD.lifecycle = 'PUBLISHED' AND NEW.lifecycle = 'SUPERSEDED')
    OR (OLD.lifecycle = 'SUPERSEDED' AND NEW.lifecycle = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'invalid payment config lifecycle transition: % -> %', OLD.lifecycle, NEW.lifecycle
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION assert_payment_provider_translation_package(target_provider_config_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  english_hash sha256_hex;
  translation_count integer;
  approved_count integer;
  lineage_count integer;
BEGIN
  SELECT source_hash INTO english_hash
    FROM payment_provider_config_translations
    WHERE provider_config_id = target_provider_config_id AND locale = 'en';

  IF english_hash IS NULL THEN
    RAISE EXCEPTION 'payment provider config publication requires an English translation'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*),
    count(*) FILTER (WHERE latest.status = 'APPROVED'),
    count(*) FILTER (WHERE translation.translated_from_source_hash = english_hash)
    INTO translation_count, approved_count, lineage_count
    FROM payment_provider_config_translations translation
    LEFT JOIN LATERAL (
      SELECT review.status
      FROM payment_provider_config_translation_reviews review
      WHERE review.provider_config_translation_id = translation.id
      ORDER BY review.sequence DESC
      LIMIT 1
    ) latest ON true
    WHERE translation.provider_config_id = target_provider_config_id;

  IF translation_count <> 7 OR approved_count <> 7 OR lineage_count <> 7 THEN
    RAISE EXCEPTION 'payment provider config publication requires seven approved current translations'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION validate_payment_config_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  provider_config record;
  enabled_provider_count integer;
  enabled_rule_count integer;
  rule_version_count integer;
  incomplete_rule_count integer;
BEGIN
  IF NEW.config_kind <> 'PAYMENT_ROUTING' OR NEW.lifecycle <> 'PUBLISHED'
     OR (TG_OP = 'UPDATE' AND OLD.lifecycle = NEW.lifecycle) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) FILTER (WHERE config.enabled),
         count(DISTINCT rule.rule_version) FILTER (WHERE rule.enabled),
         count(*) FILTER (WHERE rule.enabled)
    INTO enabled_provider_count, rule_version_count, enabled_rule_count
    FROM payment_provider_configs config
    LEFT JOIN payment_route_rules rule
      ON rule.config_version_id = config.config_version_id
      AND rule.provider_config_id = config.id
    WHERE config.config_version_id = NEW.id;

  IF enabled_provider_count = 0 OR enabled_rule_count = 0 OR rule_version_count <> 1 THEN
    RAISE EXCEPTION 'published payment config requires enabled providers and one non-empty rule-set version'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO incomplete_rule_count
    FROM payment_route_rules rule
    JOIN payment_provider_configs config ON config.id = rule.provider_config_id
    JOIN payment_provider_accounts account ON account.id = rule.provider_account_id
    JOIN merchant_entities merchant ON merchant.id = account.merchant_entity_id
    WHERE rule.config_version_id = NEW.id
      AND rule.enabled
      AND (
        NOT config.enabled
        OR account.status NOT IN ('INTERNAL', 'ACTIVE')
        OR account.health_status <> 'HEALTHY'
        OR merchant.status <> 'ACTIVE'
        OR NOT EXISTS (
          SELECT 1 FROM payment_route_rule_countries country
          WHERE country.payment_route_rule_id = rule.id
        )
        OR NOT EXISTS (
          SELECT 1 FROM payment_route_rule_markets market
          WHERE market.payment_route_rule_id = rule.id
        )
        OR NOT EXISTS (
          SELECT 1 FROM payment_route_rule_currencies currency
          WHERE currency.payment_route_rule_id = rule.id
        )
      );
  IF incomplete_rule_count <> 0 THEN
    RAISE EXCEPTION 'published payment routes require enabled healthy accounts and explicit country, market, and currency scopes'
      USING ERRCODE = '23514';
  END IF;

  FOR provider_config IN
    SELECT id FROM payment_provider_configs
    WHERE config_version_id = NEW.id AND enabled
  LOOP
    PERFORM assert_payment_provider_translation_package(provider_config.id);
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_payment_route_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  route_id uuid;
  parent_lifecycle text;
BEGIN
  route_id := COALESCE(
    (to_jsonb(NEW) ->> 'payment_route_rule_id')::uuid,
    (to_jsonb(OLD) ->> 'payment_route_rule_id')::uuid
  );
  SELECT config.lifecycle INTO parent_lifecycle
    FROM payment_route_rules rule
    JOIN config_versions config ON config.id = rule.config_version_id
    WHERE rule.id = route_id;
  IF parent_lifecycle IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'published payment route payload is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION validate_payment_config_publication_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_lifecycle text;
  replaced_config_version_id uuid;
BEGIN
  SELECT lifecycle INTO target_lifecycle
    FROM config_versions
    WHERE id = NEW.config_version_id AND config_kind = 'PAYMENT_ROUTING';
  IF target_lifecycle NOT IN ('PUBLISHED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'payment config publication must reference immutable published evidence'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.replaces_publication_id IS NOT NULL THEN
    SELECT config_version_id INTO replaced_config_version_id
      FROM payment_config_publications WHERE id = NEW.replaces_publication_id;
    IF replaced_config_version_id IS NULL OR replaced_config_version_id = NEW.config_version_id THEN
      RAISE EXCEPTION 'payment config replacement must reference a different prior publication'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_webhook_payload_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'webhook payload retention rows cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_at <> transaction_timestamp() THEN
      RAISE EXCEPTION 'webhook payload creation time must be server anchored'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'payload_ciphertext' - 'encrypted_data_key'
      - 'encryption_key_version' - 'purged_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'payload_ciphertext' - 'encrypted_data_key'
      - 'encryption_key_version' - 'purged_at') THEN
    RAISE EXCEPTION 'webhook payload identity and retention evidence are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (OLD.status = 'RETAINED' AND NEW.status = 'PURGED') THEN
    RAISE EXCEPTION 'webhook payloads only support RETAINED to PURGED'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.purged_at <> transaction_timestamp() THEN
    RAISE EXCEPTION 'webhook payload purge time must be server anchored'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_payment_webhook_endpoint_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  expected_audit_action text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'webhook endpoint lifecycle evidence cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE'
       OR NEW.overlap_started_at IS NOT NULL
       OR NEW.retired_at IS NOT NULL
       OR NEW.active_from <> transaction_timestamp()
       OR NEW.created_at <> transaction_timestamp() THEN
      RAISE EXCEPTION 'new webhook endpoint must start active'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.rotated_from_endpoint_id IS NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.payment_webhook_endpoints existing
        WHERE existing.provider_account_id = NEW.provider_account_id
          AND existing.environment = NEW.environment
      ) THEN
        RAISE EXCEPTION 'only the first webhook endpoint may omit a rotation predecessor'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NOT EXISTS (
        SELECT 1
        FROM public.payment_webhook_endpoints predecessor
        WHERE predecessor.id = NEW.rotated_from_endpoint_id
          AND predecessor.provider_account_id = NEW.provider_account_id
          AND predecessor.environment = NEW.environment
          AND predecessor.status = 'ROTATION_OVERLAP'
          AND predecessor.active_from <= NEW.active_from
          AND predecessor.retired_at > NEW.active_from
          AND predecessor.verification_key_reference_hash <> NEW.verification_key_reference_hash
          AND predecessor.verification_secret_ref <> NEW.verification_secret_ref
      ) THEN
        RAISE EXCEPTION 'rotated webhook endpoint requires an overlapping same-account predecessor with new key material'
          USING ERRCODE = '23514';
    END IF;
    expected_audit_action := 'PAYMENT_WEBHOOK_ENDPOINT_ACTIVATED';
  ELSIF NEW.status = OLD.status THEN
    IF NEW.overlap_started_at IS DISTINCT FROM OLD.overlap_started_at
       OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
       OR NEW.lifecycle_audit_log_id <> OLD.lifecycle_audit_log_id THEN
      RAISE EXCEPTION 'webhook endpoint lifecycle mutation requires a state transition'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  ELSIF OLD.status = 'ACTIVE' AND NEW.status IN ('ROTATION_OVERLAP', 'RETIRED') THEN
    IF NEW.retired_at IS NULL
       OR NOT isfinite(NEW.retired_at)
       OR (NEW.status = 'ROTATION_OVERLAP' AND (
         NEW.overlap_started_at IS NULL
         OR NOT isfinite(NEW.overlap_started_at)
         OR NEW.overlap_started_at <> transaction_timestamp()
         OR NEW.retired_at <= NEW.overlap_started_at
         OR NEW.retired_at > NEW.overlap_started_at + interval '24 hours'
       ))
       OR (NEW.status = 'RETIRED' AND NEW.overlap_started_at IS NOT NULL) THEN
      RAISE EXCEPTION 'webhook endpoint retirement window is invalid'
        USING ERRCODE = '23514';
    END IF;
    expected_audit_action := CASE NEW.status
      WHEN 'ROTATION_OVERLAP' THEN 'PAYMENT_WEBHOOK_ENDPOINT_ROTATION_STARTED'
      ELSE 'PAYMENT_WEBHOOK_ENDPOINT_RETIRED'
    END;
  ELSIF OLD.status = 'ROTATION_OVERLAP' AND NEW.status = 'RETIRED' THEN
    IF NEW.overlap_started_at IS DISTINCT FROM OLD.overlap_started_at
       OR NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
      RAISE EXCEPTION 'webhook rotation overlap deadline is immutable'
        USING ERRCODE = '55000';
    END IF;
    expected_audit_action := 'PAYMENT_WEBHOOK_ENDPOINT_RETIRED';
  ELSE
    RAISE EXCEPTION 'invalid webhook endpoint transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.audit_logs audit
    WHERE audit.id = NEW.lifecycle_audit_log_id
      AND audit.action = expected_audit_action
      AND audit.subject_type = 'PAYMENT_WEBHOOK_ENDPOINT'
      AND audit.subject_id = NEW.id
      AND audit.reason_code IS NOT NULL
      AND audit.request_id IS NOT NULL
      AND audit.correlation_id IS NOT NULL
      AND audit.outcome = 'SUCCEEDED'
      AND audit.created_at = transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'webhook endpoint lifecycle requires exact successful audit evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_webhook_inbox_endpoint_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.received_at <> transaction_timestamp() THEN
    RAISE EXCEPTION 'webhook receipt time must be server anchored'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.webhook_payloads payload
    WHERE payload.id = NEW.webhook_payload_id
      AND payload.status = 'RETAINED'
      AND payload.created_at = NEW.received_at
  ) THEN
    RAISE EXCEPTION 'webhook payload and receipt must share one server transaction'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_webhook_endpoints endpoint
    WHERE endpoint.id = NEW.endpoint_id
      AND endpoint.provider_account_id = NEW.provider_account_id
      AND endpoint.environment = NEW.environment
      AND endpoint.verification_key_reference_hash = NEW.verification_key_reference_hash
      AND endpoint.status IN ('ACTIVE', 'ROTATION_OVERLAP')
      AND endpoint.active_from <= NEW.received_at
      AND (
        (endpoint.status = 'ACTIVE' AND endpoint.retired_at IS NULL)
        OR (endpoint.status = 'ROTATION_OVERLAP'
          AND endpoint.overlap_started_at <= NEW.received_at
          AND endpoint.retired_at > NEW.received_at)
      )
  ) THEN
    RAISE EXCEPTION 'webhook endpoint is not active at receipt time'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_provider_event_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.evidence_kind = 'AUTHENTICATED_RECONCILE' AND NOT EXISTS (
    SELECT 1
    FROM audit_logs audit
    WHERE audit.id = NEW.reconcile_audit_log_id
      AND audit.action = 'PAYMENT_PROVIDER_RECONCILE'
      AND audit.subject_type = 'PAYMENT_PROVIDER_ACCOUNT'
      AND audit.subject_id = NEW.provider_account_id
      AND audit.outcome = 'SUCCEEDED'
      AND audit.request_id IS NOT NULL
      AND audit.correlation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'reconciled provider event requires matching authenticated audit evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider_transaction_type IS NOT NULL AND NOT (
    (NEW.provider_transaction_type = 'AUTHORIZATION'
      AND NEW.event_type = 'PAYMENT_STATUS'
      AND NEW.normalized_status IN ('PROCESSING', 'SUCCEEDED'))
    OR (NEW.provider_transaction_type = 'CAPTURE'
      AND NEW.event_type = 'PAYMENT_STATUS'
      AND NEW.normalized_status = 'SUCCEEDED')
    OR (NEW.provider_transaction_type = 'VOID'
      AND NEW.event_type = 'PAYMENT_STATUS'
      AND NEW.normalized_status = 'CANCELED')
    OR (NEW.provider_transaction_type = 'REFUND'
      AND NEW.event_type = 'REFUND_STATUS'
      AND NEW.normalized_status = 'SUCCEEDED')
    OR (NEW.provider_transaction_type = 'CHARGEBACK'
      AND NEW.event_type = 'DISPUTE_STATUS'
      AND NEW.normalized_status IN ('OPEN', 'LOST'))
    OR (NEW.provider_transaction_type = 'ADJUSTMENT'
      AND NEW.event_type = 'PAYMENT_STATUS'
      AND NEW.normalized_status = 'SUCCEEDED'
      AND NEW.evidence_kind = 'AUTHENTICATED_RECONCILE')
  ) THEN
    RAISE EXCEPTION 'provider transaction type does not match normalized evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_provider_event_association()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  event_row provider_events%ROWTYPE;
  attempt_row payment_attempts%ROWTYPE;
BEGIN
  SELECT * INTO event_row FROM provider_events WHERE id = NEW.provider_event_id;
  IF event_row.id IS NULL THEN
    RAISE EXCEPTION 'provider event association references missing event'
      USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM provider_event_associations
    WHERE provider_event_id = NEW.provider_event_id AND association_status = 'MATCHED'
  ) THEN
    RAISE EXCEPTION 'matched provider event association is terminal'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.association_status = 'MATCHED' THEN
    SELECT * INTO attempt_row FROM payment_attempts WHERE id = NEW.payment_attempt_id;
    IF attempt_row.id IS NULL
       OR attempt_row.provider_account_id <> event_row.provider_account_id
       OR attempt_row.environment <> event_row.environment
       OR attempt_row.currency <> event_row.currency
       OR (attempt_row.external_reference IS NOT NULL
          AND attempt_row.external_reference <> event_row.external_payment_reference)
       OR (event_row.event_type = 'PAYMENT_STATUS'
          AND attempt_row.amount_minor <> event_row.amount_minor) THEN
      RAISE EXCEPTION 'provider event does not match the persisted payment attempt'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_payment_transaction_evidence()
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

CREATE FUNCTION validate_order_provider_cancel_evidence()
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

CREATE FUNCTION assert_provider_transaction_ledger()
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

CREATE FUNCTION assert_provider_event_association()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  association_count integer;
BEGIN
  SELECT count(*) INTO association_count
    FROM provider_event_associations WHERE provider_event_id = NEW.id;
  IF association_count NOT IN (1, 2) THEN
    RAISE EXCEPTION 'provider event requires one initial association and at most one later match'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION validate_payment_attempt_mutation()
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

CREATE FUNCTION assert_payment_attempt_evidence_and_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  history_count integer;
  evidence_count integer;
  expected_from text;
BEGIN
  expected_from := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
  SELECT count(*) INTO history_count
    FROM payment_attempt_events event
    WHERE event.payment_attempt_id = NEW.id
      AND event.sequence = NEW.version
      AND event.from_status IS NOT DISTINCT FROM expected_from
      AND event.to_status = NEW.status
      AND event.evidence_kind = NEW.status_evidence_kind
      AND event.provider_event_id IS NOT DISTINCT FROM NEW.provider_event_id
      AND event.audit_log_id IS NOT DISTINCT FROM NEW.evidence_audit_log_id;
  IF history_count <> 1 THEN
    RAISE EXCEPTION 'payment attempt transition requires one matching append-only event'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status_evidence_kind IN ('VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE') THEN
    SELECT count(*) INTO evidence_count
      FROM provider_events event
      JOIN provider_event_associations association
        ON association.provider_event_id = event.id
        AND association.association_status = 'MATCHED'
        AND association.payment_attempt_id = NEW.id
      WHERE event.id = NEW.provider_event_id
        AND event.evidence_kind = NEW.status_evidence_kind
        AND event.reconcile_audit_log_id IS NOT DISTINCT FROM NEW.evidence_audit_log_id
        AND event.event_type = 'PAYMENT_STATUS'
        AND event.normalized_status = NEW.status
        AND event.provider_account_id = NEW.provider_account_id
        AND event.environment = NEW.environment
        AND event.external_payment_reference = NEW.external_reference
        AND event.amount_minor = NEW.amount_minor
        AND event.currency = NEW.currency;
    IF evidence_count <> 1 THEN
      RAISE EXCEPTION 'payment transition lacks matching normalized provider evidence'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status_evidence_kind = 'AUDITED_BUSINESS_CANCEL' THEN
    SELECT count(*) INTO evidence_count
      FROM audit_logs audit
      WHERE audit.id = NEW.evidence_audit_log_id
        AND audit.subject_type = 'PAYMENT_ATTEMPT'
        AND audit.subject_id = NEW.id
        AND audit.outcome = 'SUCCEEDED';
    IF evidence_count <> 1 THEN
      RAISE EXCEPTION 'payment transition lacks matching authenticated audit evidence'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_payment_success_aggregate_plan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  aggregate_count integer;
  tracked_item_count integer;
  current_reservation_count integer;
  invalid_reservation_count integer;
  extraneous_reservation_count integer;
  unavailable_reservation_count integer;
  fulfillment_count integer;
  invalid_fulfillment_count integer;
BEGIN
  IF NEW.status <> 'SUCCEEDED' OR (TG_OP = 'UPDATE' AND OLD.status = 'SUCCEEDED') THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO aggregate_count
    FROM orders order_row
    JOIN carts cart ON cart.id = order_row.cart_id
    JOIN order_events order_event
      ON order_event.order_id = order_row.id
      AND order_event.sequence = order_row.version
    WHERE order_row.id = NEW.order_id
      AND order_row.current_payment_attempt_id = NEW.id
      AND order_row.order_status = 'OPEN'
      AND order_row.payment_status = 'PAID'
      AND cart.locked_order_id = order_row.id
      AND cart.status = 'CONVERTED'
      AND (
        (order_event.from_order_status = 'PENDING_PAYMENT'
          AND order_event.event_type = 'PAYMENT_STATUS_CHANGED')
        OR (order_event.from_order_status = 'CANCELED'
          AND order_event.event_type = 'LATE_PAYMENT_RECOVERED')
      )
      AND order_event.authority_kind = 'PROVIDER_EVIDENCE'
      AND order_event.provider_event_id = NEW.provider_event_id
      AND order_event.to_payment_attempt_id = NEW.id
      AND order_event.to_order_status = 'OPEN'
      AND order_event.to_payment_status = 'PAID';

  SELECT
    count(*) FILTER (WHERE variant.inventory_policy = 'TRACKED'),
    count(current_reservation.id) FILTER (WHERE variant.inventory_policy = 'TRACKED'),
    count(*) FILTER (
      WHERE (variant.inventory_policy = 'TRACKED' AND (
        current_reservation.id IS NULL
        OR current_reservation.gift_variant_id <> item.gift_variant_id
        OR current_reservation.quantity <> item.quantity
        OR current_reservation.checkout_session_id <> source_order.checkout_session_id
        OR current_reservation.checkout_quote_id <> source_order.checkout_quote_id
        OR current_reservation.status = 'ACTIVE'
        OR (OLD.status = 'UNKNOWN'
          AND current_reservation.status NOT IN ('COMMITTED', 'RELEASED', 'EXPIRED'))
        OR (OLD.status <> 'UNKNOWN' AND current_reservation.status <> 'COMMITTED')
      ))
      OR (variant.inventory_policy <> 'TRACKED' AND current_reservation.id IS NOT NULL)
    ),
    count(*) FILTER (WHERE current_reservation.status IN ('RELEASED', 'EXPIRED'))
    INTO tracked_item_count, current_reservation_count,
      invalid_reservation_count, unavailable_reservation_count
    FROM public.order_items item
    JOIN public.orders source_order ON source_order.id = item.order_id
    JOIN public.gift_variants variant ON variant.id = item.gift_variant_id
    LEFT JOIN LATERAL (
      SELECT reservation.*
      FROM public.inventory_reservations reservation
      WHERE reservation.locked_order_id = item.order_id
        AND reservation.cart_item_id = item.cart_item_id
      ORDER BY reservation.created_at DESC, reservation.id DESC
      LIMIT 1
    ) current_reservation ON true
    WHERE item.order_id = NEW.order_id;

  SELECT count(*) INTO extraneous_reservation_count
  FROM public.inventory_reservations reservation
  WHERE reservation.locked_order_id = NEW.order_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.order_items item
      JOIN public.gift_variants variant ON variant.id = item.gift_variant_id
      WHERE item.order_id = NEW.order_id
        AND item.cart_item_id = reservation.cart_item_id
        AND variant.inventory_policy = 'TRACKED'
    );

  IF current_reservation_count <> tracked_item_count
     OR invalid_reservation_count <> 0
     OR extraneous_reservation_count <> 0 THEN
    RAISE EXCEPTION 'tracked order-item reservation coverage is incomplete'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*),
    count(*) FILTER (WHERE status <>
      CASE WHEN unavailable_reservation_count > 0 THEN 'ON_HOLD' ELSE 'PENDING' END)
    INTO fulfillment_count, invalid_fulfillment_count
    FROM fulfillments
    WHERE order_id = NEW.order_id;

  IF aggregate_count <> 1
     OR fulfillment_count = 0
     OR invalid_fulfillment_count <> 0
     OR EXISTS (
       SELECT 1 FROM payment_attempts competing
       WHERE competing.order_id = NEW.order_id
         AND competing.id <> NEW.id
         AND competing.status IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED')
     )
     OR (OLD.status = 'UNKNOWN' AND NOT EXISTS (
       SELECT 1
       FROM audit_logs audit
       JOIN payment_attempt_events payment_event
         ON payment_event.payment_attempt_id = NEW.id
        AND payment_event.sequence = NEW.version
        AND payment_event.from_status = 'UNKNOWN'
        AND payment_event.to_status = 'SUCCEEDED'
        AND payment_event.provider_event_id = NEW.provider_event_id
       JOIN orders audit_order ON audit_order.id = NEW.order_id
       JOIN order_events audit_order_event
         ON audit_order_event.order_id = audit_order.id
        AND audit_order_event.sequence = audit_order.version
        AND audit_order_event.provider_event_id = NEW.provider_event_id
       WHERE audit.action = 'LATE_PAYMENT_SUCCESS_APPLIED'
         AND audit.subject_type = 'PAYMENT_ATTEMPT'
         AND audit.subject_id = NEW.id
         AND audit.reason_code = CASE WHEN unavailable_reservation_count > 0
           THEN 'LATE_PAYMENT_INVENTORY_UNAVAILABLE'
           ELSE 'PAYMENT_SUCCESS_RECONCILED'
         END
         AND audit.outcome = 'SUCCEEDED'
         AND (
           (audit.actor_type = 'ADMIN' AND audit.actor_id IS NOT NULL
             AND audit.task_name IS NULL)
           OR (audit.actor_type = 'SYSTEM' AND audit.actor_id IS NULL
             AND audit.task_name IS NOT NULL)
         )
         AND audit.request_id = payment_event.request_id
         AND audit.correlation_id = payment_event.correlation_id
         AND audit.request_id = audit_order_event.request_id
         AND audit.correlation_id = audit_order_event.correlation_id
         AND audit.created_at = payment_event.occurred_at
         AND audit.created_at = audit_order_event.occurred_at
         AND audit.created_at = transaction_timestamp()
         AND payment_event.occurred_at = transaction_timestamp()
         AND audit_order_event.occurred_at = transaction_timestamp()
     )) THEN
    RAISE EXCEPTION 'payment success aggregate plan is incomplete'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION guard_nonterminal_payment_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_order_id uuid;
  releasing_lock boolean;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    target_order_id := OLD.id;
    releasing_lock := OLD.order_status = 'PENDING_PAYMENT' AND NEW.order_status = 'CANCELED';
  ELSIF TG_TABLE_NAME = 'carts' THEN
    target_order_id := OLD.locked_order_id;
    releasing_lock := OLD.status = 'LOCKED' AND NEW.status = 'EXPIRED';
  ELSE
    target_order_id := OLD.locked_order_id;
    releasing_lock := OLD.status = 'ACTIVE' AND NEW.status IN ('RELEASED', 'EXPIRED');
  END IF;

  IF NOT releasing_lock OR target_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM orders WHERE id = target_order_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM payment_attempts attempt
    WHERE attempt.order_id = target_order_id
      AND attempt.status IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING')
  ) THEN
    RAISE EXCEPTION 'nonterminal payment keeps cart and reservation locked'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM payment_attempts attempt
    WHERE attempt.order_id = target_order_id
      AND attempt.status = 'UNKNOWN'
  ) THEN
    IF TG_TABLE_NAME = 'inventory_reservations' THEN
      IF NEW.status = 'EXPIRED' THEN
        IF statement_timestamp() < OLD.expires_at THEN
          RAISE EXCEPTION 'UNKNOWN reservation expiry requires its elapsed hold window'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;
    END IF;

    RAISE EXCEPTION 'nonterminal payment keeps cart and reservation locked'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'inventory_reservations' AND EXISTS (
    SELECT 1 FROM payment_attempts attempt
    WHERE attempt.order_id = target_order_id
      AND attempt.status = 'SUCCEEDED'
  ) THEN
    RAISE EXCEPTION 'succeeded payment cannot release or expire reservations'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_refund_mutation_and_capacity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  old_contribution minor_amount := 0;
  new_contribution minor_amount := 0;
  capacity_delta bigint;
  updated_attempt_id uuid;
  order_current_attempt_id uuid;
  order_payment_status text;
  transition_allowed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'REQUESTED' OR NEW.version <> 1
       OR NEW.status_evidence_kind <> 'REFUND_REQUESTED'
       OR NEW.provider_event_id IS NOT NULL OR NEW.evidence_audit_log_id IS NOT NULL THEN
      RAISE EXCEPTION 'new refund must start as REQUESTED without provider evidence'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.audit_logs audit
      WHERE audit.id = NEW.requested_audit_log_id
        AND audit.action = 'REFUND_REQUESTED'
        AND audit.subject_type = 'REFUND'
        AND audit.subject_id = NEW.id
        AND audit.outcome = 'SUCCEEDED'
        AND audit.reason_code IS NOT NULL
        AND audit.request_id IS NOT NULL
        AND audit.correlation_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'refund request requires matching audit evidence'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - 'status' - 'processed_amount_minor' - 'status_evidence_kind'
        - 'provider_event_id' - 'evidence_audit_log_id' - 'version'
        - 'updated_at' - 'completed_at') IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'processed_amount_minor' - 'status_evidence_kind'
        - 'provider_event_id' - 'evidence_audit_log_id' - 'version'
        - 'updated_at' - 'completed_at') THEN
      RAISE EXCEPTION 'refund identity, allocation amount, capture, and provider reference are immutable'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.status IN ('SUCCEEDED', 'FAILED') THEN
      RAISE EXCEPTION 'terminal refunds are immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at THEN
      RAISE EXCEPTION 'refund transition requires one version increment and a later timestamp'
        USING ERRCODE = '23514';
    END IF;
    transition_allowed := CASE OLD.status
      WHEN 'REQUESTED' THEN NEW.status = 'SUBMITTING'
      WHEN 'SUBMITTING' THEN NEW.status IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN')
      WHEN 'PROCESSING' THEN NEW.status IN ('SUCCEEDED', 'FAILED', 'UNKNOWN')
      WHEN 'UNKNOWN' THEN NEW.status IN ('PROCESSING', 'SUCCEEDED', 'FAILED')
      ELSE false
    END;
    IF NEW.status = OLD.status OR NOT transition_allowed THEN
      RAISE EXCEPTION 'invalid refund transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'REQUESTED' AND NEW.status = 'SUBMITTING'
       AND NEW.status_evidence_kind <> 'SUBMIT_COMMAND' THEN
      RAISE EXCEPTION 'refund submission requires SUBMIT_COMMAND evidence'
        USING ERRCODE = '23514';
    ELSIF NEW.status = 'UNKNOWN'
       AND NEW.status_evidence_kind <> 'NETWORK_UNCERTAINTY' THEN
      RAISE EXCEPTION 'UNKNOWN refund requires network uncertainty evidence'
        USING ERRCODE = '23514';
    ELSIF NOT (OLD.status = 'REQUESTED' AND NEW.status = 'SUBMITTING')
       AND NEW.status <> 'UNKNOWN'
       AND NEW.status_evidence_kind NOT IN ('VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE') THEN
      RAISE EXCEPTION 'refund provider result requires trusted provider evidence'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status_evidence_kind IN ('VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE')
     AND NEW.provider_event_id IS NULL THEN
    RAISE EXCEPTION 'trusted refund evidence requires provider_event_id'
      USING ERRCODE = '23514';
  ELSIF NEW.status_evidence_kind = 'VERIFIED_WEBHOOK'
        AND NEW.evidence_audit_log_id IS NOT NULL THEN
    RAISE EXCEPTION 'verified refund webhook cannot carry reconcile audit evidence'
      USING ERRCODE = '23514';
  ELSIF NEW.status_evidence_kind = 'AUTHENTICATED_RECONCILE'
        AND NEW.evidence_audit_log_id IS NULL THEN
    RAISE EXCEPTION 'reconciled refund requires its audit_log_id'
      USING ERRCODE = '23514';
  ELSIF NEW.status_evidence_kind IN ('REFUND_REQUESTED', 'SUBMIT_COMMAND', 'NETWORK_UNCERTAINTY')
        AND (NEW.provider_event_id IS NOT NULL OR NEW.evidence_audit_log_id IS NOT NULL) THEN
    RAISE EXCEPTION 'local refund evidence cannot carry provider or audit evidence IDs'
      USING ERRCODE = '23514';
  END IF;

  SELECT current_payment_attempt_id, payment_status
    INTO order_current_attempt_id, order_payment_status
    FROM orders WHERE id = NEW.order_id;
  IF order_current_attempt_id IS DISTINCT FROM NEW.payment_attempt_id
     OR order_payment_status NOT IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') THEN
    RAISE EXCEPTION 'refund requires the order current captured payment attempt'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status <> 'FAILED' THEN
    old_contribution := OLD.requested_amount_minor;
  END IF;
  IF NEW.status <> 'FAILED' THEN
    new_contribution := NEW.requested_amount_minor;
  END IF;
  capacity_delta := new_contribution::bigint - old_contribution::bigint;

  IF capacity_delta <> 0 OR TG_OP = 'INSERT' THEN
    UPDATE payment_attempts
      SET refund_occupied_minor = refund_occupied_minor + capacity_delta
      WHERE id = NEW.payment_attempt_id
        AND order_id = NEW.order_id
        AND status = 'SUCCEEDED'
        AND currency = NEW.captured_currency
        AND amount_minor = NEW.captured_amount_minor
        AND refund_occupied_minor + capacity_delta BETWEEN 0 AND amount_minor
      RETURNING id INTO updated_attempt_id;
    IF updated_attempt_id IS NULL THEN
      RAISE EXCEPTION 'refund capacity exceeded or captured payment attempt is not eligible'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION assert_refund_allocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_refund_id uuid;
  expected_amount minor_amount;
  allocated_amount numeric;
  allocation_count integer;
BEGIN
  target_refund_id := COALESCE(
    (to_jsonb(NEW) ->> 'refund_id')::uuid,
    (to_jsonb(OLD) ->> 'refund_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid,
    (to_jsonb(OLD) ->> 'id')::uuid
  );
  SELECT requested_amount_minor INTO expected_amount FROM refunds WHERE id = target_refund_id;
  IF expected_amount IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*), COALESCE(sum(amount_minor), 0)
    INTO allocation_count, allocated_amount
    FROM refund_items WHERE refund_id = target_refund_id;
  IF allocation_count = 0 OR allocated_amount <> expected_amount THEN
    RAISE EXCEPTION 'refund allocations must be non-empty and sum exactly to requested amount'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_refund_item_capacity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_order_item_id uuid := (to_jsonb(NEW) ->> 'order_item_id')::uuid;
  target_refund_id uuid := COALESCE(
    (to_jsonb(NEW) ->> 'refund_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid
  );
  item_row record;
  item_total minor_amount;
  occupied_total numeric;
BEGIN
  FOR item_row IN
    SELECT DISTINCT item.order_item_id
    FROM public.refund_items item
    WHERE (target_order_item_id IS NOT NULL AND item.order_item_id = target_order_item_id)
       OR (target_order_item_id IS NULL AND item.refund_id = target_refund_id)
  LOOP
    SELECT line_total_minor INTO item_total
      FROM public.order_items
      WHERE id = item_row.order_item_id;
    SELECT COALESCE(sum(item.amount_minor), 0) INTO occupied_total
      FROM public.refund_items item
      JOIN public.refunds refund ON refund.id = item.refund_id
      WHERE item.order_item_id = item_row.order_item_id
        AND refund.status <> 'FAILED';
    IF item_total IS NULL OR occupied_total > item_total THEN
      RAISE EXCEPTION 'refund allocation exceeds order-item total'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_refund_evidence_and_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  history_count integer;
  evidence_count integer;
  expected_from text;
BEGIN
  expected_from := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
  SELECT count(*) INTO history_count
    FROM refund_events event
    WHERE event.refund_id = NEW.id
      AND event.sequence = NEW.version
      AND event.from_status IS NOT DISTINCT FROM expected_from
      AND event.to_status = NEW.status
      AND event.evidence_kind = NEW.status_evidence_kind
      AND event.provider_event_id IS NOT DISTINCT FROM NEW.provider_event_id
      AND event.audit_log_id IS NOT DISTINCT FROM NEW.evidence_audit_log_id;
  IF history_count <> 1 THEN
    RAISE EXCEPTION 'refund transition requires one matching append-only event'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status_evidence_kind IN ('VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE') THEN
    SELECT count(*) INTO evidence_count
      FROM provider_events event
      JOIN provider_event_associations association
        ON association.provider_event_id = event.id
        AND association.association_status = 'MATCHED'
        AND association.payment_attempt_id = NEW.payment_attempt_id
      WHERE event.id = NEW.provider_event_id
        AND event.evidence_kind = NEW.status_evidence_kind
        AND event.reconcile_audit_log_id IS NOT DISTINCT FROM NEW.evidence_audit_log_id
        AND event.event_type = 'REFUND_STATUS'
        AND event.normalized_status = NEW.status
        AND event.provider_refund_reference = NEW.provider_reference
        AND event.amount_minor = NEW.requested_amount_minor
        AND event.currency = NEW.currency;
    IF evidence_count <> 1 THEN
      RAISE EXCEPTION 'refund transition lacks matching normalized provider evidence'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION validate_dispute_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  attempt_status text;
  captured_amount minor_amount;
  captured_currency currency_code;
  transition_allowed boolean;
BEGIN
  SELECT status, amount_minor, currency
    INTO attempt_status, captured_amount, captured_currency FROM payment_attempts
    WHERE id = NEW.payment_attempt_id AND order_id = NEW.order_id;
  IF attempt_status <> 'SUCCEEDED' OR NEW.currency <> captured_currency
     OR NEW.amount_minor > captured_amount THEN
    RAISE EXCEPTION 'dispute requires a captured SUCCEEDED payment attempt'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'new dispute must start at version 1' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'NONE' THEN
      IF NEW.status_evidence_kind <> 'DISPUTE_PLACEHOLDER'
         OR NEW.provider_event_id IS NOT NULL OR NEW.evidence_audit_log_id IS NOT NULL THEN
        RAISE EXCEPTION 'NONE dispute is only an evidence-free placeholder'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.status_evidence_kind NOT IN ('VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE') THEN
      RAISE EXCEPTION 'opened dispute requires trusted provider evidence'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - 'status' - 'status_evidence_kind' - 'provider_event_id'
        - 'evidence_audit_log_id' - 'version' - 'updated_at' - 'opened_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'status_evidence_kind' - 'provider_event_id'
        - 'evidence_audit_log_id' - 'version' - 'updated_at' - 'opened_at') THEN
      RAISE EXCEPTION 'dispute identity, provider reference, amount, and currency are immutable'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.status IN ('WON', 'LOST') THEN
      RAISE EXCEPTION 'terminal disputes are immutable' USING ERRCODE = '55000';
    END IF;
    transition_allowed := CASE OLD.status
      WHEN 'NONE' THEN NEW.status IN ('OPEN', 'WON', 'LOST')
      WHEN 'OPEN' THEN NEW.status IN ('WON', 'LOST')
      ELSE false
    END;
    IF NEW.status = OLD.status OR NOT transition_allowed
       OR NEW.status_evidence_kind NOT IN ('VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE')
       OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at THEN
      RAISE EXCEPTION 'invalid dispute transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status_evidence_kind IN ('VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE')
     AND NEW.provider_event_id IS NULL THEN
    RAISE EXCEPTION 'trusted dispute evidence requires provider_event_id'
      USING ERRCODE = '23514';
  ELSIF NEW.status_evidence_kind = 'VERIFIED_WEBHOOK'
        AND NEW.evidence_audit_log_id IS NOT NULL THEN
    RAISE EXCEPTION 'verified dispute webhook cannot carry reconcile audit evidence'
      USING ERRCODE = '23514';
  ELSIF NEW.status_evidence_kind = 'AUTHENTICATED_RECONCILE'
        AND NEW.evidence_audit_log_id IS NULL THEN
    RAISE EXCEPTION 'reconciled dispute requires its audit_log_id'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION assert_dispute_evidence_and_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  history_count integer;
  evidence_count integer;
  expected_from text;
BEGIN
  expected_from := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
  SELECT count(*) INTO history_count
    FROM dispute_events event
    WHERE event.dispute_id = NEW.id
      AND event.sequence = NEW.version
      AND event.from_status IS NOT DISTINCT FROM expected_from
      AND event.to_status = NEW.status
      AND event.evidence_kind = NEW.status_evidence_kind
      AND event.provider_event_id IS NOT DISTINCT FROM NEW.provider_event_id
      AND event.audit_log_id IS NOT DISTINCT FROM NEW.evidence_audit_log_id;
  IF history_count <> 1 THEN
    RAISE EXCEPTION 'dispute transition requires one matching append-only event'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status_evidence_kind IN ('VERIFIED_WEBHOOK', 'AUTHENTICATED_RECONCILE') THEN
    SELECT count(*) INTO evidence_count
      FROM provider_events event
      JOIN provider_event_associations association
        ON association.provider_event_id = event.id
        AND association.association_status = 'MATCHED'
        AND association.payment_attempt_id = NEW.payment_attempt_id
      WHERE event.id = NEW.provider_event_id
        AND event.evidence_kind = NEW.status_evidence_kind
        AND event.reconcile_audit_log_id IS NOT DISTINCT FROM NEW.evidence_audit_log_id
        AND event.event_type = 'DISPUTE_STATUS'
        AND event.normalized_status = NEW.status
        AND event.provider_dispute_reference = NEW.provider_reference
        AND event.amount_minor = NEW.amount_minor
        AND event.currency = NEW.currency;
    IF evidence_count <> 1 THEN
      RAISE EXCEPTION 'dispute transition lacks matching normalized provider evidence'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION validate_outbox_event_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  CASE NEW.event_type
    WHEN 'CART_ITEM_ADDED' THEN
      IF NEW.aggregate_type IS DISTINCT FROM 'CART'
         OR NEW.aggregate_id IS DISTINCT FROM NEW.primary_subject_id
         OR NEW.secondary_subject_id IS NULL
         OR NEW.locale IS NULL OR NEW.market IS NULL OR NEW.currency IS NULL THEN
        RAISE EXCEPTION 'CART_ITEM_ADDED outbox shape is inconsistent'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'CONTENT_PUBLICATION_CHANGED' THEN
      IF NEW.aggregate_type IS DISTINCT FROM 'CONTENT_PUBLICATION'
         OR NEW.aggregate_id IS DISTINCT FROM NEW.primary_subject_id
         OR NEW.secondary_subject_id IS NULL
         OR NEW.locale IS NULL OR NEW.market IS NOT NULL OR NEW.currency IS NOT NULL THEN
        RAISE EXCEPTION 'CONTENT_PUBLICATION_CHANGED outbox shape is inconsistent'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'PAYMENT_STATUS_CHANGED' THEN
      IF NEW.aggregate_type IS DISTINCT FROM 'PAYMENT_ATTEMPT'
         OR NEW.aggregate_id IS DISTINCT FROM NEW.primary_subject_id
         OR NEW.secondary_subject_id IS NULL
         OR NEW.locale IS NULL OR NEW.market IS NULL OR NEW.currency IS NULL THEN
        RAISE EXCEPTION 'PAYMENT_STATUS_CHANGED outbox shape is inconsistent'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'ORDER_PAYMENT_CONFIRMED' THEN
      IF NEW.aggregate_type IS DISTINCT FROM 'ORDER'
         OR NEW.aggregate_id IS DISTINCT FROM NEW.primary_subject_id
         OR NEW.secondary_subject_id IS NULL
         OR NEW.locale IS NULL OR NEW.market IS NULL OR NEW.currency IS NULL THEN
        RAISE EXCEPTION 'ORDER_PAYMENT_CONFIRMED outbox shape is inconsistent'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'REFUND_STATUS_CHANGED' THEN
      IF NEW.aggregate_type IS DISTINCT FROM 'REFUND'
         OR NEW.aggregate_id IS DISTINCT FROM NEW.primary_subject_id
         OR NEW.secondary_subject_id IS NULL
         OR NEW.locale IS NULL OR NEW.market IS NULL OR NEW.currency IS NULL THEN
        RAISE EXCEPTION 'REFUND_STATUS_CHANGED outbox shape is inconsistent'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'DISPUTE_STATUS_CHANGED' THEN
      IF NEW.aggregate_type IS DISTINCT FROM 'DISPUTE'
         OR NEW.aggregate_id IS DISTINCT FROM NEW.primary_subject_id
         OR NEW.secondary_subject_id IS NULL
         OR NEW.locale IS NULL OR NEW.market IS NULL OR NEW.currency IS NULL THEN
        RAISE EXCEPTION 'DISPUTE_STATUS_CHANGED outbox shape is inconsistent'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'FULFILLMENT_STATUS_CHANGED' THEN
      IF NEW.aggregate_type IS DISTINCT FROM 'FULFILLMENT'
         OR NEW.aggregate_id IS DISTINCT FROM NEW.primary_subject_id
         OR NEW.secondary_subject_id IS NULL
         OR NEW.locale IS NULL OR NEW.market IS NULL OR NEW.currency IS NULL THEN
        RAISE EXCEPTION 'FULFILLMENT_STATUS_CHANGED outbox shape is inconsistent'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'NOTIFICATION_REQUESTED' THEN
      IF NEW.aggregate_type IS DISTINCT FROM 'NOTIFICATION_DELIVERY'
         OR NEW.aggregate_id IS DISTINCT FROM NEW.primary_subject_id
         OR NEW.secondary_subject_id IS NULL
         OR NEW.locale IS NULL OR NEW.market IS NULL OR NEW.currency IS NULL THEN
        RAISE EXCEPTION 'NOTIFICATION_REQUESTED outbox shape is inconsistent'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'PAYMENT_CONFIG_PUBLISHED' THEN
      IF NEW.aggregate_type IS DISTINCT FROM 'PAYMENT_CONFIG'
         OR NEW.locale IS NOT NULL OR NEW.market IS NOT NULL OR NEW.currency IS NOT NULL THEN
        RAISE EXCEPTION 'PAYMENT_CONFIG_PUBLISHED outbox shape is inconsistent'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'PRICE_BOOK_PUBLISHED' THEN
      IF NEW.aggregate_type IS DISTINCT FROM 'PRICE_BOOK'
         OR NEW.market IS NULL OR NEW.currency IS NULL OR NEW.locale IS NOT NULL THEN
        RAISE EXCEPTION 'PRICE_BOOK_PUBLISHED outbox shape is inconsistent'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'unsupported outbox event type: %', NEW.event_type
        USING ERRCODE = '23514';
  END CASE;
  RETURN NEW;
END;
$$;

CREATE FUNCTION assert_financial_event_head()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_id uuid := COALESCE(
    (to_jsonb(NEW) ->> 'payment_attempt_id')::uuid,
    (to_jsonb(NEW) ->> 'refund_id')::uuid,
    (to_jsonb(NEW) ->> 'dispute_id')::uuid
  );
  head_count integer;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'payment_attempt_events' THEN
      SELECT count(*) INTO head_count
      FROM public.payment_attempt_events event
      JOIN public.payment_attempts attempt ON attempt.id = event.payment_attempt_id
      WHERE event.id = NEW.id
        AND event.payment_attempt_id = target_id
        AND event.sequence = attempt.version
        AND event.to_status = attempt.status
        AND event.evidence_kind = attempt.status_evidence_kind
        AND event.provider_event_id IS NOT DISTINCT FROM attempt.provider_event_id
        AND event.audit_log_id IS NOT DISTINCT FROM attempt.evidence_audit_log_id
        AND (
          (event.sequence = 1 AND event.from_status IS NULL)
          OR (
            event.sequence > 1
            AND EXISTS (
              SELECT 1
              FROM public.payment_attempt_events previous
              WHERE previous.payment_attempt_id = event.payment_attempt_id
                AND previous.sequence = event.sequence - 1
                AND previous.to_status = event.from_status
            )
          )
        );
    WHEN 'refund_events' THEN
      SELECT count(*) INTO head_count
      FROM public.refund_events event
      JOIN public.refunds refund ON refund.id = event.refund_id
      WHERE event.id = NEW.id
        AND event.refund_id = target_id
        AND event.sequence = refund.version
        AND event.to_status = refund.status
        AND event.evidence_kind = refund.status_evidence_kind
        AND event.provider_event_id IS NOT DISTINCT FROM refund.provider_event_id
        AND event.audit_log_id IS NOT DISTINCT FROM refund.evidence_audit_log_id
        AND (
          (event.sequence = 1 AND event.from_status IS NULL)
          OR (
            event.sequence > 1
            AND EXISTS (
              SELECT 1
              FROM public.refund_events previous
              WHERE previous.refund_id = event.refund_id
                AND previous.sequence = event.sequence - 1
                AND previous.to_status = event.from_status
            )
          )
        );
    WHEN 'dispute_events' THEN
      SELECT count(*) INTO head_count
      FROM public.dispute_events event
      JOIN public.disputes dispute ON dispute.id = event.dispute_id
      WHERE event.id = NEW.id
        AND event.dispute_id = target_id
        AND event.sequence = dispute.version
        AND event.to_status = dispute.status
        AND event.evidence_kind = dispute.status_evidence_kind
        AND event.provider_event_id IS NOT DISTINCT FROM dispute.provider_event_id
        AND event.audit_log_id IS NOT DISTINCT FROM dispute.evidence_audit_log_id
        AND (
          (event.sequence = 1 AND event.from_status IS NULL)
          OR (
            event.sequence > 1
            AND EXISTS (
              SELECT 1
              FROM public.dispute_events previous
              WHERE previous.dispute_id = event.dispute_id
                AND previous.sequence = event.sequence - 1
                AND previous.to_status = event.from_status
            )
          )
        );
    ELSE
      RAISE EXCEPTION 'unsupported financial event table: %', TG_TABLE_NAME
        USING ERRCODE = '23514';
  END CASE;

  IF head_count <> 1 THEN
    RAISE EXCEPTION 'financial event does not match its aggregate head'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_outbox_event_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  source_count integer;
BEGIN
  CASE NEW.event_type
    WHEN 'CART_ITEM_ADDED' THEN
      SELECT count(*) INTO source_count
      FROM public.carts cart
      JOIN public.cart_items item ON item.cart_id = cart.id
      WHERE cart.id = NEW.aggregate_id
        AND cart.id = NEW.primary_subject_id
        AND item.id = NEW.secondary_subject_id
        AND cart.version = NEW.aggregate_version
        AND item.request_id = NEW.request_id
        AND item.correlation_id = NEW.correlation_id
        AND item.created_at = NEW.occurred_at
        AND cart.presentation_locale = NEW.locale
        AND cart.market = NEW.market
        AND cart.currency = NEW.currency;
    WHEN 'PAYMENT_STATUS_CHANGED' THEN
      SELECT count(*) INTO source_count
      FROM public.payment_attempts attempt
      JOIN public.orders order_row ON order_row.id = attempt.order_id
      JOIN public.payment_attempt_events event
        ON event.payment_attempt_id = attempt.id
       AND event.sequence = attempt.version
       AND event.to_status = attempt.status
       AND event.evidence_kind = attempt.status_evidence_kind
       AND event.provider_event_id IS NOT DISTINCT FROM attempt.provider_event_id
       AND event.audit_log_id IS NOT DISTINCT FROM attempt.evidence_audit_log_id
       AND event.request_id = NEW.request_id
       AND event.correlation_id = NEW.correlation_id
       AND event.occurred_at = NEW.occurred_at
      WHERE attempt.id = NEW.aggregate_id
        AND attempt.id = NEW.primary_subject_id
        AND order_row.id = NEW.secondary_subject_id
        AND attempt.version = NEW.aggregate_version
        AND attempt.requested_locale = NEW.locale
        AND order_row.market = NEW.market
        AND attempt.currency = NEW.currency;
    WHEN 'ORDER_PAYMENT_CONFIRMED' THEN
      SELECT count(*) INTO source_count
      FROM public.orders order_row
      JOIN public.payment_attempts attempt
        ON attempt.id = order_row.current_payment_attempt_id
       AND attempt.order_id = order_row.id
      JOIN public.payment_attempt_events payment_event
        ON payment_event.payment_attempt_id = attempt.id
       AND payment_event.sequence = attempt.version
       AND payment_event.to_status = 'SUCCEEDED'
      JOIN public.order_events order_event
        ON order_event.order_id = order_row.id
       AND order_event.sequence = order_row.version
       AND order_event.event_type IN ('PAYMENT_STATUS_CHANGED', 'LATE_PAYMENT_RECOVERED')
       AND order_event.to_payment_status = 'PAID'
       AND order_event.to_payment_attempt_id = attempt.id
       AND order_event.provider_event_id = attempt.provider_event_id
       AND order_event.request_id = NEW.request_id
       AND order_event.correlation_id = NEW.correlation_id
       AND order_event.occurred_at = NEW.occurred_at
      WHERE order_row.id = NEW.aggregate_id
        AND order_row.id = NEW.primary_subject_id
        AND attempt.id = NEW.secondary_subject_id
        AND order_row.version = NEW.aggregate_version
        AND order_row.order_status = 'OPEN'
        AND order_row.payment_status = 'PAID'
        AND attempt.status = 'SUCCEEDED'
        AND order_row.presentation_locale = NEW.locale
        AND order_row.market = NEW.market
        AND order_row.currency = NEW.currency;
    WHEN 'REFUND_STATUS_CHANGED' THEN
      SELECT count(*) INTO source_count
      FROM public.refunds refund
      JOIN public.orders order_row ON order_row.id = refund.order_id
      JOIN public.refund_events event
        ON event.refund_id = refund.id
       AND event.sequence = refund.version
       AND event.to_status = refund.status
       AND event.evidence_kind = refund.status_evidence_kind
       AND event.provider_event_id IS NOT DISTINCT FROM refund.provider_event_id
       AND event.audit_log_id IS NOT DISTINCT FROM refund.evidence_audit_log_id
       AND event.request_id = NEW.request_id
       AND event.correlation_id = NEW.correlation_id
       AND event.occurred_at = NEW.occurred_at
      WHERE refund.id = NEW.aggregate_id
        AND refund.id = NEW.primary_subject_id
        AND order_row.id = NEW.secondary_subject_id
        AND refund.version = NEW.aggregate_version
        AND order_row.presentation_locale = NEW.locale
        AND order_row.market = NEW.market
        AND refund.currency = NEW.currency;
    WHEN 'DISPUTE_STATUS_CHANGED' THEN
      SELECT count(*) INTO source_count
      FROM public.disputes dispute
      JOIN public.orders order_row ON order_row.id = dispute.order_id
      JOIN public.dispute_events event
        ON event.dispute_id = dispute.id
       AND event.sequence = dispute.version
       AND event.to_status = dispute.status
       AND event.evidence_kind = dispute.status_evidence_kind
       AND event.provider_event_id IS NOT DISTINCT FROM dispute.provider_event_id
       AND event.audit_log_id IS NOT DISTINCT FROM dispute.evidence_audit_log_id
       AND event.request_id = NEW.request_id
       AND event.correlation_id = NEW.correlation_id
       AND event.occurred_at = NEW.occurred_at
      WHERE dispute.id = NEW.aggregate_id
        AND dispute.id = NEW.primary_subject_id
        AND order_row.id = NEW.secondary_subject_id
        AND dispute.version = NEW.aggregate_version
        AND order_row.presentation_locale = NEW.locale
        AND order_row.market = NEW.market
        AND dispute.currency = NEW.currency;
    WHEN 'FULFILLMENT_STATUS_CHANGED' THEN
      SELECT count(*) INTO source_count
      FROM public.fulfillments fulfillment
      JOIN public.orders order_row ON order_row.id = fulfillment.order_id
      JOIN public.fulfillment_events event
        ON event.fulfillment_id = fulfillment.id
       AND event.order_id = order_row.id
       AND event.sequence = fulfillment.version
       AND event.to_status = fulfillment.status
       AND event.request_id = NEW.request_id
       AND event.correlation_id = NEW.correlation_id
       AND event.occurred_at = NEW.occurred_at
      WHERE fulfillment.id = NEW.aggregate_id
        AND fulfillment.id = NEW.primary_subject_id
        AND order_row.id = NEW.secondary_subject_id
        AND fulfillment.version = NEW.aggregate_version
        AND order_row.presentation_locale = NEW.locale
        AND order_row.market = NEW.market
        AND order_row.currency = NEW.currency;
    WHEN 'NOTIFICATION_REQUESTED' THEN
      SELECT count(*) INTO source_count
      FROM public.notification_deliveries delivery
      JOIN public.orders order_row ON order_row.id = delivery.order_id
      WHERE delivery.id = NEW.aggregate_id
        AND delivery.id = NEW.primary_subject_id
        AND order_row.id = NEW.secondary_subject_id
        AND delivery.version = NEW.aggregate_version
        AND delivery.status = 'REQUESTED'
        AND delivery.attempt_count = 0
        AND delivery.request_id = NEW.request_id
        AND delivery.correlation_id = NEW.correlation_id
        AND delivery.created_at = NEW.occurred_at
        AND delivery.resolved_locale = NEW.locale
        AND order_row.market = NEW.market
        AND order_row.currency = NEW.currency;
    WHEN 'CONTENT_PUBLICATION_CHANGED', 'PAYMENT_CONFIG_PUBLISHED', 'PRICE_BOOK_PUBLISHED' THEN
      -- Migration 0006 installs typed publication-source checks after those
      -- publication heads and price books exist.
      RETURN NULL;
    ELSE
      source_count := 0;
  END CASE;

  IF source_count <> 1 THEN
    RAISE EXCEPTION 'outbox event has no exact authoritative source'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_cart_item_added_outbox()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  event_count integer;
BEGIN
  SELECT count(*) INTO event_count
  FROM public.carts cart
  JOIN public.outbox_events event
    ON event.event_type = 'CART_ITEM_ADDED'
   AND event.aggregate_type = 'CART'
   AND event.aggregate_id = cart.id
   AND event.aggregate_version = cart.version
   AND event.primary_subject_id = cart.id
   AND event.secondary_subject_id = NEW.id
   AND event.request_id = NEW.request_id
   AND event.correlation_id = NEW.correlation_id
   AND event.occurred_at = NEW.created_at
   AND event.locale = cart.presentation_locale
   AND event.market = cart.market
   AND event.currency = cart.currency
  WHERE cart.id = NEW.cart_id;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'cart item and outbox record must commit together'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_fulfillment_event_outbox()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  event_count integer;
BEGIN
  SELECT count(*) INTO event_count
  FROM public.orders order_row
  JOIN public.outbox_events event
    ON event.event_type = 'FULFILLMENT_STATUS_CHANGED'
   AND event.aggregate_type = 'FULFILLMENT'
   AND event.aggregate_id = NEW.fulfillment_id
   AND event.aggregate_version = NEW.sequence
   AND event.primary_subject_id = NEW.fulfillment_id
   AND event.secondary_subject_id = NEW.order_id
   AND event.request_id = NEW.request_id
   AND event.correlation_id = NEW.correlation_id
   AND event.occurred_at = NEW.occurred_at
   AND event.locale = order_row.presentation_locale
   AND event.market = order_row.market
   AND event.currency = order_row.currency
  WHERE order_row.id = NEW.order_id;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'fulfillment event and outbox record must commit together'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_notification_request_outbox()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  event_count integer;
BEGIN
  SELECT count(*) INTO event_count
  FROM public.orders order_row
  JOIN public.outbox_events event
    ON event.event_type = 'NOTIFICATION_REQUESTED'
   AND event.aggregate_type = 'NOTIFICATION_DELIVERY'
   AND event.aggregate_id = NEW.id
   AND event.aggregate_version = NEW.version
   AND event.primary_subject_id = NEW.id
   AND event.secondary_subject_id = NEW.order_id
   AND event.request_id = NEW.request_id
   AND event.correlation_id = NEW.correlation_id
   AND event.occurred_at = NEW.created_at
   AND event.locale = NEW.resolved_locale
   AND event.market = order_row.market
   AND event.currency = order_row.currency
  WHERE order_row.id = NEW.order_id
    AND NEW.status = 'REQUESTED'
    AND NEW.attempt_count = 0;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'notification request and outbox record must commit together'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_payment_state_event_outbox()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  aggregate_order_id uuid;
  event_count integer;
BEGIN
  SELECT attempt.order_id INTO aggregate_order_id
  FROM public.payment_attempts attempt
  WHERE attempt.id = NEW.payment_attempt_id;
  SELECT count(*) INTO event_count
  FROM public.payment_attempts attempt
  JOIN public.orders order_row ON order_row.id = attempt.order_id
  JOIN public.outbox_events event
    ON event.event_type = 'PAYMENT_STATUS_CHANGED'
   AND event.aggregate_type = 'PAYMENT_ATTEMPT'
   AND event.aggregate_id = attempt.id
   AND event.aggregate_version = NEW.sequence
   AND event.primary_subject_id = attempt.id
   AND event.secondary_subject_id = order_row.id
   AND event.request_id = NEW.request_id
   AND event.correlation_id = NEW.correlation_id
   AND event.occurred_at = NEW.occurred_at
   AND event.locale = attempt.requested_locale
   AND event.market = order_row.market
   AND event.currency = attempt.currency
  WHERE attempt.id = NEW.payment_attempt_id;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'payment state event and outbox record must commit together'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.to_status = 'SUCCEEDED' THEN
    SELECT count(*) INTO event_count
    FROM public.orders order_row
    JOIN public.order_events order_event
      ON order_event.order_id = order_row.id
     AND order_event.sequence = order_row.version
     AND order_event.event_type IN ('PAYMENT_STATUS_CHANGED', 'LATE_PAYMENT_RECOVERED')
     AND order_event.to_payment_status = 'PAID'
     AND order_event.to_payment_attempt_id = NEW.payment_attempt_id
     AND order_event.provider_event_id = NEW.provider_event_id
    JOIN public.outbox_events event
      ON event.event_type = 'ORDER_PAYMENT_CONFIRMED'
     AND event.aggregate_type = 'ORDER'
     AND event.aggregate_id = order_row.id
     AND event.aggregate_version = order_row.version
     AND event.primary_subject_id = order_row.id
     AND event.secondary_subject_id = NEW.payment_attempt_id
     AND order_event.request_id = event.request_id
     AND order_event.correlation_id = event.correlation_id
     AND order_event.occurred_at = event.occurred_at
     AND event.locale = order_row.presentation_locale
     AND event.market = order_row.market
     AND event.currency = order_row.currency
    WHERE order_row.id = aggregate_order_id;
    IF event_count <> 1 THEN
      RAISE EXCEPTION 'successful payment requires one order confirmation outbox event'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_refund_state_event_outbox()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  event_count integer;
  aggregate_order_id uuid;
BEGIN
  SELECT refund.order_id INTO aggregate_order_id
  FROM public.refunds refund
  WHERE refund.id = NEW.refund_id;
  SELECT count(*) INTO event_count
  FROM public.refunds refund
  JOIN public.orders order_row ON order_row.id = refund.order_id
  JOIN public.outbox_events event
    ON event.event_type = 'REFUND_STATUS_CHANGED'
   AND event.aggregate_type = 'REFUND'
   AND event.aggregate_id = refund.id
   AND event.aggregate_version = NEW.sequence
   AND event.primary_subject_id = refund.id
   AND event.secondary_subject_id = order_row.id
   AND event.request_id = NEW.request_id
   AND event.correlation_id = NEW.correlation_id
   AND event.occurred_at = NEW.occurred_at
   AND event.locale = order_row.presentation_locale
   AND event.market = order_row.market
   AND event.currency = refund.currency
  WHERE refund.id = NEW.refund_id;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'refund state event and outbox record must commit together'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_dispute_state_event_outbox()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  event_count integer;
  aggregate_order_id uuid;
BEGIN
  SELECT dispute.order_id INTO aggregate_order_id
  FROM public.disputes dispute
  WHERE dispute.id = NEW.dispute_id;
  SELECT count(*) INTO event_count
  FROM public.disputes dispute
  JOIN public.orders order_row ON order_row.id = dispute.order_id
  JOIN public.outbox_events event
    ON event.event_type = 'DISPUTE_STATUS_CHANGED'
   AND event.aggregate_type = 'DISPUTE'
   AND event.aggregate_id = dispute.id
   AND event.aggregate_version = NEW.sequence
   AND event.primary_subject_id = dispute.id
   AND event.secondary_subject_id = order_row.id
   AND event.request_id = NEW.request_id
   AND event.correlation_id = NEW.correlation_id
   AND event.occurred_at = NEW.occurred_at
   AND event.locale = order_row.presentation_locale
   AND event.market = order_row.market
   AND event.currency = dispute.currency
  WHERE dispute.id = NEW.dispute_id;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'dispute state event and outbox record must commit together'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_payment_config_publication_outbox()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  config_version_number positive_version;
  event_count integer;
BEGIN
  SELECT version INTO config_version_number FROM config_versions WHERE id = NEW.config_version_id;
  SELECT count(*) INTO event_count FROM outbox_events
    WHERE event_type = 'PAYMENT_CONFIG_PUBLISHED'
      AND aggregate_type = 'PAYMENT_CONFIG'
      AND aggregate_id = NEW.config_version_id
      AND aggregate_version = config_version_number
      AND primary_subject_id = NEW.id;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'payment config publication and outbox record must commit together'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER merchant_entities_identity_immutable_trigger
  BEFORE UPDATE ON merchant_entities
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns(
    'id', 'schema_version', 'entity_key', 'legal_country', 'status', 'created_at'
  );
CREATE TRIGGER payment_provider_accounts_identity_immutable_trigger
  BEFORE UPDATE ON payment_provider_accounts
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns(
    'id', 'schema_version', 'merchant_entity_id', 'adapter_key', 'environment',
    'account_reference_digest', 'credential_secret_ref', 'status', 'created_at'
  );
CREATE TRIGGER payment_provider_accounts_health_guard_trigger
  BEFORE INSERT OR UPDATE ON payment_provider_accounts
  FOR EACH ROW EXECUTE FUNCTION guard_payment_provider_account_health();
CREATE TRIGGER payment_provider_health_events_validate_trigger
  BEFORE INSERT ON payment_provider_health_events
  FOR EACH ROW EXECUTE FUNCTION validate_payment_provider_health_event();
CREATE TRIGGER payment_provider_health_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON payment_provider_health_events
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER payment_provider_accounts_health_head_trigger
  AFTER INSERT OR UPDATE ON payment_provider_accounts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_payment_provider_health_head();
CREATE CONSTRAINT TRIGGER payment_provider_health_events_head_trigger
  AFTER INSERT ON payment_provider_health_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_payment_provider_health_head();
CREATE TRIGGER payment_webhook_endpoints_identity_immutable_trigger
  BEFORE UPDATE ON payment_webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns(
    'id', 'schema_version', 'provider_account_id', 'environment',
    'verification_secret_ref', 'verification_key_reference_hash',
    'rotated_from_endpoint_id', 'active_from', 'created_at'
  );
CREATE TRIGGER payment_webhook_endpoints_lifecycle_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON payment_webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION guard_payment_webhook_endpoint_transition();

CREATE TRIGGER config_versions_payment_mutation_trigger
  BEFORE UPDATE ON config_versions
  FOR EACH ROW EXECUTE FUNCTION guard_payment_config_version_mutation();
CREATE TRIGGER config_versions_payment_publication_trigger
  BEFORE INSERT OR UPDATE ON config_versions
  FOR EACH ROW EXECUTE FUNCTION validate_payment_config_publication();

CREATE TRIGGER carts_nonterminal_payment_lock_trigger
  BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION guard_nonterminal_payment_lock();
CREATE TRIGGER orders_nonterminal_payment_lock_trigger
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION guard_nonterminal_payment_lock();
CREATE TRIGGER order_events_provider_cancel_evidence_trigger
  BEFORE INSERT ON order_events
  FOR EACH ROW EXECUTE FUNCTION validate_order_provider_cancel_evidence();
CREATE TRIGGER inventory_reservations_nonterminal_payment_lock_trigger
  BEFORE UPDATE ON inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_nonterminal_payment_lock();

CREATE TRIGGER payment_provider_configs_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON payment_provider_configs
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation('config_versions', 'config_version_id');
CREATE TRIGGER payment_provider_config_translations_validate_trigger
  BEFORE INSERT OR UPDATE ON payment_provider_config_translations
  FOR EACH ROW EXECUTE FUNCTION validate_translation_row();
CREATE TRIGGER payment_provider_config_translations_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON payment_provider_config_translations
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation('config_versions', 'config_version_id');
CREATE TRIGGER payment_provider_config_translations_append_only_trigger
  BEFORE UPDATE OR DELETE ON payment_provider_config_translations
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER payment_provider_config_translations_initial_review_trigger
  AFTER INSERT ON payment_provider_config_translations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_translation_initial_review(
    'payment_provider_config_translation_reviews',
    'provider_config_translation_id'
  );
CREATE TRIGGER payment_provider_config_translation_reviews_validate_trigger
  BEFORE INSERT ON payment_provider_config_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION validate_translation_review_event(
    'payment_provider_config_translations',
    'provider_config_translation_id',
    'config_versions',
    'config_version_id'
  );
CREATE TRIGGER payment_provider_config_translation_reviews_append_only_trigger
  BEFORE UPDATE OR DELETE ON payment_provider_config_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_route_rules_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON payment_route_rules
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation('config_versions', 'config_version_id');
CREATE TRIGGER payment_route_rule_countries_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON payment_route_rule_countries
  FOR EACH ROW EXECUTE FUNCTION guard_payment_route_child_mutation();
CREATE TRIGGER payment_route_rule_markets_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON payment_route_rule_markets
  FOR EACH ROW EXECUTE FUNCTION guard_payment_route_child_mutation();
CREATE TRIGGER payment_route_rule_currencies_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON payment_route_rule_currencies
  FOR EACH ROW EXECUTE FUNCTION guard_payment_route_child_mutation();
CREATE TRIGGER payment_route_rule_device_capabilities_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON payment_route_rule_device_capabilities
  FOR EACH ROW EXECUTE FUNCTION guard_payment_route_child_mutation();
CREATE TRIGGER payment_config_publications_validate_trigger
  BEFORE INSERT ON payment_config_publications
  FOR EACH ROW EXECUTE FUNCTION validate_payment_config_publication_event();
CREATE TRIGGER payment_config_publications_append_only_trigger
  BEFORE UPDATE OR DELETE ON payment_config_publications
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER payment_config_publications_outbox_trigger
  AFTER INSERT ON payment_config_publications
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_payment_config_publication_outbox();

CREATE CONSTRAINT TRIGGER cart_items_added_outbox_trigger
  AFTER INSERT ON cart_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_cart_item_added_outbox();
CREATE CONSTRAINT TRIGGER fulfillment_events_outbox_trigger
  AFTER INSERT ON fulfillment_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_fulfillment_event_outbox();
CREATE CONSTRAINT TRIGGER notification_deliveries_outbox_trigger
  AFTER INSERT ON notification_deliveries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_notification_request_outbox();

CREATE TRIGGER payment_attempts_validate_trigger
  BEFORE INSERT OR UPDATE ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION validate_payment_attempt_mutation();
CREATE TRIGGER payment_attempts_delete_guard_trigger
  BEFORE DELETE ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER payment_attempts_insert_evidence_trigger
  AFTER INSERT ON payment_attempts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_payment_attempt_evidence_and_event();
CREATE CONSTRAINT TRIGGER payment_attempts_status_evidence_trigger
  AFTER UPDATE OF status ON payment_attempts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_payment_attempt_evidence_and_event();
CREATE CONSTRAINT TRIGGER payment_attempts_success_aggregate_trigger
  AFTER UPDATE OF status ON payment_attempts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_payment_success_aggregate_plan();

CREATE TRIGGER webhook_payloads_transition_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON webhook_payloads
  FOR EACH ROW EXECUTE FUNCTION guard_webhook_payload_transition();
CREATE TRIGGER webhook_inbox_append_only_trigger
  BEFORE UPDATE OR DELETE ON webhook_inbox
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER webhook_inbox_endpoint_window_trigger
  BEFORE INSERT ON webhook_inbox
  FOR EACH ROW EXECUTE FUNCTION validate_webhook_inbox_endpoint_window();
CREATE TRIGGER provider_events_evidence_validate_trigger
  BEFORE INSERT ON provider_events
  FOR EACH ROW EXECUTE FUNCTION validate_provider_event_evidence();
CREATE TRIGGER provider_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON provider_events
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER provider_events_association_trigger
  AFTER INSERT ON provider_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_provider_event_association();
CREATE CONSTRAINT TRIGGER provider_events_transaction_ledger_trigger
  AFTER INSERT ON provider_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_provider_transaction_ledger();
CREATE TRIGGER provider_event_associations_validate_trigger
  BEFORE INSERT ON provider_event_associations
  FOR EACH ROW EXECUTE FUNCTION validate_provider_event_association();
CREATE TRIGGER provider_event_associations_append_only_trigger
  BEFORE UPDATE OR DELETE ON provider_event_associations
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER provider_event_associations_transaction_ledger_trigger
  AFTER INSERT ON provider_event_associations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_provider_transaction_ledger();
CREATE TRIGGER payment_transactions_append_only_trigger
  BEFORE UPDATE OR DELETE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_transactions_evidence_validate_trigger
  BEFORE INSERT ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION validate_payment_transaction_evidence();

CREATE TRIGGER refunds_validate_capacity_trigger
  BEFORE INSERT OR UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION validate_refund_mutation_and_capacity();
CREATE TRIGGER refunds_delete_guard_trigger
  BEFORE DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER refunds_insert_allocation_trigger
  AFTER INSERT ON refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_refund_allocation();
CREATE CONSTRAINT TRIGGER refunds_update_allocation_trigger
  AFTER UPDATE OF requested_amount_minor ON refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_refund_allocation();
CREATE CONSTRAINT TRIGGER refund_items_allocation_trigger
  AFTER INSERT OR UPDATE OR DELETE ON refund_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_refund_allocation();
CREATE CONSTRAINT TRIGGER refund_items_capacity_trigger
  AFTER INSERT ON refund_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_refund_item_capacity();
CREATE CONSTRAINT TRIGGER refunds_item_capacity_trigger
  AFTER INSERT OR UPDATE OF status ON refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_refund_item_capacity();
CREATE CONSTRAINT TRIGGER refunds_insert_evidence_trigger
  AFTER INSERT ON refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_refund_evidence_and_event();
CREATE CONSTRAINT TRIGGER refunds_status_evidence_trigger
  AFTER UPDATE OF status ON refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_refund_evidence_and_event();
CREATE TRIGGER refund_items_append_only_trigger
  BEFORE UPDATE OR DELETE ON refund_items
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER disputes_validate_trigger
  BEFORE INSERT OR UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION validate_dispute_mutation();
CREATE TRIGGER disputes_delete_guard_trigger
  BEFORE DELETE ON disputes
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER disputes_insert_evidence_trigger
  AFTER INSERT ON disputes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_dispute_evidence_and_event();
CREATE CONSTRAINT TRIGGER disputes_status_evidence_trigger
  AFTER UPDATE OF status ON disputes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_dispute_evidence_and_event();

CREATE TRIGGER payment_attempt_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON payment_attempt_events
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER payment_attempt_events_outbox_trigger
  AFTER INSERT ON payment_attempt_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_payment_state_event_outbox();
CREATE CONSTRAINT TRIGGER payment_attempt_events_head_trigger
  AFTER INSERT ON payment_attempt_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_financial_event_head();
CREATE TRIGGER refund_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON refund_events
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER refund_events_outbox_trigger
  AFTER INSERT ON refund_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_refund_state_event_outbox();
CREATE CONSTRAINT TRIGGER refund_events_head_trigger
  AFTER INSERT ON refund_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_financial_event_head();
CREATE TRIGGER dispute_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON dispute_events
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER dispute_events_outbox_trigger
  AFTER INSERT ON dispute_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_dispute_state_event_outbox();
CREATE CONSTRAINT TRIGGER dispute_events_head_trigger
  AFTER INSERT ON dispute_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_financial_event_head();
CREATE TRIGGER webhook_processing_attempts_append_only_trigger
  BEFORE UPDATE OR DELETE ON webhook_processing_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER webhook_effects_append_only_trigger
  BEFORE UPDATE OR DELETE ON webhook_effects
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER outbox_events_validate_trigger
  BEFORE INSERT ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION validate_outbox_event_shape();
CREATE CONSTRAINT TRIGGER outbox_events_authority_trigger
  AFTER INSERT ON outbox_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_outbox_event_authority();
CREATE TRIGGER outbox_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER outbox_dispatch_attempts_append_only_trigger
  BEFORE UPDATE OR DELETE ON outbox_dispatch_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER outbox_effect_receipts_append_only_trigger
  BEFORE UPDATE OR DELETE ON outbox_effect_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER merchant_entities_no_truncate_trigger
  BEFORE TRUNCATE ON merchant_entities
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_provider_accounts_no_truncate_trigger
  BEFORE TRUNCATE ON payment_provider_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_provider_health_events_no_truncate_trigger
  BEFORE TRUNCATE ON payment_provider_health_events
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_webhook_endpoints_no_truncate_trigger
  BEFORE TRUNCATE ON payment_webhook_endpoints
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_provider_configs_no_truncate_trigger
  BEFORE TRUNCATE ON payment_provider_configs
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_provider_config_translations_no_truncate_trigger
  BEFORE TRUNCATE ON payment_provider_config_translations
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_provider_config_translation_reviews_no_truncate_trigger
  BEFORE TRUNCATE ON payment_provider_config_translation_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_route_rules_no_truncate_trigger
  BEFORE TRUNCATE ON payment_route_rules
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_route_rule_countries_no_truncate_trigger
  BEFORE TRUNCATE ON payment_route_rule_countries
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_route_rule_markets_no_truncate_trigger
  BEFORE TRUNCATE ON payment_route_rule_markets
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_route_rule_currencies_no_truncate_trigger
  BEFORE TRUNCATE ON payment_route_rule_currencies
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_route_rule_device_capabilities_no_truncate_trigger
  BEFORE TRUNCATE ON payment_route_rule_device_capabilities
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_config_publications_no_truncate_trigger
  BEFORE TRUNCATE ON payment_config_publications
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_attempts_no_truncate_trigger
  BEFORE TRUNCATE ON payment_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER webhook_payloads_no_truncate_trigger
  BEFORE TRUNCATE ON webhook_payloads
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER webhook_inbox_no_truncate_trigger
  BEFORE TRUNCATE ON webhook_inbox
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER provider_events_no_truncate_trigger
  BEFORE TRUNCATE ON provider_events
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER provider_event_associations_no_truncate_trigger
  BEFORE TRUNCATE ON provider_event_associations
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_transactions_no_truncate_trigger
  BEFORE TRUNCATE ON payment_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER refunds_no_truncate_trigger
  BEFORE TRUNCATE ON refunds
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER refund_items_no_truncate_trigger
  BEFORE TRUNCATE ON refund_items
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER disputes_no_truncate_trigger
  BEFORE TRUNCATE ON disputes
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER payment_attempt_events_no_truncate_trigger
  BEFORE TRUNCATE ON payment_attempt_events
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER refund_events_no_truncate_trigger
  BEFORE TRUNCATE ON refund_events
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER dispute_events_no_truncate_trigger
  BEFORE TRUNCATE ON dispute_events
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER webhook_processing_attempts_no_truncate_trigger
  BEFORE TRUNCATE ON webhook_processing_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER webhook_effects_no_truncate_trigger
  BEFORE TRUNCATE ON webhook_effects
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER outbox_events_no_truncate_trigger
  BEFORE TRUNCATE ON outbox_events
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER outbox_dispatch_attempts_no_truncate_trigger
  BEFORE TRUNCATE ON outbox_dispatch_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER outbox_effect_receipts_no_truncate_trigger
  BEFORE TRUNCATE ON outbox_effect_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
