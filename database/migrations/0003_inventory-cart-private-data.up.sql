SET search_path = public;

CREATE TABLE carts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  token_digest bytea NOT NULL CHECK (octet_length(token_digest) = 32),
  token_pepper_version text NOT NULL CHECK (token_pepper_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  presentation_locale supported_locale NOT NULL,
  market market_code NOT NULL,
  currency currency_code NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'LOCKED', 'CONVERTED', 'EXPIRED')),
  version positive_version NOT NULL DEFAULT 1,
  expires_at finite_timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT carts_token_digest_unique UNIQUE (token_pepper_version, token_digest),
  CONSTRAINT carts_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX carts_active_expiry_idx ON carts (expires_at) WHERE status IN ('ACTIVE', 'LOCKED');

CREATE TABLE cart_items (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE RESTRICT,
  gift_variant_id uuid NOT NULL REFERENCES gift_variants(id) ON DELETE RESTRICT,
  observed_price_id uuid NOT NULL REFERENCES prices(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  display_mode text NOT NULL CHECK (display_mode IN ('anonymous', 'nickname')),
  has_fan_message boolean NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  version positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT cart_items_id_cart_unique UNIQUE (id, cart_id),
  CONSTRAINT cart_items_id_variant_unique UNIQUE (id, gift_variant_id)
);

CREATE INDEX cart_items_cart_idx ON cart_items (cart_id, created_at, id);

CREATE TABLE support_intents (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  cart_item_id uuid NOT NULL REFERENCES cart_items(id) ON DELETE RESTRICT,
  idol_id uuid NOT NULL REFERENCES idols(id) ON DELETE RESTRICT,
  fan_message_ciphertext ciphertext_bytes,
  display_mode text NOT NULL CHECK (display_mode IN ('anonymous', 'nickname')),
  display_name_ciphertext ciphertext_bytes,
  encrypted_data_key ciphertext_bytes,
  encryption_key_version text CHECK (encryption_key_version IS NULL OR encryption_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  privacy_state text NOT NULL DEFAULT 'ACTIVE' CHECK (privacy_state IN ('ACTIVE', 'PURGE_PENDING', 'PURGED')),
  purge_requested_at timestamptz,
  purged_at timestamptz,
  moderation_status text NOT NULL CHECK (moderation_status IN ('PENDING', 'APPROVED', 'REJECTED', 'REDACTED')),
  moderation_reason_code text CHECK (moderation_reason_code IS NULL OR moderation_reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  moderation_decision_kind text CHECK (moderation_decision_kind IS NULL OR moderation_decision_kind IN ('HUMAN', 'AUTOMATED')),
  moderation_reviewer_id uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  moderation_rule_version text CHECK (moderation_rule_version IS NULL OR moderation_rule_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  moderation_evidence_id uuid,
  reviewed_at timestamptz,
  created_presentation_locale supported_locale NOT NULL,
  fan_message_locale text NOT NULL CHECK (fan_message_locale IN ('en', 'zh-CN', 'th', 'vi', 'ja', 'es', 'pt', 'und')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'CHECKOUT_LOCKED', 'CONVERTED', 'EXPIRED', 'CANCELED')),
  version positive_version NOT NULL DEFAULT 1,
  expires_at finite_timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT support_intents_cart_item_unique UNIQUE (cart_item_id),
  CONSTRAINT support_intents_private_material_check CHECK (
    (privacy_state = 'ACTIVE' AND encrypted_data_key IS NOT NULL AND encryption_key_version IS NOT NULL
      AND purge_requested_at IS NULL AND purged_at IS NULL
      AND ((display_mode = 'anonymous' AND display_name_ciphertext IS NULL)
        OR (display_mode = 'nickname' AND display_name_ciphertext IS NOT NULL)))
    OR (privacy_state = 'PURGE_PENDING' AND encrypted_data_key IS NOT NULL AND encryption_key_version IS NOT NULL
      AND purge_requested_at IS NOT NULL AND purged_at IS NULL
      AND ((display_mode = 'anonymous' AND display_name_ciphertext IS NULL)
        OR (display_mode = 'nickname' AND display_name_ciphertext IS NOT NULL)))
    OR (privacy_state = 'PURGED' AND fan_message_ciphertext IS NULL AND display_name_ciphertext IS NULL
      AND encrypted_data_key IS NULL AND encryption_key_version IS NULL
      AND purge_requested_at IS NOT NULL AND purged_at IS NOT NULL AND purged_at >= purge_requested_at)
  ),
  CONSTRAINT support_intents_moderation_check CHECK (
    (moderation_status = 'PENDING'
      AND moderation_reason_code IS NULL AND moderation_decision_kind IS NULL
      AND moderation_reviewer_id IS NULL AND moderation_rule_version IS NULL
      AND moderation_evidence_id IS NULL AND reviewed_at IS NULL)
    OR (moderation_status = 'APPROVED' AND moderation_reason_code IS NULL
      AND moderation_decision_kind IS NOT NULL AND reviewed_at IS NOT NULL
      AND ((moderation_decision_kind = 'HUMAN' AND moderation_reviewer_id IS NOT NULL
        AND moderation_rule_version IS NULL AND moderation_evidence_id IS NULL)
      OR (moderation_decision_kind = 'AUTOMATED' AND moderation_reviewer_id IS NULL
        AND moderation_rule_version IS NOT NULL AND moderation_evidence_id IS NOT NULL)))
    OR (moderation_status IN ('REJECTED', 'REDACTED') AND moderation_reason_code IS NOT NULL
      AND moderation_decision_kind IS NOT NULL AND reviewed_at IS NOT NULL
      AND ((moderation_decision_kind = 'HUMAN' AND moderation_reviewer_id IS NOT NULL
        AND moderation_rule_version IS NULL AND moderation_evidence_id IS NULL)
      OR (moderation_decision_kind = 'AUTOMATED' AND moderation_reviewer_id IS NULL
        AND moderation_rule_version IS NOT NULL AND moderation_evidence_id IS NOT NULL)))
  ),
  CONSTRAINT support_intents_time_check CHECK (
    expires_at > created_at AND updated_at >= created_at
    AND (reviewed_at IS NULL OR reviewed_at >= created_at)
    AND (purge_requested_at IS NULL OR purge_requested_at >= created_at)
  )
);

CREATE TABLE moderation_evidence (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  evidence_version positive_version NOT NULL DEFAULT 1,
  support_intent_id uuid NOT NULL,
  support_intent_version positive_version NOT NULL,
  rule_version text NOT NULL CHECK (rule_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  content_ciphertext_sha256 sha256_hex NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'REDACTED')),
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  decided_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT moderation_evidence_support_intent_fk
    FOREIGN KEY (support_intent_id) REFERENCES support_intents(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT moderation_evidence_id_support_intent_unique UNIQUE (id, support_intent_id),
  CONSTRAINT moderation_evidence_decision_shape_check CHECK (
    (decision = 'APPROVED' AND reason_code IS NULL)
    OR (decision IN ('REJECTED', 'REDACTED') AND reason_code IS NOT NULL)
  )
);

ALTER TABLE support_intents
  ADD CONSTRAINT support_intents_moderation_evidence_fk
    FOREIGN KEY (moderation_evidence_id, id)
    REFERENCES moderation_evidence(id, support_intent_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE customer_contacts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  email_ciphertext ciphertext_bytes,
  encrypted_data_key ciphertext_bytes,
  encryption_key_version text CHECK (encryption_key_version IS NULL OR encryption_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  email_lookup_hmac bytea CHECK (email_lookup_hmac IS NULL OR octet_length(email_lookup_hmac) = 32),
  lookup_key_version text CHECK (lookup_key_version IS NULL OR lookup_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  retention_status text NOT NULL CHECK (retention_status IN ('ACTIVE', 'PURGE_PENDING', 'PURGED')),
  purge_requested_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT customer_contacts_retention_check CHECK (
    (retention_status = 'ACTIVE'
      AND email_ciphertext IS NOT NULL AND encrypted_data_key IS NOT NULL
      AND encryption_key_version IS NOT NULL AND email_lookup_hmac IS NOT NULL
      AND lookup_key_version IS NOT NULL AND purge_requested_at IS NULL AND purged_at IS NULL)
    OR (retention_status = 'PURGE_PENDING'
      AND email_ciphertext IS NOT NULL AND encrypted_data_key IS NOT NULL
      AND encryption_key_version IS NOT NULL AND email_lookup_hmac IS NOT NULL
      AND lookup_key_version IS NOT NULL AND purge_requested_at IS NOT NULL AND purged_at IS NULL)
    OR (retention_status = 'PURGED'
      AND email_ciphertext IS NULL AND encrypted_data_key IS NULL
      AND encryption_key_version IS NULL AND email_lookup_hmac IS NULL
      AND lookup_key_version IS NULL AND purge_requested_at IS NOT NULL
      AND purged_at IS NOT NULL AND purged_at >= purge_requested_at)
  )
);

CREATE TABLE idol_fulfillment_profiles (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  idol_id uuid NOT NULL REFERENCES idols(id) ON DELETE RESTRICT,
  profile_version positive_version NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'PURGED')),
  profile_ciphertext ciphertext_bytes,
  encrypted_data_key ciphertext_bytes,
  encryption_key_version text CHECK (encryption_key_version IS NULL OR encryption_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  created_by uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  superseded_at timestamptz,
  purged_at timestamptz,
  CONSTRAINT idol_fulfillment_profiles_id_idol_unique UNIQUE (id, idol_id),
  CONSTRAINT idol_fulfillment_profiles_version_unique UNIQUE (idol_id, profile_version),
  CONSTRAINT idol_fulfillment_profiles_state_shape_check CHECK (
    (status = 'ACTIVE' AND profile_ciphertext IS NOT NULL AND encrypted_data_key IS NOT NULL
      AND encryption_key_version IS NOT NULL AND superseded_at IS NULL AND purged_at IS NULL)
    OR (status = 'SUPERSEDED' AND profile_ciphertext IS NOT NULL AND encrypted_data_key IS NOT NULL
      AND encryption_key_version IS NOT NULL AND superseded_at IS NOT NULL AND purged_at IS NULL)
    OR (status = 'PURGED' AND profile_ciphertext IS NULL AND encrypted_data_key IS NULL
      AND encryption_key_version IS NULL AND purged_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idol_fulfillment_profiles_one_active_idx
  ON idol_fulfillment_profiles (idol_id) WHERE status = 'ACTIVE';

CREATE TABLE checkout_sessions (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL,
  cart_version positive_version NOT NULL,
  status text NOT NULL CHECK (status IN ('CREATED', 'READY', 'PAYMENT_PENDING', 'COMPLETED', 'EXPIRED')),
  market market_code NOT NULL,
  currency currency_code NOT NULL,
  quote_revision positive_version NOT NULL,
  quote_expires_at finite_timestamptz NOT NULL,
  subtotal_minor minor_amount NOT NULL,
  tax_amount_minor minor_amount NOT NULL DEFAULT 0,
  shipping_amount_minor minor_amount NOT NULL DEFAULT 0,
  fee_amount_minor minor_amount NOT NULL DEFAULT 0,
  discount_amount_minor minor_amount NOT NULL DEFAULT 0,
  total_amount_minor minor_amount NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at finite_timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT checkout_sessions_quote_unique UNIQUE (quote_id),
  CONSTRAINT checkout_sessions_id_quote_unique UNIQUE (id, quote_id),
  CONSTRAINT checkout_sessions_amount_check CHECK (
    total_amount_minor = subtotal_minor + tax_amount_minor + shipping_amount_minor + fee_amount_minor - discount_amount_minor
  ),
  CONSTRAINT checkout_sessions_expiry_check CHECK (
    quote_expires_at > created_at AND expires_at >= quote_expires_at AND updated_at >= created_at
  )
);

CREATE UNIQUE INDEX checkout_sessions_one_active_per_cart_idx
  ON checkout_sessions (cart_id)
  WHERE status IN ('CREATED', 'READY', 'PAYMENT_PENDING');

CREATE INDEX customer_contacts_lookup_idx
  ON customer_contacts (lookup_key_version, email_lookup_hmac)
  WHERE retention_status <> 'PURGED';

CREATE TABLE checkout_quote_lines (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  checkout_session_id uuid NOT NULL REFERENCES checkout_sessions(id) ON DELETE RESTRICT,
  checkout_quote_id uuid NOT NULL,
  cart_item_id uuid NOT NULL REFERENCES cart_items(id) ON DELETE RESTRICT,
  gift_variant_id uuid NOT NULL REFERENCES gift_variants(id) ON DELETE RESTRICT,
  price_id uuid NOT NULL REFERENCES prices(id) ON DELETE RESTRICT,
  price_revision positive_version NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_amount_minor minor_amount NOT NULL,
  line_subtotal_minor minor_amount NOT NULL,
  tax_amount_minor minor_amount NOT NULL DEFAULT 0,
  discount_amount_minor minor_amount NOT NULL DEFAULT 0,
  line_total_minor minor_amount NOT NULL,
  CONSTRAINT checkout_quote_lines_session_quote_fk
    FOREIGN KEY (checkout_session_id, checkout_quote_id)
    REFERENCES checkout_sessions(id, quote_id) ON DELETE RESTRICT,
  CONSTRAINT checkout_quote_lines_price_revision_fk
    FOREIGN KEY (price_id, price_revision, gift_variant_id)
    REFERENCES prices(id, revision, gift_variant_id) ON DELETE RESTRICT,
  CONSTRAINT checkout_quote_lines_session_cart_item_unique UNIQUE (checkout_session_id, cart_item_id),
  CONSTRAINT checkout_quote_lines_amount_check CHECK (
    line_subtotal_minor = unit_amount_minor * quantity
    AND line_total_minor = line_subtotal_minor + tax_amount_minor - discount_amount_minor
  )
);

CREATE TABLE inventory_reservations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  inventory_item_id uuid NOT NULL,
  gift_variant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  checkout_session_id uuid NOT NULL,
  checkout_quote_id uuid NOT NULL,
  cart_item_id uuid NOT NULL,
  locked_order_id uuid,
  quantity bigint NOT NULL CHECK (quantity > 0 AND quantity <= 9007199254740991),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  version positive_version NOT NULL DEFAULT 1,
  expires_at finite_timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  committed_at timestamptz,
  released_at timestamptz,
  expired_at timestamptz,
  CONSTRAINT inventory_reservations_balance_fk
    FOREIGN KEY (inventory_item_id, location_id)
    REFERENCES inventory_balances(inventory_item_id, location_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT inventory_reservations_item_variant_fk
    FOREIGN KEY (inventory_item_id, gift_variant_id)
    REFERENCES inventory_items(id, gift_variant_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_reservations_session_quote_fk
    FOREIGN KEY (checkout_session_id, checkout_quote_id)
    REFERENCES checkout_sessions(id, quote_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_reservations_cart_variant_fk
    FOREIGN KEY (cart_item_id, gift_variant_id)
    REFERENCES cart_items(id, gift_variant_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_reservations_identity_unique UNIQUE (id, inventory_item_id, location_id),
  CONSTRAINT inventory_reservations_status_time_check CHECK (
    (status = 'ACTIVE' AND committed_at IS NULL AND released_at IS NULL AND expired_at IS NULL)
    OR (status = 'COMMITTED' AND committed_at IS NOT NULL AND released_at IS NULL AND expired_at IS NULL)
    OR (status = 'RELEASED' AND committed_at IS NULL AND released_at IS NOT NULL AND expired_at IS NULL)
    OR (status = 'EXPIRED' AND committed_at IS NULL AND released_at IS NULL AND expired_at IS NOT NULL)
  ),
  CONSTRAINT inventory_reservations_time_check CHECK (
    expires_at > created_at AND updated_at >= created_at
    AND (committed_at IS NULL OR committed_at >= created_at)
    AND (released_at IS NULL OR released_at >= created_at)
    AND (expired_at IS NULL OR expired_at >= created_at)
  )
);

CREATE UNIQUE INDEX inventory_reservations_one_active_per_line_idx
  ON inventory_reservations (checkout_session_id, cart_item_id)
  WHERE status = 'ACTIVE';

CREATE INDEX inventory_reservations_active_expiry_idx
  ON inventory_reservations (expires_at)
  WHERE status = 'ACTIVE';

CREATE TABLE inventory_ledger (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  inventory_item_id uuid NOT NULL,
  location_id uuid NOT NULL,
  reservation_id uuid,
  balance_version_before bigint NOT NULL CHECK (balance_version_before BETWEEN 0 AND 9007199254740990),
  balance_version_after positive_version NOT NULL,
  delta_on_hand bigint NOT NULL CHECK (delta_on_hand BETWEEN -9007199254740991 AND 9007199254740991),
  delta_reserved bigint NOT NULL CHECK (delta_reserved BETWEEN -9007199254740991 AND 9007199254740991),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  source_type text NOT NULL CHECK (source_type IN ('RESERVATION', 'PAYMENT', 'EXPIRY', 'RECONCILE', 'ADJUSTMENT')),
  source_id uuid NOT NULL,
  idempotency_key idempotency_key_value NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('ADMIN', 'SYSTEM', 'IMPORT')),
  admin_identity_id uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  task_name text CHECK (task_name IS NULL OR length(task_name) BETWEEN 1 AND 128),
  import_batch_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT inventory_ledger_balance_fk
    FOREIGN KEY (inventory_item_id, location_id)
    REFERENCES inventory_balances(inventory_item_id, location_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT inventory_ledger_reservation_fk
    FOREIGN KEY (reservation_id, inventory_item_id, location_id)
    REFERENCES inventory_reservations(id, inventory_item_id, location_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT inventory_ledger_idempotency_unique UNIQUE (inventory_item_id, location_id, idempotency_key),
  CONSTRAINT inventory_ledger_balance_version_unique UNIQUE (inventory_item_id, location_id, balance_version_after),
  CONSTRAINT inventory_ledger_nonzero_check CHECK (
    delta_on_hand <> 0 OR delta_reserved <> 0 OR reason_code = 'INITIALIZE'
  ),
  CONSTRAINT inventory_ledger_version_step_check CHECK (balance_version_after = balance_version_before + 1),
  CONSTRAINT inventory_ledger_actor_check CHECK (
    (actor_kind = 'ADMIN' AND admin_identity_id IS NOT NULL AND task_name IS NULL AND import_batch_id IS NULL)
    OR (actor_kind = 'SYSTEM' AND admin_identity_id IS NULL AND task_name IS NOT NULL AND import_batch_id IS NULL)
    OR (actor_kind = 'IMPORT' AND admin_identity_id IS NULL AND task_name IS NULL AND import_batch_id IS NOT NULL)
  )
);

CREATE FUNCTION guard_cart_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'cart version must increment exactly once' USING ERRCODE = '23514';
  END IF;
  IF NEW.id <> OLD.id OR NEW.token_digest <> OLD.token_digest
     OR NEW.token_pepper_version <> OLD.token_pepper_version
     OR NEW.market <> OLD.market OR NEW.currency <> OLD.currency THEN
    RAISE EXCEPTION 'cart identity and commerce context are immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'ACTIVE' AND NEW.status IN ('LOCKED', 'EXPIRED'))
    OR (OLD.status = 'LOCKED' AND NEW.status IN ('CONVERTED', 'EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'invalid cart status transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_cart_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM carts WHERE id = OLD.cart_id FOR SHARE;
  IF parent_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'cart items are immutable after the cart leaves ACTIVE'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id <> OLD.id OR NEW.cart_id <> OLD.cart_id OR NEW.created_at <> OLD.created_at
     OR NEW.request_id <> OLD.request_id
     OR NEW.correlation_id <> OLD.correlation_id THEN
    RAISE EXCEPTION 'cart item ownership is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'cart item version must increment exactly once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_cart_item_commerce_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  invalid boolean;
BEGIN
  SELECT p.gift_variant_id <> NEW.gift_variant_id
         OR p.market <> c.market OR p.currency <> c.currency
    INTO invalid
    FROM carts c
    JOIN prices p ON p.id = NEW.observed_price_id
    WHERE c.id = NEW.cart_id;
  IF invalid IS NULL OR invalid THEN
    RAISE EXCEPTION 'cart item price must match its variant and cart commerce context'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_support_intent_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  private_content_changed boolean;
BEGIN
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'support intent version must increment exactly once' USING ERRCODE = '23514';
  END IF;
  IF NEW.id <> OLD.id OR NEW.cart_item_id <> OLD.cart_item_id OR NEW.idol_id <> OLD.idol_id
     OR NEW.created_presentation_locale <> OLD.created_presentation_locale
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'support intent ownership is immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    NEW.privacy_state = OLD.privacy_state
    OR (OLD.privacy_state = 'ACTIVE' AND NEW.privacy_state = 'PURGE_PENDING')
    OR (OLD.privacy_state = 'PURGE_PENDING' AND NEW.privacy_state = 'PURGED')
  ) THEN
    RAISE EXCEPTION 'invalid support intent privacy transition' USING ERRCODE = '23514';
  END IF;
  private_content_changed := (
    NEW.fan_message_ciphertext IS DISTINCT FROM OLD.fan_message_ciphertext
    OR NEW.display_mode <> OLD.display_mode
    OR NEW.display_name_ciphertext IS DISTINCT FROM OLD.display_name_ciphertext
    OR NEW.encrypted_data_key IS DISTINCT FROM OLD.encrypted_data_key
    OR NEW.encryption_key_version IS DISTINCT FROM OLD.encryption_key_version
    OR NEW.fan_message_locale <> OLD.fan_message_locale
  );
  IF OLD.status <> 'ACTIVE' AND private_content_changed
     AND NOT (OLD.privacy_state = 'PURGE_PENDING' AND NEW.privacy_state = 'PURGED') THEN
    RAISE EXCEPTION 'locked support intent private content is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'ACTIVE' AND private_content_changed AND NEW.moderation_status <> 'PENDING' THEN
    RAISE EXCEPTION 'edited private content must return to pending moderation'
      USING ERRCODE = '23514';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'ACTIVE' AND NEW.status IN ('CHECKOUT_LOCKED', 'EXPIRED', 'CANCELED'))
    OR (OLD.status = 'CHECKOUT_LOCKED' AND NEW.status IN ('CONVERTED', 'CANCELED'))
  ) THEN
    RAISE EXCEPTION 'invalid support intent status transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_support_intent_moderation_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  evidence public.moderation_evidence%ROWTYPE;
  new_decision boolean := TG_OP = 'INSERT';
BEGIN
  IF NEW.moderation_decision_kind <> 'AUTOMATED' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    new_decision :=
      OLD.moderation_status IS DISTINCT FROM NEW.moderation_status
      OR OLD.moderation_reason_code IS DISTINCT FROM NEW.moderation_reason_code
      OR OLD.moderation_decision_kind IS DISTINCT FROM NEW.moderation_decision_kind
      OR OLD.moderation_rule_version IS DISTINCT FROM NEW.moderation_rule_version
      OR OLD.moderation_evidence_id IS DISTINCT FROM NEW.moderation_evidence_id
      OR OLD.reviewed_at IS DISTINCT FROM NEW.reviewed_at;
  END IF;

  SELECT candidate.* INTO evidence
  FROM public.moderation_evidence candidate
  WHERE candidate.id = NEW.moderation_evidence_id
    AND candidate.support_intent_id = NEW.id;

  IF evidence.id IS NULL
     OR evidence.support_intent_version > NEW.version
     OR evidence.rule_version <> NEW.moderation_rule_version
     OR evidence.decision <> NEW.moderation_status
     OR evidence.reason_code IS DISTINCT FROM NEW.moderation_reason_code
     OR evidence.decided_at <> NEW.reviewed_at THEN
    RAISE EXCEPTION 'automated moderation must bind exact immutable evidence'
      USING ERRCODE = '23514';
  END IF;

  IF new_decision AND evidence.support_intent_version <> NEW.version THEN
    RAISE EXCEPTION 'automated moderation evidence must bind the decided support intent version'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW.privacy_state <> 'PURGED' OR new_decision)
     AND (
       NEW.fan_message_ciphertext IS NULL
       OR evidence.content_ciphertext_sha256 <>
          pg_catalog.encode(pg_catalog.sha256(NEW.fan_message_ciphertext), 'hex')
     ) THEN
    RAISE EXCEPTION 'automated moderation evidence must bind the current encrypted message'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE FUNCTION guard_fulfillment_profile_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.idol_id <> OLD.idol_id
     OR NEW.profile_version <> OLD.profile_version OR NEW.created_by <> OLD.created_by
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'fulfillment profile identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')
    OR (OLD.status = 'SUPERSEDED' AND NEW.status = 'PURGED')
  ) THEN
    RAISE EXCEPTION 'invalid fulfillment profile transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'PURGED' AND (
    NEW.profile_ciphertext IS DISTINCT FROM OLD.profile_ciphertext
    OR NEW.encrypted_data_key IS DISTINCT FROM OLD.encrypted_data_key
    OR NEW.encryption_key_version IS DISTINCT FROM OLD.encryption_key_version
  ) THEN
    RAISE EXCEPTION 'fulfillment profile material is immutable; create a new version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_checkout_session_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'checkout quote and commerce context are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'CREATED' AND NEW.status IN ('READY', 'EXPIRED'))
    OR (OLD.status = 'READY' AND NEW.status IN ('PAYMENT_PENDING', 'EXPIRED'))
    OR (OLD.status = 'PAYMENT_PENDING' AND NEW.status IN ('COMPLETED', 'EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'invalid checkout session status transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_customer_contact_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'customer contact identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    NEW.retention_status = OLD.retention_status
    OR (OLD.retention_status = 'ACTIVE' AND NEW.retention_status = 'PURGE_PENDING')
    OR (OLD.retention_status = 'PURGE_PENDING' AND NEW.retention_status = 'PURGED')
  ) THEN
    RAISE EXCEPTION 'invalid customer contact retention transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.retention_status = 'ACTIVE' AND NEW.retention_status = 'ACTIVE'
     AND (to_jsonb(NEW) - 'email_ciphertext' - 'encrypted_data_key' - 'encryption_key_version'
          - 'email_lookup_hmac' - 'lookup_key_version') IS DISTINCT FROM
         (to_jsonb(OLD) - 'email_ciphertext' - 'encrypted_data_key' - 'encryption_key_version'
          - 'email_lookup_hmac' - 'lookup_key_version') THEN
    RAISE EXCEPTION 'only encrypted contact material may rotate while active'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_inventory_reservation_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'new reservation must start ACTIVE at version 1'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.inventory_items item
      JOIN public.gift_variants variant ON variant.id = item.gift_variant_id
      WHERE item.id = NEW.inventory_item_id
        AND item.gift_variant_id = NEW.gift_variant_id
        AND item.policy = 'TRACKED'
        AND variant.inventory_policy = 'TRACKED'
    ) THEN
      RAISE EXCEPTION 'only TRACKED inventory may be reserved'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'reservation version must increment exactly once' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'version' - 'updated_at' - 'committed_at' - 'released_at' - 'expired_at' - 'locked_order_id')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'version' - 'updated_at' - 'committed_at' - 'released_at' - 'expired_at' - 'locked_order_id') THEN
    RAISE EXCEPTION 'reservation identity and quantity are immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'ACTIVE' AND NEW.status IN ('COMMITTED', 'RELEASED', 'EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'invalid reservation status transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION assert_inventory_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_item uuid;
  target_location uuid;
  balance_on_hand bigint;
  balance_reserved bigint;
  balance_version bigint;
  ledger_on_hand numeric;
  ledger_reserved numeric;
  ledger_count bigint;
  first_version bigint;
  last_version bigint;
  active_reserved numeric;
BEGIN
  target_item := COALESCE(
    (to_jsonb(NEW) ->> 'inventory_item_id')::uuid,
    (to_jsonb(OLD) ->> 'inventory_item_id')::uuid
  );
  target_location := COALESCE(
    (to_jsonb(NEW) ->> 'location_id')::uuid,
    (to_jsonb(OLD) ->> 'location_id')::uuid
  );

  SELECT on_hand, reserved, version INTO balance_on_hand, balance_reserved, balance_version
    FROM inventory_balances
    WHERE inventory_item_id = target_item AND location_id = target_location
    FOR UPDATE;

  IF balance_on_hand IS NULL THEN
    RAISE EXCEPTION 'inventory balance is missing' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(sum(delta_on_hand), 0), COALESCE(sum(delta_reserved), 0),
         count(*), min(balance_version_before), max(balance_version_after)
    INTO ledger_on_hand, ledger_reserved, ledger_count, first_version, last_version
    FROM inventory_ledger
    WHERE inventory_item_id = target_item AND location_id = target_location;

  SELECT COALESCE(sum(quantity), 0) INTO active_reserved
    FROM inventory_reservations
    WHERE inventory_item_id = target_item AND location_id = target_location
      AND status = 'ACTIVE';

  IF ledger_on_hand <> balance_on_hand
     OR ledger_reserved <> balance_reserved
     OR ledger_count <> balance_version
     OR first_version IS DISTINCT FROM 0
     OR last_version IS DISTINCT FROM balance_version
     OR active_reserved <> balance_reserved THEN
    RAISE EXCEPTION 'inventory balance, ledger, and active reservations diverge'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_inventory_reservation_ledger_semantics()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  linked_count integer;
  creation_count integer;
  terminal_count integer;
BEGIN
  SELECT count(*),
    count(*) FILTER (WHERE
      delta_on_hand = 0
      AND delta_reserved = NEW.quantity
      AND source_type = 'RESERVATION'
      AND source_id = NEW.id
    ),
    count(*) FILTER (WHERE
      (NEW.status = 'COMMITTED'
        AND delta_on_hand = -NEW.quantity AND delta_reserved = -NEW.quantity
        AND source_type = 'PAYMENT' AND source_id = NEW.locked_order_id)
      OR (NEW.status = 'RELEASED'
        AND delta_on_hand = 0 AND delta_reserved = -NEW.quantity
        AND source_type = 'PAYMENT' AND source_id = NEW.locked_order_id)
      OR (NEW.status = 'EXPIRED'
        AND delta_on_hand = 0 AND delta_reserved = -NEW.quantity
        AND source_type = 'EXPIRY' AND source_id = NEW.id)
    )
    INTO linked_count, creation_count, terminal_count
    FROM inventory_ledger
    WHERE reservation_id = NEW.id
      AND inventory_item_id = NEW.inventory_item_id
      AND location_id = NEW.location_id;

  IF creation_count <> 1
     OR (NEW.status = 'ACTIVE' AND linked_count <> 1)
     OR (NEW.status <> 'ACTIVE' AND (linked_count <> 2 OR terminal_count <> 1))
     OR (NEW.status IN ('COMMITTED', 'RELEASED') AND NEW.locked_order_id IS NULL) THEN
    RAISE EXCEPTION 'reservation state must bind exact inventory ledger deltas'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_cart_support_intent_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  item_id uuid := COALESCE(
    (to_jsonb(NEW) ->> 'cart_item_id')::uuid,
    (to_jsonb(OLD) ->> 'cart_item_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid,
    (to_jsonb(OLD) ->> 'id')::uuid
  );
  item_mode text;
  item_has_message boolean;
  intent_mode text;
  intent_has_message boolean;
  is_eligible boolean;
  intent_privacy_state text;
BEGIN
  SELECT display_mode, has_fan_message INTO item_mode, item_has_message
    FROM cart_items WHERE id = item_id;
  SELECT display_mode, fan_message_ciphertext IS NOT NULL, privacy_state
    INTO intent_mode, intent_has_message, intent_privacy_state
    FROM support_intents WHERE cart_item_id = item_id;
  SELECT EXISTS (
    SELECT 1
    FROM cart_items ci
    JOIN support_intents si ON si.cart_item_id = ci.id
    JOIN gift_variant_idol_eligibility eligibility
      ON eligibility.gift_variant_id = ci.gift_variant_id
     AND eligibility.idol_id = si.idol_id
    WHERE ci.id = item_id
  ) INTO is_eligible;

  IF item_mode IS NULL OR intent_mode IS NULL
     OR item_mode <> intent_mode
     OR (intent_privacy_state <> 'PURGED' AND item_has_message <> intent_has_message)
     OR NOT is_eligible THEN
    RAISE EXCEPTION 'cart item and support intent privacy projection diverge'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_checkout_quote_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  session_id uuid := COALESCE(
    (to_jsonb(NEW) ->> 'checkout_session_id')::uuid,
    (to_jsonb(OLD) ->> 'checkout_session_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid,
    (to_jsonb(OLD) ->> 'id')::uuid
  );
  session_row checkout_sessions%ROWTYPE;
  line_count bigint;
  invalid_count bigint;
  line_subtotal numeric;
  line_tax numeric;
  line_discount numeric;
  line_total numeric;
BEGIN
  SELECT * INTO session_row FROM checkout_sessions WHERE id = session_id;
  IF session_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE
           q.checkout_quote_id <> session_row.quote_id
           OR ci.cart_id <> session_row.cart_id
           OR ci.gift_variant_id <> q.gift_variant_id
           OR ci.quantity <> q.quantity
           OR p.market <> session_row.market
           OR p.currency <> session_row.currency
           OR p.amount_minor <> q.unit_amount_minor
         ),
         COALESCE(sum(q.line_subtotal_minor), 0),
         COALESCE(sum(q.tax_amount_minor), 0),
         COALESCE(sum(q.discount_amount_minor), 0),
         COALESCE(sum(q.line_total_minor), 0)
    INTO line_count, invalid_count, line_subtotal, line_tax, line_discount, line_total
    FROM checkout_quote_lines q
    JOIN cart_items ci ON ci.id = q.cart_item_id
    JOIN prices p ON p.id = q.price_id
    WHERE q.checkout_session_id = session_id;

  IF line_count = 0 OR invalid_count <> 0
     OR line_subtotal <> session_row.subtotal_minor
     OR line_tax <> session_row.tax_amount_minor
     OR line_discount <> session_row.discount_amount_minor
     OR line_total + session_row.shipping_amount_minor + session_row.fee_amount_minor
        <> session_row.total_amount_minor THEN
    RAISE EXCEPTION 'checkout quote lines do not match the immutable session snapshot'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER carts_transition_trigger
  BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION guard_cart_transition();

CREATE TRIGGER cart_items_mutation_trigger
  BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION guard_cart_item_mutation();
CREATE TRIGGER cart_items_commerce_context_trigger
  BEFORE INSERT OR UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION validate_cart_item_commerce_context();

CREATE TRIGGER support_intents_transition_trigger
  BEFORE UPDATE ON support_intents
  FOR EACH ROW EXECUTE FUNCTION guard_support_intent_transition();
CREATE TRIGGER support_intents_delete_guard_trigger
  BEFORE DELETE ON support_intents
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER support_intents_no_truncate_trigger
  BEFORE TRUNCATE ON support_intents
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER support_intents_moderation_evidence_trigger
  AFTER INSERT OR UPDATE ON support_intents
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_support_intent_moderation_evidence();

CREATE TRIGGER moderation_evidence_append_only_trigger
  BEFORE UPDATE OR DELETE ON moderation_evidence
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER moderation_evidence_no_truncate_trigger
  BEFORE TRUNCATE ON moderation_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER customer_contacts_transition_trigger
  BEFORE UPDATE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION guard_customer_contact_transition();
CREATE TRIGGER customer_contacts_delete_guard_trigger
  BEFORE DELETE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER customer_contacts_no_truncate_trigger
  BEFORE TRUNCATE ON customer_contacts
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER idol_fulfillment_profiles_transition_trigger
  BEFORE UPDATE ON idol_fulfillment_profiles
  FOR EACH ROW EXECUTE FUNCTION guard_fulfillment_profile_transition();
CREATE TRIGGER idol_fulfillment_profiles_delete_guard_trigger
  BEFORE DELETE ON idol_fulfillment_profiles
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER idol_fulfillment_profiles_no_truncate_trigger
  BEFORE TRUNCATE ON idol_fulfillment_profiles
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER checkout_sessions_transition_trigger
  BEFORE UPDATE ON checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_checkout_session_transition();
CREATE TRIGGER checkout_quote_lines_append_only_trigger
  BEFORE UPDATE OR DELETE ON checkout_quote_lines
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER checkout_quote_lines_no_truncate_trigger
  BEFORE TRUNCATE ON checkout_quote_lines
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER inventory_reservations_transition_trigger
  BEFORE INSERT OR UPDATE ON inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_inventory_reservation_transition();

CREATE TRIGGER inventory_ledger_append_only_trigger
  BEFORE UPDATE OR DELETE ON inventory_ledger
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER inventory_ledger_no_truncate_trigger
  BEFORE TRUNCATE ON inventory_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

CREATE CONSTRAINT TRIGGER inventory_balance_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON inventory_balances
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_inventory_consistency();
CREATE CONSTRAINT TRIGGER inventory_reservation_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON inventory_reservations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_inventory_consistency();
CREATE CONSTRAINT TRIGGER inventory_reservation_ledger_semantics_trigger
  AFTER INSERT OR UPDATE ON inventory_reservations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_inventory_reservation_ledger_semantics();
CREATE CONSTRAINT TRIGGER inventory_ledger_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON inventory_ledger
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_inventory_consistency();

CREATE CONSTRAINT TRIGGER cart_item_support_intent_consistency_trigger
  AFTER INSERT OR UPDATE ON cart_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_cart_support_intent_consistency();
CREATE CONSTRAINT TRIGGER support_intent_cart_item_consistency_trigger
  AFTER INSERT OR UPDATE ON support_intents
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_cart_support_intent_consistency();

CREATE CONSTRAINT TRIGGER checkout_session_quote_consistency_trigger
  AFTER INSERT OR UPDATE ON checkout_sessions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_checkout_quote_consistency();
CREATE CONSTRAINT TRIGGER checkout_line_quote_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON checkout_quote_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_checkout_quote_consistency();
