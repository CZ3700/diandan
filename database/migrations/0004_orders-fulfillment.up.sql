SET search_path = public;

CREATE TABLE orders (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  public_order_id uuid NOT NULL,
  checkout_session_id uuid NOT NULL,
  checkout_quote_id uuid NOT NULL,
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE RESTRICT,
  customer_contact_id uuid NOT NULL REFERENCES customer_contacts(id) ON DELETE RESTRICT,
  presentation_locale supported_locale NOT NULL,
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
  order_status text NOT NULL CHECK (order_status IN ('DRAFT', 'PENDING_PAYMENT', 'OPEN', 'CLOSED', 'CANCELED')),
  payment_status text NOT NULL CHECK (payment_status IN ('UNPAID', 'PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')),
  dispute_status text NOT NULL CHECK (dispute_status IN ('NONE', 'OPEN', 'WON', 'LOST')),
  fulfillment_status text NOT NULL CHECK (fulfillment_status IN ('PENDING', 'PREPARING', 'DELIVERED', 'ON_HOLD', 'CANCELED')),
  current_payment_attempt_id uuid,
  version positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT orders_public_order_id_unique UNIQUE (public_order_id),
  CONSTRAINT orders_checkout_session_unique UNIQUE (checkout_session_id),
  CONSTRAINT orders_session_quote_fk
    FOREIGN KEY (checkout_session_id, checkout_quote_id)
    REFERENCES checkout_sessions(id, quote_id) ON DELETE RESTRICT,
  CONSTRAINT orders_id_cart_unique UNIQUE (id, cart_id),
  CONSTRAINT orders_id_checkout_session_unique UNIQUE (id, checkout_session_id),
  CONSTRAINT orders_id_public_order_unique UNIQUE (id, public_order_id),
  CONSTRAINT orders_payment_amount_binding_unique UNIQUE (id, currency, total_amount_minor),
  CONSTRAINT orders_amount_check CHECK (
    total_amount_minor::numeric = subtotal_minor::numeric + tax_amount_minor::numeric
      + shipping_amount_minor::numeric + fee_amount_minor::numeric - discount_amount_minor::numeric
  ),
  CONSTRAINT orders_time_check CHECK (
    quote_expires_at > created_at AND updated_at >= created_at
  ),
  CONSTRAINT orders_state_shape_check CHECK (
    (order_status = 'DRAFT' AND payment_status = 'UNPAID' AND current_payment_attempt_id IS NULL
      AND dispute_status = 'NONE' AND fulfillment_status = 'PENDING')
    OR (order_status = 'PENDING_PAYMENT' AND payment_status IN ('UNPAID', 'PENDING')
      AND dispute_status = 'NONE' AND fulfillment_status = 'PENDING'
      AND (payment_status = 'UNPAID' OR current_payment_attempt_id IS NOT NULL))
    OR (order_status IN ('OPEN', 'CLOSED')
      AND payment_status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
      AND current_payment_attempt_id IS NOT NULL)
    OR (order_status = 'CANCELED' AND payment_status IN ('UNPAID', 'PENDING')
      AND dispute_status = 'NONE' AND fulfillment_status IN ('PENDING', 'CANCELED'))
  ),
  CONSTRAINT orders_dispute_payment_check CHECK (
    dispute_status = 'NONE'
    OR (order_status IN ('OPEN', 'CLOSED')
      AND payment_status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'))
  ),
  CONSTRAINT orders_closed_fulfillment_check CHECK (
    order_status <> 'CLOSED' OR fulfillment_status IN ('DELIVERED', 'CANCELED')
  )
);

ALTER TABLE carts
  ADD COLUMN locked_order_id uuid,
  ADD CONSTRAINT carts_locked_order_owner_fk
    FOREIGN KEY (locked_order_id, id) REFERENCES orders(id, cart_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT carts_locked_order_shape_check CHECK (
    (status = 'ACTIVE' AND locked_order_id IS NULL)
    OR (status IN ('LOCKED', 'CONVERTED') AND locked_order_id IS NOT NULL)
    OR status = 'EXPIRED'
  );

ALTER TABLE inventory_reservations
  ADD CONSTRAINT inventory_reservations_locked_order_required_check
    CHECK (locked_order_id IS NOT NULL),
  ADD CONSTRAINT inventory_reservations_locked_order_session_fk
    FOREIGN KEY (locked_order_id, checkout_session_id)
    REFERENCES orders(id, checkout_session_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE order_items (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  cart_item_id uuid NOT NULL REFERENCES cart_items(id) ON DELETE RESTRICT,
  support_intent_id uuid NOT NULL REFERENCES support_intents(id) ON DELETE RESTRICT,
  idol_id uuid NOT NULL REFERENCES idols(id) ON DELETE RESTRICT,
  idol_handle text NOT NULL CHECK (
    idol_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(idol_handle) <= 128
  ),
  idol_display_name text NOT NULL CHECK (length(idol_display_name) BETWEEN 1 AND 40),
  idol_translation_revision_id uuid NOT NULL REFERENCES idol_revision_translations(id) ON DELETE RESTRICT,
  idol_translation_requested_locale supported_locale NOT NULL,
  idol_translation_resolved_locale supported_locale NOT NULL,
  idol_translation_fallback_used boolean NOT NULL,
  idol_portrait_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  idol_portrait_checksum_sha256 sha256_hex NOT NULL,
  idol_portrait_object_key media_object_key NOT NULL,
  idol_portrait_metadata_revision_id uuid NOT NULL REFERENCES media_metadata_revisions(id) ON DELETE RESTRICT,
  idol_portrait_alt text NOT NULL CHECK (length(idol_portrait_alt) BETWEEN 1 AND 300),
  idol_portrait_alt_translation_revision_id uuid NOT NULL REFERENCES media_metadata_revision_translations(id) ON DELETE RESTRICT,
  idol_portrait_alt_requested_locale supported_locale NOT NULL,
  idol_portrait_alt_resolved_locale supported_locale NOT NULL,
  idol_portrait_alt_fallback_used boolean NOT NULL,
  gift_id uuid NOT NULL REFERENCES gifts(id) ON DELETE RESTRICT,
  gift_variant_id uuid NOT NULL,
  gift_title text NOT NULL CHECK (length(gift_title) BETWEEN 1 AND 160),
  gift_translation_revision_id uuid NOT NULL REFERENCES gift_revision_translations(id) ON DELETE RESTRICT,
  gift_translation_requested_locale supported_locale NOT NULL,
  gift_translation_resolved_locale supported_locale NOT NULL,
  gift_translation_fallback_used boolean NOT NULL,
  gift_image_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  gift_image_checksum_sha256 sha256_hex NOT NULL,
  gift_image_object_key media_object_key NOT NULL,
  gift_image_metadata_revision_id uuid NOT NULL REFERENCES media_metadata_revisions(id) ON DELETE RESTRICT,
  gift_image_alt text NOT NULL CHECK (length(gift_image_alt) BETWEEN 1 AND 300),
  gift_image_alt_translation_revision_id uuid NOT NULL REFERENCES media_metadata_revision_translations(id) ON DELETE RESTRICT,
  gift_image_alt_requested_locale supported_locale NOT NULL,
  gift_image_alt_resolved_locale supported_locale NOT NULL,
  gift_image_alt_fallback_used boolean NOT NULL,
  price_id uuid NOT NULL,
  price_revision positive_version NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_amount_minor minor_amount NOT NULL,
  line_subtotal_minor minor_amount NOT NULL,
  tax_amount_minor minor_amount NOT NULL DEFAULT 0,
  discount_amount_minor minor_amount NOT NULL DEFAULT 0,
  line_total_minor minor_amount NOT NULL,
  currency currency_code NOT NULL,
  display_mode text NOT NULL CHECK (display_mode IN ('anonymous', 'nickname')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT order_items_cart_item_unique UNIQUE (cart_item_id),
  CONSTRAINT order_items_support_intent_unique UNIQUE (support_intent_id),
  CONSTRAINT order_items_id_order_unique UNIQUE (id, order_id),
  CONSTRAINT order_items_variant_owner_fk
    FOREIGN KEY (gift_variant_id, gift_id)
    REFERENCES gift_variants(id, gift_id) ON DELETE RESTRICT,
  CONSTRAINT order_items_price_revision_variant_fk
    FOREIGN KEY (price_id, price_revision, gift_variant_id)
    REFERENCES prices(id, revision, gift_variant_id) ON DELETE RESTRICT,
  CONSTRAINT order_items_line_amount_check CHECK (
    line_subtotal_minor::numeric = unit_amount_minor::numeric * quantity::numeric
    AND line_total_minor::numeric = line_subtotal_minor::numeric
      + tax_amount_minor::numeric - discount_amount_minor::numeric
  ),
  CONSTRAINT order_items_idol_translation_locale_check CHECK (
    (NOT idol_translation_fallback_used
      AND idol_translation_requested_locale = idol_translation_resolved_locale)
    OR (idol_translation_fallback_used
      AND idol_translation_requested_locale <> 'en'
      AND idol_translation_resolved_locale = 'en')
  ),
  CONSTRAINT order_items_idol_alt_translation_locale_check CHECK (
    (NOT idol_portrait_alt_fallback_used
      AND idol_portrait_alt_requested_locale = idol_portrait_alt_resolved_locale)
    OR (idol_portrait_alt_fallback_used
      AND idol_portrait_alt_requested_locale <> 'en'
      AND idol_portrait_alt_resolved_locale = 'en')
  ),
  CONSTRAINT order_items_gift_translation_locale_check CHECK (
    (NOT gift_translation_fallback_used
      AND gift_translation_requested_locale = gift_translation_resolved_locale)
    OR (gift_translation_fallback_used
      AND gift_translation_requested_locale <> 'en'
      AND gift_translation_resolved_locale = 'en')
  ),
  CONSTRAINT order_items_gift_alt_translation_locale_check CHECK (
    (NOT gift_image_alt_fallback_used
      AND gift_image_alt_requested_locale = gift_image_alt_resolved_locale)
    OR (gift_image_alt_fallback_used
      AND gift_image_alt_requested_locale <> 'en'
      AND gift_image_alt_resolved_locale = 'en')
  )
);

CREATE INDEX order_items_order_created_idx ON order_items (order_id, created_at, id);

CREATE TABLE policy_acceptances (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  policy_key text NOT NULL,
  policy_revision_id uuid NOT NULL,
  policy_translation_revision_id uuid NOT NULL,
  locale supported_locale NOT NULL,
  accepted_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT policy_acceptances_order_policy_unique UNIQUE (order_id, policy_key),
  CONSTRAINT policy_acceptances_revision_owner_fk
    FOREIGN KEY (policy_revision_id, policy_key)
    REFERENCES policy_revisions(id, policy_key) ON DELETE RESTRICT,
  CONSTRAINT policy_acceptances_translation_owner_fk
    FOREIGN KEY (policy_translation_revision_id, policy_revision_id)
    REFERENCES policy_revision_translations(id, policy_revision_id) ON DELETE RESTRICT,
  CONSTRAINT policy_acceptances_time_check CHECK (accepted_at <= recorded_at)
);

CREATE TABLE order_events (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  sequence positive_version NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'ORDER_CREATED', 'LIFECYCLE_CHANGED', 'PAYMENT_STATUS_CHANGED',
    'DISPUTE_STATUS_CHANGED', 'FULFILLMENT_AGGREGATE_CHANGED',
    'PAYMENT_ATTEMPT_BOUND', 'LATE_PAYMENT_RECOVERED'
  )),
  from_order_status text CHECK (from_order_status IS NULL OR from_order_status IN ('DRAFT', 'PENDING_PAYMENT', 'OPEN', 'CLOSED', 'CANCELED')),
  to_order_status text NOT NULL CHECK (to_order_status IN ('DRAFT', 'PENDING_PAYMENT', 'OPEN', 'CLOSED', 'CANCELED')),
  from_payment_status text CHECK (from_payment_status IS NULL OR from_payment_status IN ('UNPAID', 'PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')),
  to_payment_status text NOT NULL CHECK (to_payment_status IN ('UNPAID', 'PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')),
  from_dispute_status text CHECK (from_dispute_status IS NULL OR from_dispute_status IN ('NONE', 'OPEN', 'WON', 'LOST')),
  to_dispute_status text NOT NULL CHECK (to_dispute_status IN ('NONE', 'OPEN', 'WON', 'LOST')),
  from_fulfillment_status text CHECK (from_fulfillment_status IS NULL OR from_fulfillment_status IN ('PENDING', 'PREPARING', 'DELIVERED', 'ON_HOLD', 'CANCELED')),
  to_fulfillment_status text NOT NULL CHECK (to_fulfillment_status IN ('PENDING', 'PREPARING', 'DELIVERED', 'ON_HOLD', 'CANCELED')),
  from_payment_attempt_id uuid,
  to_payment_attempt_id uuid,
  authority_kind text NOT NULL CHECK (authority_kind IN ('CHECKOUT', 'PROVIDER_EVIDENCE', 'REFUND_AGGREGATE', 'FULFILLMENT', 'ADMIN', 'SYSTEM')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  admin_identity_id uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  audit_log_id uuid REFERENCES audit_logs(id) ON DELETE RESTRICT,
  provider_event_id uuid,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT order_events_sequence_unique UNIQUE (order_id, sequence),
  CONSTRAINT order_events_origin_shape_check CHECK (
    (sequence = 1 AND event_type = 'ORDER_CREATED'
      AND from_order_status IS NULL AND from_payment_status IS NULL
      AND from_dispute_status IS NULL AND from_fulfillment_status IS NULL
      AND from_payment_attempt_id IS NULL)
    OR (sequence > 1 AND event_type <> 'ORDER_CREATED'
      AND from_order_status IS NOT NULL AND from_payment_status IS NOT NULL
      AND from_dispute_status IS NOT NULL AND from_fulfillment_status IS NOT NULL)
  ),
  CONSTRAINT order_events_authority_shape_check CHECK (
    (authority_kind = 'ADMIN' AND admin_identity_id IS NOT NULL AND audit_log_id IS NOT NULL)
    OR (authority_kind = 'PROVIDER_EVIDENCE' AND admin_identity_id IS NULL AND provider_event_id IS NOT NULL)
    OR (authority_kind IN ('CHECKOUT', 'REFUND_AGGREGATE', 'FULFILLMENT', 'SYSTEM')
      AND admin_identity_id IS NULL AND provider_event_id IS NULL)
  )
);

CREATE TABLE order_access_tokens (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  token_digest bytea NOT NULL CHECK (octet_length(token_digest) = 32),
  token_pepper_version text NOT NULL CHECK (token_pepper_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'EXCHANGED', 'REVOKED', 'EXPIRED')),
  version positive_version NOT NULL DEFAULT 1,
  expires_at finite_timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  exchanged_at timestamptz,
  revoked_at timestamptz,
  expired_at timestamptz,
  CONSTRAINT order_access_tokens_digest_unique UNIQUE (token_pepper_version, token_digest),
  CONSTRAINT order_access_tokens_time_check CHECK (expires_at > created_at),
  CONSTRAINT order_access_tokens_status_time_check CHECK (
    (status = 'ACTIVE' AND exchanged_at IS NULL AND revoked_at IS NULL AND expired_at IS NULL)
    OR (status = 'EXCHANGED' AND exchanged_at IS NOT NULL AND revoked_at IS NULL AND expired_at IS NULL)
    OR (status = 'REVOKED' AND exchanged_at IS NULL AND revoked_at IS NOT NULL AND expired_at IS NULL)
    OR (status = 'EXPIRED' AND exchanged_at IS NULL AND revoked_at IS NULL AND expired_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX order_access_tokens_one_active_per_order_idx
  ON order_access_tokens (order_id) WHERE status = 'ACTIVE';
CREATE INDEX order_access_tokens_active_expiry_idx
  ON order_access_tokens (expires_at) WHERE status = 'ACTIVE';

CREATE TABLE order_access_sessions (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  order_id uuid NOT NULL,
  public_order_id uuid NOT NULL,
  exchanged_token_id uuid NOT NULL REFERENCES order_access_tokens(id) ON DELETE RESTRICT,
  session_token_digest bytea NOT NULL CHECK (octet_length(session_token_digest) = 32),
  token_pepper_version text NOT NULL CHECK (token_pepper_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  version positive_version NOT NULL DEFAULT 1,
  expires_at finite_timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  revoked_at timestamptz,
  expired_at timestamptz,
  CONSTRAINT order_access_sessions_order_public_fk
    FOREIGN KEY (order_id, public_order_id)
    REFERENCES orders(id, public_order_id) ON DELETE RESTRICT,
  CONSTRAINT order_access_sessions_token_unique UNIQUE (exchanged_token_id),
  CONSTRAINT order_access_sessions_digest_unique UNIQUE (token_pepper_version, session_token_digest),
  CONSTRAINT order_access_sessions_time_check CHECK (
    expires_at > created_at AND last_seen_at >= created_at AND last_seen_at <= expires_at
  ),
  CONSTRAINT order_access_sessions_status_time_check CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL AND expired_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL AND expired_at IS NULL)
    OR (status = 'EXPIRED' AND revoked_at IS NULL AND expired_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX order_access_sessions_one_active_per_order_idx
  ON order_access_sessions (order_id) WHERE status = 'ACTIVE';
CREATE INDEX order_access_sessions_active_expiry_idx
  ON order_access_sessions (expires_at) WHERE status = 'ACTIVE';

CREATE TABLE fulfillments (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  order_item_id uuid NOT NULL,
  idol_id uuid NOT NULL REFERENCES idols(id) ON DELETE RESTRICT,
  fulfillment_profile_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'PREPARING', 'DELIVERED', 'ON_HOLD', 'CANCELED')),
  version positive_version NOT NULL DEFAULT 1,
  hold_reason_code text CHECK (hold_reason_code IS NULL OR hold_reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  prepared_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fulfillments_order_item_unique UNIQUE (order_item_id),
  CONSTRAINT fulfillments_id_order_unique UNIQUE (id, order_id),
  CONSTRAINT fulfillments_order_item_owner_fk
    FOREIGN KEY (order_item_id, order_id)
    REFERENCES order_items(id, order_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fulfillments_profile_owner_fk
    FOREIGN KEY (fulfillment_profile_id, idol_id)
    REFERENCES idol_fulfillment_profiles(id, idol_id) ON DELETE RESTRICT,
  CONSTRAINT fulfillments_status_shape_check CHECK (
    (status IN ('PENDING', 'PREPARING', 'DELIVERED') AND hold_reason_code IS NULL)
    OR (status IN ('ON_HOLD', 'CANCELED') AND hold_reason_code IS NOT NULL)
  ),
  CONSTRAINT fulfillments_time_check CHECK (
    updated_at >= created_at
    AND (prepared_at IS NULL OR prepared_at >= created_at)
    AND (delivered_at IS NULL OR (prepared_at IS NOT NULL AND delivered_at >= prepared_at))
    AND (status <> 'DELIVERED' OR delivered_at IS NOT NULL)
    AND (status = 'DELIVERED' OR delivered_at IS NULL)
  )
);

CREATE TABLE fulfillment_events (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  fulfillment_id uuid NOT NULL REFERENCES fulfillments(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  sequence positive_version NOT NULL,
  from_status text CHECK (from_status IS NULL OR from_status IN ('PENDING', 'PREPARING', 'DELIVERED', 'ON_HOLD', 'CANCELED')),
  to_status text NOT NULL CHECK (to_status IN ('PENDING', 'PREPARING', 'DELIVERED', 'ON_HOLD', 'CANCELED')),
  authority_kind text NOT NULL CHECK (authority_kind IN ('ADMIN', 'SYSTEM', 'WORKER')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  admin_identity_id uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  audit_log_id uuid REFERENCES audit_logs(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT fulfillment_events_sequence_unique UNIQUE (fulfillment_id, sequence),
  CONSTRAINT fulfillment_events_origin_shape_check CHECK (
    (sequence = 1 AND from_status IS NULL AND to_status = 'PENDING')
    OR (sequence > 1 AND from_status IS NOT NULL)
  ),
  CONSTRAINT fulfillment_events_authority_shape_check CHECK (
    (authority_kind = 'ADMIN' AND admin_identity_id IS NOT NULL AND audit_log_id IS NOT NULL)
    OR (authority_kind IN ('SYSTEM', 'WORKER') AND admin_identity_id IS NULL)
  ),
  CONSTRAINT fulfillment_events_hold_reason_check CHECK (
    to_status NOT IN ('ON_HOLD', 'CANCELED') OR length(reason_code) > 0
  )
);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  customer_contact_id uuid NOT NULL REFERENCES customer_contacts(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('PAYMENT_CONFIRMED', 'PREPARING', 'DELIVERED')),
  requested_locale supported_locale NOT NULL,
  resolved_locale supported_locale NOT NULL,
  fallback_used boolean NOT NULL,
  template_key text NOT NULL CHECK (
    length(template_key) BETWEEN 1 AND 128
    AND template_key ~ '^[a-z][a-z0-9]*(\.[a-z0-9]+)+$'
  ),
  template_version text NOT NULL CHECK (
    length(template_version) BETWEEN 1 AND 128
    AND template_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  idempotency_key idempotency_key_value NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('REQUESTED', 'PROCESSING', 'RETRY_SCHEDULED', 'SENT', 'FAILED', 'CANCELED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at finite_timestamptz,
  sent_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  version positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT notification_deliveries_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT notification_deliveries_business_event_unique UNIQUE (order_id, event_type),
  CONSTRAINT notification_deliveries_locale_check CHECK (
    (NOT fallback_used AND requested_locale = resolved_locale)
    OR (fallback_used AND requested_locale <> 'en' AND resolved_locale = 'en')
  ),
  CONSTRAINT notification_deliveries_status_shape_check CHECK (
    (status IN ('REQUESTED', 'PROCESSING')
      AND next_attempt_at IS NULL AND sent_at IS NULL AND last_error_code IS NULL)
    OR (status = 'RETRY_SCHEDULED'
      AND next_attempt_at IS NOT NULL AND sent_at IS NULL AND last_error_code IS NOT NULL)
    OR (status = 'SENT'
      AND next_attempt_at IS NULL AND sent_at IS NOT NULL AND last_error_code IS NULL)
    OR (status = 'FAILED'
      AND next_attempt_at IS NULL AND sent_at IS NULL AND last_error_code IS NOT NULL)
    OR (status = 'CANCELED' AND next_attempt_at IS NULL AND sent_at IS NULL)
  ),
  CONSTRAINT notification_deliveries_time_check CHECK (
    updated_at >= created_at
    AND (next_attempt_at IS NULL OR next_attempt_at >= created_at)
    AND (sent_at IS NULL OR sent_at >= created_at)
  )
);

CREATE INDEX notification_deliveries_retry_idx
  ON notification_deliveries (next_attempt_at, id) WHERE status = 'RETRY_SCHEDULED';

CREATE TABLE notification_content_revision_refs (
  notification_delivery_id uuid NOT NULL REFERENCES notification_deliveries(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  content_type text NOT NULL CHECK (content_type IN ('IDOL', 'GIFT', 'HOMEPAGE', 'POLICY', 'MEDIA_METADATA')),
  idol_revision_id uuid REFERENCES idol_revisions(id) ON DELETE RESTRICT,
  gift_revision_id uuid REFERENCES gift_revisions(id) ON DELETE RESTRICT,
  homepage_revision_id uuid REFERENCES homepage_revisions(id) ON DELETE RESTRICT,
  policy_revision_id uuid REFERENCES policy_revisions(id) ON DELETE RESTRICT,
  media_metadata_revision_id uuid REFERENCES media_metadata_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (notification_delivery_id, sort_order),
  CONSTRAINT notification_content_revision_refs_typed_target_check CHECK (
    (content_type = 'IDOL' AND idol_revision_id IS NOT NULL
      AND gift_revision_id IS NULL AND homepage_revision_id IS NULL
      AND policy_revision_id IS NULL AND media_metadata_revision_id IS NULL)
    OR (content_type = 'GIFT' AND idol_revision_id IS NULL
      AND gift_revision_id IS NOT NULL AND homepage_revision_id IS NULL
      AND policy_revision_id IS NULL AND media_metadata_revision_id IS NULL)
    OR (content_type = 'HOMEPAGE' AND idol_revision_id IS NULL
      AND gift_revision_id IS NULL AND homepage_revision_id IS NOT NULL
      AND policy_revision_id IS NULL AND media_metadata_revision_id IS NULL)
    OR (content_type = 'POLICY' AND idol_revision_id IS NULL
      AND gift_revision_id IS NULL AND homepage_revision_id IS NULL
      AND policy_revision_id IS NOT NULL AND media_metadata_revision_id IS NULL)
    OR (content_type = 'MEDIA_METADATA' AND idol_revision_id IS NULL
      AND gift_revision_id IS NULL AND homepage_revision_id IS NULL
      AND policy_revision_id IS NULL AND media_metadata_revision_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX notification_content_idol_revision_unique_idx
  ON notification_content_revision_refs (notification_delivery_id, idol_revision_id)
  WHERE content_type = 'IDOL';
CREATE UNIQUE INDEX notification_content_gift_revision_unique_idx
  ON notification_content_revision_refs (notification_delivery_id, gift_revision_id)
  WHERE content_type = 'GIFT';
CREATE UNIQUE INDEX notification_content_homepage_revision_unique_idx
  ON notification_content_revision_refs (notification_delivery_id, homepage_revision_id)
  WHERE content_type = 'HOMEPAGE';
CREATE UNIQUE INDEX notification_content_policy_revision_unique_idx
  ON notification_content_revision_refs (notification_delivery_id, policy_revision_id)
  WHERE content_type = 'POLICY';
CREATE UNIQUE INDEX notification_content_media_revision_unique_idx
  ON notification_content_revision_refs (notification_delivery_id, media_metadata_revision_id)
  WHERE content_type = 'MEDIA_METADATA';

CREATE TABLE notification_delivery_attempts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  notification_delivery_id uuid NOT NULL REFERENCES notification_deliveries(id) ON DELETE RESTRICT,
  sequence positive_version NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'FAILED', 'UNKNOWN')),
  provider_delivery_reference opaque_provider_reference,
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT notification_delivery_attempts_sequence_unique UNIQUE (notification_delivery_id, sequence),
  CONSTRAINT notification_delivery_attempts_outcome_shape_check CHECK (
    (outcome = 'SUCCEEDED' AND provider_delivery_reference IS NOT NULL AND error_code IS NULL)
    OR (outcome IN ('FAILED', 'UNKNOWN') AND error_code IS NOT NULL)
  ),
  CONSTRAINT notification_delivery_attempts_time_check CHECK (
    completed_at >= started_at AND created_at >= completed_at
  )
);

CREATE FUNCTION guard_order_transition()
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

CREATE FUNCTION guard_cart_order_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.locked_order_id IS NOT NULL
     AND NEW.locked_order_id IS DISTINCT FROM OLD.locked_order_id THEN
    RAISE EXCEPTION 'cart order binding is immutable once assigned' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_reservation_order_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.locked_order_id IS NULL THEN
    RAISE EXCEPTION 'inventory reservation must bind to an order' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.locked_order_id <> OLD.locked_order_id THEN
    RAISE EXCEPTION 'reservation order binding is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_order_item_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM orders o
    JOIN checkout_quote_lines q
      ON q.checkout_session_id = o.checkout_session_id
     AND q.checkout_quote_id = o.checkout_quote_id
     AND q.cart_item_id = NEW.cart_item_id
    JOIN support_intents si
      ON si.id = NEW.support_intent_id
     AND si.cart_item_id = NEW.cart_item_id
    WHERE o.id = NEW.order_id
      AND q.gift_variant_id = NEW.gift_variant_id
      AND q.price_id = NEW.price_id
      AND q.price_revision = NEW.price_revision
      AND q.quantity = NEW.quantity
      AND q.unit_amount_minor = NEW.unit_amount_minor
      AND q.line_subtotal_minor = NEW.line_subtotal_minor
      AND q.tax_amount_minor = NEW.tax_amount_minor
      AND q.discount_amount_minor = NEW.discount_amount_minor
      AND q.line_total_minor = NEW.line_total_minor
      AND si.idol_id = NEW.idol_id
      AND si.display_mode = NEW.display_mode
      AND si.status IN ('CHECKOUT_LOCKED', 'CONVERTED', 'CANCELED')
      AND o.currency = NEW.currency
      AND o.presentation_locale = NEW.idol_translation_requested_locale
      AND o.presentation_locale = NEW.idol_portrait_alt_requested_locale
      AND o.presentation_locale = NEW.gift_translation_requested_locale
      AND o.presentation_locale = NEW.gift_image_alt_requested_locale
  ) THEN
    RAISE EXCEPTION 'order item must reproduce its checkout quote and support intent'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM prices p
    JOIN gift_variants gv ON gv.id = p.gift_variant_id
    JOIN orders o ON o.id = NEW.order_id
    WHERE p.id = NEW.price_id
      AND p.revision = NEW.price_revision
      AND p.gift_variant_id = NEW.gift_variant_id
      AND p.market = o.market
      AND p.currency = NEW.currency
      AND p.amount_minor = NEW.unit_amount_minor
      AND p.status IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED')
      AND gv.gift_id = NEW.gift_id
      AND EXISTS (
        SELECT 1 FROM gift_variant_idol_eligibility eligibility
        WHERE eligibility.gift_variant_id = NEW.gift_variant_id
          AND eligibility.idol_id = NEW.idol_id
      )
  ) THEN
    RAISE EXCEPTION 'order item price snapshot does not match canonical price revision'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM idol_revision_translations translation
    JOIN idol_revisions revision ON revision.id = translation.idol_revision_id
    JOIN idols idol ON idol.id = revision.idol_id
    JOIN idol_revision_media media
      ON media.idol_revision_id = revision.id AND media.role = 'PORTRAIT'
    JOIN media_assets asset ON asset.id = media.media_asset_id
    JOIN media_metadata_revision_translations alt_translation
      ON alt_translation.id = NEW.idol_portrait_alt_translation_revision_id
     AND alt_translation.media_metadata_revision_id = media.media_metadata_revision_id
    WHERE translation.id = NEW.idol_translation_revision_id
      AND revision.idol_id = NEW.idol_id
      AND revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED')
      AND idol.handle = NEW.idol_handle
      AND translation.locale = NEW.idol_translation_resolved_locale
      AND translation.display_name = NEW.idol_display_name
      AND media.media_asset_id = NEW.idol_portrait_asset_id
      AND media.media_metadata_revision_id = NEW.idol_portrait_metadata_revision_id
      AND asset.checksum_sha256 = NEW.idol_portrait_checksum_sha256
      AND asset.object_key = NEW.idol_portrait_object_key
      AND alt_translation.locale = NEW.idol_portrait_alt_resolved_locale
      AND alt_translation.alt = NEW.idol_portrait_alt
  ) THEN
    RAISE EXCEPTION 'idol translation and portrait snapshot do not share one canonical revision'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM gift_revision_translations translation
    JOIN gift_revisions revision ON revision.id = translation.gift_revision_id
    JOIN gift_revision_media media
      ON media.gift_revision_id = revision.id AND media.role = 'PRIMARY'
    JOIN media_assets asset ON asset.id = media.media_asset_id
    JOIN media_metadata_revision_translations alt_translation
      ON alt_translation.id = NEW.gift_image_alt_translation_revision_id
     AND alt_translation.media_metadata_revision_id = media.media_metadata_revision_id
    WHERE translation.id = NEW.gift_translation_revision_id
      AND revision.gift_id = NEW.gift_id
      AND revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED')
      AND translation.locale = NEW.gift_translation_resolved_locale
      AND translation.title = NEW.gift_title
      AND media.media_asset_id = NEW.gift_image_asset_id
      AND media.media_metadata_revision_id = NEW.gift_image_metadata_revision_id
      AND asset.checksum_sha256 = NEW.gift_image_checksum_sha256
      AND asset.object_key = NEW.gift_image_object_key
      AND alt_translation.locale = NEW.gift_image_alt_resolved_locale
      AND alt_translation.alt = NEW.gift_image_alt
  ) THEN
    RAISE EXCEPTION 'gift translation and image snapshot do not share one canonical revision'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE FUNCTION validate_policy_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM policy_revisions revision
    JOIN policy_revision_translations translation
      ON translation.id = NEW.policy_translation_revision_id
     AND translation.policy_revision_id = revision.id
    WHERE revision.id = NEW.policy_revision_id
      AND revision.policy_key = NEW.policy_key
      AND revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED')
      AND revision.effective_at <= NEW.accepted_at
      AND translation.locale = NEW.locale
      AND (
        SELECT review.status = 'APPROVED'
      AND review.reviewed_source_hash = translation.translated_from_source_hash
      AND review.reviewed_content_hash = translation.source_hash
        FROM policy_translation_reviews review
        WHERE review.policy_translation_id = translation.id
        ORDER BY review.sequence DESC
        LIMIT 1
      )
  ) THEN
    RAISE EXCEPTION 'policy acceptance must reference an effective approved translation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION validate_order_event()
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

CREATE FUNCTION assert_order_event_head()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_order_id uuid;
  current_order orders%ROWTYPE;
  head_event order_events%ROWTYPE;
BEGIN
  target_order_id := COALESCE(
    (to_jsonb(NEW) ->> 'order_id')::uuid,
    (to_jsonb(OLD) ->> 'order_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid,
    (to_jsonb(OLD) ->> 'id')::uuid
  );

  SELECT * INTO current_order FROM orders WHERE id = target_order_id;
  IF current_order.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO head_event
  FROM order_events
  WHERE order_id = target_order_id
  ORDER BY sequence DESC
  LIMIT 1;

  IF head_event.id IS NULL
     OR head_event.sequence <> current_order.version
     OR head_event.to_order_status <> current_order.order_status
     OR head_event.to_payment_status <> current_order.payment_status
     OR head_event.to_dispute_status <> current_order.dispute_status
     OR head_event.to_fulfillment_status <> current_order.fulfillment_status
     OR head_event.to_payment_attempt_id IS DISTINCT FROM current_order.current_payment_attempt_id THEN
    RAISE EXCEPTION 'order event head must equal the versioned order aggregate'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_order_aggregate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_order_id uuid;
  current_order orders%ROWTYPE;
  item_count bigint;
  fulfillment_count bigint;
  policy_count bigint;
  quote_line_count bigint;
  item_subtotal numeric;
  item_tax numeric;
  item_discount numeric;
  item_total numeric;
  foreign_currency_count bigint;
BEGIN
  target_order_id := COALESCE(
    (to_jsonb(NEW) ->> 'order_id')::uuid,
    (to_jsonb(OLD) ->> 'order_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid,
    (to_jsonb(OLD) ->> 'id')::uuid
  );

  SELECT * INTO current_order FROM orders WHERE id = target_order_id FOR UPDATE;
  IF current_order.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM checkout_sessions session
    WHERE session.id = current_order.checkout_session_id
      AND session.quote_id = current_order.checkout_quote_id
      AND session.cart_id = current_order.cart_id
      AND session.market = current_order.market
      AND session.currency = current_order.currency
      AND session.quote_revision = current_order.quote_revision
      AND session.quote_expires_at = current_order.quote_expires_at
      AND session.subtotal_minor = current_order.subtotal_minor
      AND session.tax_amount_minor = current_order.tax_amount_minor
      AND session.shipping_amount_minor = current_order.shipping_amount_minor
      AND session.fee_amount_minor = current_order.fee_amount_minor
      AND session.discount_amount_minor = current_order.discount_amount_minor
      AND session.total_amount_minor = current_order.total_amount_minor
  ) THEN
    RAISE EXCEPTION 'order amount snapshot must reproduce its checkout session'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*), COALESCE(sum(line_subtotal_minor), 0), COALESCE(sum(tax_amount_minor), 0),
         COALESCE(sum(discount_amount_minor), 0), COALESCE(sum(line_total_minor), 0),
         count(*) FILTER (WHERE currency <> current_order.currency)
  INTO item_count, item_subtotal, item_tax, item_discount, item_total, foreign_currency_count
  FROM order_items
  WHERE order_id = target_order_id;

  SELECT count(*) INTO policy_count FROM policy_acceptances WHERE order_id = target_order_id;
  SELECT count(*) INTO fulfillment_count FROM fulfillments WHERE order_id = target_order_id;
  SELECT count(*) INTO quote_line_count
  FROM checkout_quote_lines
  WHERE checkout_session_id = current_order.checkout_session_id
    AND checkout_quote_id = current_order.checkout_quote_id;

  IF item_count = 0 OR item_count <> quote_line_count
     OR policy_count = 0 OR fulfillment_count <> item_count
     OR foreign_currency_count <> 0
     OR item_subtotal <> current_order.subtotal_minor
     OR item_tax <> current_order.tax_amount_minor
     OR item_discount <> current_order.discount_amount_minor
     OR item_total + current_order.shipping_amount_minor + current_order.fee_amount_minor
        <> current_order.total_amount_minor THEN
    RAISE EXCEPTION 'order lines, policies, fulfillments, and amount snapshot diverge'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE FUNCTION guard_order_access_token_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'order access token must start ACTIVE at version one'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'order access token version must increment exactly once'
      USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'version' - 'exchanged_at' - 'revoked_at' - 'expired_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'version' - 'exchanged_at' - 'revoked_at' - 'expired_at') THEN
    RAISE EXCEPTION 'order access token identity and digest are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'ACTIVE' OR NEW.status NOT IN ('EXCHANGED', 'REVOKED', 'EXPIRED') THEN
    RAISE EXCEPTION 'invalid order access token transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'EXCHANGED' AND statement_timestamp() >= NEW.expires_at THEN
    RAISE EXCEPTION 'expired order access token cannot be exchanged' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_order_access_session_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'order access session must start ACTIVE at version one'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'order access session version must increment exactly once'
      USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'version' - 'last_seen_at' - 'revoked_at' - 'expired_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'version' - 'last_seen_at' - 'revoked_at' - 'expired_at') THEN
    RAISE EXCEPTION 'order access session scope and digest are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'ACTIVE' AND NEW.status IN ('REVOKED', 'EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'invalid order access session transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_order_access_session_exchange()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM order_access_tokens token
    WHERE token.id = NEW.exchanged_token_id
      AND token.order_id = NEW.order_id
      AND token.status = 'EXCHANGED'
      AND token.exchanged_at IS NOT NULL
      AND token.exchanged_at <= NEW.created_at
  ) THEN
    RAISE EXCEPTION 'order access session must consume one exchanged token for the same order'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION guard_fulfillment_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.status <> 'PENDING'
       OR NEW.hold_reason_code IS NOT NULL OR NEW.prepared_at IS NOT NULL
       OR NEW.delivered_at IS NOT NULL THEN
      RAISE EXCEPTION 'fulfillment must start PENDING at version one'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'fulfillment version must increment exactly once' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW)
        - 'status' - 'version' - 'hold_reason_code' - 'prepared_at' - 'delivered_at' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(OLD)
        - 'status' - 'version' - 'hold_reason_code' - 'prepared_at' - 'delivered_at' - 'updated_at') THEN
    RAISE EXCEPTION 'fulfillment ownership and profile snapshot are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'PENDING' AND NEW.status IN ('PREPARING', 'ON_HOLD', 'CANCELED'))
    OR (OLD.status = 'PREPARING' AND NEW.status IN ('DELIVERED', 'ON_HOLD', 'CANCELED'))
    OR (OLD.status = 'ON_HOLD' AND NEW.status IN ('PENDING', 'PREPARING', 'CANCELED'))
  ) THEN
    RAISE EXCEPTION 'invalid fulfillment transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.prepared_at IS NOT NULL AND NEW.prepared_at IS DISTINCT FROM OLD.prepared_at THEN
    RAISE EXCEPTION 'fulfillment prepared timestamp is immutable once set'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status IN ('PREPARING', 'DELIVERED') AND NEW.prepared_at IS NULL THEN
    RAISE EXCEPTION 'prepared and delivered fulfillment requires prepared_at'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('PREPARING', 'DELIVERED') AND NOT EXISTS (
    SELECT 1
    FROM public.order_items item
    JOIN public.support_intents intent ON intent.id = item.support_intent_id
    JOIN public.cart_items cart_item ON cart_item.id = item.cart_item_id
    WHERE item.id = NEW.order_item_id
      AND item.order_id = NEW.order_id
      AND (
        ((cart_item.has_fan_message OR intent.fan_message_ciphertext IS NOT NULL)
          AND intent.moderation_status = 'APPROVED'
          AND intent.privacy_state <> 'PURGED')
        OR (NOT cart_item.has_fan_message
          AND intent.fan_message_ciphertext IS NULL
          AND intent.moderation_status NOT IN ('REJECTED', 'REDACTED'))
      )
  ) THEN
    RAISE EXCEPTION 'fulfillment cannot prepare or deliver an unsafe support intent'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
    RAISE EXCEPTION 'fulfillment delivered timestamp is immutable once set'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_fulfillment_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM order_items item
    JOIN idol_fulfillment_profiles profile
      ON profile.id = NEW.fulfillment_profile_id
     AND profile.idol_id = item.idol_id
    WHERE item.id = NEW.order_item_id
      AND item.order_id = NEW.order_id
      AND item.idol_id = NEW.idol_id
      AND profile.status <> 'PURGED'
  ) THEN
    RAISE EXCEPTION 'fulfillment profile must belong to the order item idol'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION validate_fulfillment_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  previous_event fulfillment_events%ROWTYPE;
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
        AND audit.action = 'FULFILLMENT_STATUS_CHANGED'
        AND audit.subject_type = 'FULFILLMENT'
        AND audit.subject_id = NEW.fulfillment_id
        AND audit.reason_code = NEW.reason_code
        AND audit.request_id = NEW.request_id
        AND audit.correlation_id = NEW.correlation_id
        AND audit.outcome = 'SUCCEEDED'
        AND audit.created_at = NEW.occurred_at
        AND NEW.occurred_at = transaction_timestamp()
    ) THEN
      RAISE EXCEPTION 'admin fulfillment event requires exact fresh successful audit evidence'
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

  IF NOT EXISTS (
    SELECT 1 FROM fulfillments fulfillment
    WHERE fulfillment.id = NEW.fulfillment_id AND fulfillment.order_id = NEW.order_id
  ) THEN
    RAISE EXCEPTION 'fulfillment event order does not own fulfillment'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.sequence = 1 THEN
    IF NEW.from_status IS NOT NULL OR NEW.to_status <> 'PENDING' THEN
      RAISE EXCEPTION 'first fulfillment event must create PENDING state'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO previous_event
  FROM fulfillment_events
  WHERE fulfillment_id = NEW.fulfillment_id AND sequence = NEW.sequence - 1;

  IF previous_event.id IS NULL OR NEW.from_status <> previous_event.to_status THEN
    RAISE EXCEPTION 'fulfillment event sequence must be contiguous'
      USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (NEW.from_status = 'PENDING' AND NEW.to_status IN ('PREPARING', 'ON_HOLD', 'CANCELED'))
    OR (NEW.from_status = 'PREPARING' AND NEW.to_status IN ('DELIVERED', 'ON_HOLD', 'CANCELED'))
    OR (NEW.from_status = 'ON_HOLD' AND NEW.to_status IN ('PENDING', 'PREPARING', 'CANCELED'))
  ) THEN
    RAISE EXCEPTION 'fulfillment event contains an invalid transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION assert_fulfillment_event_head()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_fulfillment_id uuid;
  current_fulfillment fulfillments%ROWTYPE;
  head_event fulfillment_events%ROWTYPE;
BEGIN
  target_fulfillment_id := COALESCE(
    (to_jsonb(NEW) ->> 'fulfillment_id')::uuid,
    (to_jsonb(OLD) ->> 'fulfillment_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid,
    (to_jsonb(OLD) ->> 'id')::uuid
  );

  SELECT * INTO current_fulfillment FROM fulfillments WHERE id = target_fulfillment_id;
  IF current_fulfillment.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO head_event
  FROM fulfillment_events
  WHERE fulfillment_id = target_fulfillment_id
  ORDER BY sequence DESC
  LIMIT 1;

  IF head_event.id IS NULL
     OR head_event.sequence <> current_fulfillment.version
     OR head_event.to_status <> current_fulfillment.status
     OR (current_fulfillment.status IN ('ON_HOLD', 'CANCELED')
       AND head_event.reason_code <> current_fulfillment.hold_reason_code) THEN
    RAISE EXCEPTION 'fulfillment event head must equal versioned fulfillment state'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_fulfillment_aggregate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_order_id uuid;
  current_order orders%ROWTYPE;
  total_count bigint;
  delivered_count bigint;
  canceled_count bigint;
  hold_count bigint;
  progressing_count bigint;
  derived_status text;
  invalid_active_count bigint;
BEGIN
  target_order_id := COALESCE(
    (to_jsonb(NEW) ->> 'order_id')::uuid,
    (to_jsonb(OLD) ->> 'order_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid,
    (to_jsonb(OLD) ->> 'id')::uuid
  );
  SELECT * INTO current_order FROM orders WHERE id = target_order_id;
  IF current_order.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE status = 'DELIVERED'),
         count(*) FILTER (WHERE status = 'CANCELED'),
         count(*) FILTER (WHERE status = 'ON_HOLD'),
         count(*) FILTER (WHERE status IN ('PREPARING', 'DELIVERED')),
         count(*) FILTER (
           WHERE status IN ('PREPARING', 'DELIVERED', 'ON_HOLD')
             AND NOT (
               current_order.order_status IN ('OPEN', 'CLOSED')
               AND current_order.payment_status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
             )
         )
  INTO total_count, delivered_count, canceled_count, hold_count,
       progressing_count, invalid_active_count
  FROM fulfillments
  WHERE order_id = target_order_id;

  IF total_count = 0 OR invalid_active_count <> 0 THEN
    RAISE EXCEPTION 'fulfillment aggregate requires paid active work and at least one row'
      USING ERRCODE = '23514';
  END IF;

  derived_status := CASE
    WHEN canceled_count = total_count THEN 'CANCELED'
    WHEN delivered_count = total_count THEN 'DELIVERED'
    WHEN hold_count > 0 THEN 'ON_HOLD'
    WHEN progressing_count > 0 THEN 'PREPARING'
    ELSE 'PENDING'
  END;

  IF current_order.fulfillment_status <> derived_status THEN
    RAISE EXCEPTION 'order fulfillment aggregate does not match fulfillment rows'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION validate_notification_delivery()
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

CREATE FUNCTION guard_notification_delivery_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.status <> 'REQUESTED' OR NEW.attempt_count <> 0 THEN
      RAISE EXCEPTION 'notification delivery must start REQUESTED with zero attempts'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'notification delivery version must increment exactly once'
      USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW)
        - 'status' - 'attempt_count' - 'next_attempt_at' - 'sent_at'
        - 'last_error_code' - 'version' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(OLD)
        - 'status' - 'attempt_count' - 'next_attempt_at' - 'sent_at'
        - 'last_error_code' - 'version' - 'updated_at') THEN
    RAISE EXCEPTION 'notification order, locale, template, and idempotency identity are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'REQUESTED' AND NEW.status IN ('PROCESSING', 'CANCELED'))
    OR (OLD.status = 'PROCESSING' AND NEW.status IN ('SENT', 'RETRY_SCHEDULED', 'FAILED'))
    OR (OLD.status = 'RETRY_SCHEDULED' AND NEW.status IN ('PROCESSING', 'CANCELED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'invalid notification delivery transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'PROCESSING' AND NEW.status IN ('SENT', 'RETRY_SCHEDULED', 'FAILED') THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1 THEN
      RAISE EXCEPTION 'completed notification attempt must increment attempt count once'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.attempt_count <> OLD.attempt_count THEN
    RAISE EXCEPTION 'notification attempt count may change only after processing'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_notification_content_revision_ref()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  revision_lifecycle text;
BEGIN
  CASE NEW.content_type
    WHEN 'IDOL' THEN
      SELECT lifecycle INTO revision_lifecycle FROM idol_revisions WHERE id = NEW.idol_revision_id;
    WHEN 'GIFT' THEN
      SELECT lifecycle INTO revision_lifecycle FROM gift_revisions WHERE id = NEW.gift_revision_id;
    WHEN 'HOMEPAGE' THEN
      SELECT lifecycle INTO revision_lifecycle FROM homepage_revisions WHERE id = NEW.homepage_revision_id;
    WHEN 'POLICY' THEN
      SELECT lifecycle INTO revision_lifecycle FROM policy_revisions WHERE id = NEW.policy_revision_id;
    WHEN 'MEDIA_METADATA' THEN
      SELECT lifecycle INTO revision_lifecycle FROM media_metadata_revisions WHERE id = NEW.media_metadata_revision_id;
  END CASE;

  IF revision_lifecycle IS NULL OR revision_lifecycle NOT IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'notification content reference must point to a published historical revision'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION assert_notification_attempt_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_delivery_id uuid;
  delivery notification_deliveries%ROWTYPE;
  actual_count bigint;
  latest_outcome text;
BEGIN
  target_delivery_id := COALESCE(
    (to_jsonb(NEW) ->> 'notification_delivery_id')::uuid,
    (to_jsonb(OLD) ->> 'notification_delivery_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid,
    (to_jsonb(OLD) ->> 'id')::uuid
  );

  SELECT * INTO delivery FROM notification_deliveries WHERE id = target_delivery_id;
  IF delivery.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO actual_count
  FROM notification_delivery_attempts
  WHERE notification_delivery_id = target_delivery_id;
  SELECT outcome INTO latest_outcome
  FROM notification_delivery_attempts
  WHERE notification_delivery_id = target_delivery_id
  ORDER BY sequence DESC
  LIMIT 1;

  IF actual_count <> delivery.attempt_count
     OR (delivery.status = 'SENT' AND latest_outcome IS DISTINCT FROM 'SUCCEEDED')
     OR (delivery.status IN ('RETRY_SCHEDULED', 'FAILED')
       AND latest_outcome NOT IN ('FAILED', 'UNKNOWN')) THEN
    RAISE EXCEPTION 'notification delivery and append-only attempts diverge'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION validate_notification_delivery_attempt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  expected_sequence bigint;
BEGIN
  SELECT COALESCE(max(sequence), 0) + 1 INTO expected_sequence
  FROM notification_delivery_attempts
  WHERE notification_delivery_id = NEW.notification_delivery_id;

  IF NEW.sequence <> expected_sequence THEN
    RAISE EXCEPTION 'notification delivery attempt sequence must be contiguous'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_transition_trigger
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION guard_order_transition();
CREATE TRIGGER orders_no_delete_trigger
  BEFORE DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER orders_no_truncate_trigger
  BEFORE TRUNCATE ON orders
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER carts_order_binding_trigger
  BEFORE INSERT OR UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION guard_cart_order_binding();
CREATE TRIGGER inventory_reservations_order_binding_trigger
  BEFORE INSERT OR UPDATE ON inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_reservation_order_binding();

CREATE TRIGGER order_items_append_only_trigger
  BEFORE UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER order_items_no_truncate_trigger
  BEFORE TRUNCATE ON order_items
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER order_items_snapshot_validate_trigger
  AFTER INSERT OR UPDATE ON order_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_order_item_snapshot();

CREATE TRIGGER policy_acceptances_append_only_trigger
  BEFORE UPDATE OR DELETE ON policy_acceptances
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER policy_acceptances_no_truncate_trigger
  BEFORE TRUNCATE ON policy_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER policy_acceptances_validate_trigger
  AFTER INSERT OR UPDATE ON policy_acceptances
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_policy_acceptance();

CREATE TRIGGER order_events_validate_trigger
  BEFORE INSERT ON order_events
  FOR EACH ROW EXECUTE FUNCTION validate_order_event();
CREATE TRIGGER order_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON order_events
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER order_events_no_truncate_trigger
  BEFORE TRUNCATE ON order_events
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER order_event_head_from_order_trigger
  AFTER INSERT OR UPDATE ON orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_order_event_head();
CREATE CONSTRAINT TRIGGER order_event_head_from_event_trigger
  AFTER INSERT OR UPDATE OR DELETE ON order_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_order_event_head();

CREATE CONSTRAINT TRIGGER order_aggregate_from_order_trigger
  AFTER INSERT OR UPDATE ON orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_order_aggregate();
CREATE CONSTRAINT TRIGGER order_aggregate_from_item_trigger
  AFTER INSERT OR UPDATE OR DELETE ON order_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_order_aggregate();
CREATE CONSTRAINT TRIGGER order_aggregate_from_policy_trigger
  AFTER INSERT OR UPDATE OR DELETE ON policy_acceptances
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_order_aggregate();
CREATE CONSTRAINT TRIGGER order_aggregate_from_fulfillment_trigger
  AFTER INSERT OR UPDATE OR DELETE ON fulfillments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_order_aggregate();

CREATE TRIGGER order_access_tokens_transition_trigger
  BEFORE INSERT OR UPDATE ON order_access_tokens
  FOR EACH ROW EXECUTE FUNCTION guard_order_access_token_transition();
CREATE TRIGGER order_access_tokens_delete_guard_trigger
  BEFORE DELETE ON order_access_tokens
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER order_access_tokens_no_truncate_trigger
  BEFORE TRUNCATE ON order_access_tokens
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER order_access_sessions_transition_trigger
  BEFORE INSERT OR UPDATE ON order_access_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_order_access_session_transition();
CREATE TRIGGER order_access_sessions_delete_guard_trigger
  BEFORE DELETE ON order_access_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER order_access_sessions_no_truncate_trigger
  BEFORE TRUNCATE ON order_access_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER order_access_sessions_exchange_trigger
  AFTER INSERT ON order_access_sessions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_order_access_session_exchange();

CREATE TRIGGER fulfillments_transition_trigger
  BEFORE INSERT OR UPDATE ON fulfillments
  FOR EACH ROW EXECUTE FUNCTION guard_fulfillment_transition();
CREATE TRIGGER fulfillments_no_delete_trigger
  BEFORE DELETE ON fulfillments
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER fulfillments_no_truncate_trigger
  BEFORE TRUNCATE ON fulfillments
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER fulfillments_owner_validate_trigger
  AFTER INSERT OR UPDATE ON fulfillments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_fulfillment_owner();

CREATE TRIGGER fulfillment_events_validate_trigger
  BEFORE INSERT ON fulfillment_events
  FOR EACH ROW EXECUTE FUNCTION validate_fulfillment_event();
CREATE TRIGGER fulfillment_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON fulfillment_events
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER fulfillment_events_no_truncate_trigger
  BEFORE TRUNCATE ON fulfillment_events
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER fulfillment_event_head_from_fulfillment_trigger
  AFTER INSERT OR UPDATE ON fulfillments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_fulfillment_event_head();
CREATE CONSTRAINT TRIGGER fulfillment_event_head_from_event_trigger
  AFTER INSERT OR UPDATE OR DELETE ON fulfillment_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_fulfillment_event_head();
CREATE CONSTRAINT TRIGGER fulfillment_aggregate_from_order_trigger
  AFTER INSERT OR UPDATE ON orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_fulfillment_aggregate();
CREATE CONSTRAINT TRIGGER fulfillment_aggregate_from_fulfillment_trigger
  AFTER INSERT OR UPDATE OR DELETE ON fulfillments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_fulfillment_aggregate();

CREATE TRIGGER notification_deliveries_transition_trigger
  BEFORE INSERT OR UPDATE ON notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION guard_notification_delivery_transition();
CREATE TRIGGER notification_deliveries_no_delete_trigger
  BEFORE DELETE ON notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER notification_deliveries_no_truncate_trigger
  BEFORE TRUNCATE ON notification_deliveries
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER notification_deliveries_validate_trigger
  AFTER INSERT ON notification_deliveries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_notification_delivery();

CREATE TRIGGER notification_content_refs_validate_trigger
  BEFORE INSERT ON notification_content_revision_refs
  FOR EACH ROW EXECUTE FUNCTION validate_notification_content_revision_ref();
CREATE TRIGGER notification_content_refs_append_only_trigger
  BEFORE UPDATE OR DELETE ON notification_content_revision_refs
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER notification_content_refs_no_truncate_trigger
  BEFORE TRUNCATE ON notification_content_revision_refs
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER notification_attempts_append_only_trigger
  BEFORE UPDATE OR DELETE ON notification_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER notification_attempts_validate_trigger
  BEFORE INSERT ON notification_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION validate_notification_delivery_attempt();
CREATE TRIGGER notification_attempts_no_truncate_trigger
  BEFORE TRUNCATE ON notification_delivery_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER notification_attempt_consistency_from_delivery_trigger
  AFTER INSERT OR UPDATE ON notification_deliveries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_notification_attempt_consistency();
CREATE CONSTRAINT TRIGGER notification_attempt_consistency_from_attempt_trigger
  AFTER INSERT OR UPDATE OR DELETE ON notification_delivery_attempts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_notification_attempt_consistency();
