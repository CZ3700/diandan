SET search_path = public;

DROP TRIGGER content_publications_append_only_trigger
  ON public.content_publications;

ALTER TABLE public.content_publications ADD COLUMN audit_log_id uuid;
ALTER TABLE public.content_publications
  ADD CONSTRAINT content_publications_audit_log_fk
    FOREIGN KEY (audit_log_id) REFERENCES public.audit_logs(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT content_publications_audit_log_unique UNIQUE (audit_log_id);

ALTER TABLE public.outbox_events
  DROP CONSTRAINT outbox_events_event_type_check,
  ADD CONSTRAINT outbox_events_event_type_check CHECK (
    event_type IN (
      'CART_ITEM_ADDED', 'CONTENT_PUBLICATION_CHANGED', 'PAYMENT_STATUS_CHANGED',
      'ORDER_PAYMENT_CONFIRMED', 'REFUND_STATUS_CHANGED', 'DISPUTE_STATUS_CHANGED',
      'FULFILLMENT_STATUS_CHANGED', 'NOTIFICATION_REQUESTED',
      'PAYMENT_CONFIG_PUBLISHED', 'PRICE_BOOK_PUBLISHED'
    )
  ),
  DROP CONSTRAINT outbox_events_aggregate_type_check,
  ADD CONSTRAINT outbox_events_aggregate_type_check CHECK (
    aggregate_type IN (
      'CART', 'CONTENT_PUBLICATION', 'ORDER', 'PAYMENT_ATTEMPT', 'REFUND',
      'DISPUTE', 'FULFILLMENT', 'NOTIFICATION_DELIVERY', 'PAYMENT_CONFIG',
      'PRICE_BOOK'
    )
  );

CREATE UNIQUE INDEX outbox_content_publication_locale_unique
  ON public.outbox_events (event_type, primary_subject_id, locale)
  WHERE event_type = 'CONTENT_PUBLICATION_CHANGED';
CREATE UNIQUE INDEX outbox_noncontent_publication_source_unique
  ON public.outbox_events (event_type, primary_subject_id)
  WHERE event_type IN ('PAYMENT_CONFIG_PUBLISHED', 'PRICE_BOOK_PUBLISHED');

CREATE UNIQUE INDEX content_publications_idol_root_unique
  ON public.content_publications (idol_id)
  WHERE content_type = 'IDOL' AND replaces_publication_id IS NULL;
CREATE UNIQUE INDEX content_publications_gift_root_unique
  ON public.content_publications (gift_id)
  WHERE content_type = 'GIFT' AND replaces_publication_id IS NULL;
CREATE UNIQUE INDEX content_publications_homepage_root_unique
  ON public.content_publications ((true))
  WHERE content_type = 'HOMEPAGE' AND replaces_publication_id IS NULL;
CREATE UNIQUE INDEX content_publications_policy_root_unique
  ON public.content_publications (policy_key)
  WHERE content_type = 'POLICY' AND replaces_publication_id IS NULL;
CREATE UNIQUE INDEX content_publications_media_root_unique
  ON public.content_publications (media_asset_id)
  WHERE content_type = 'MEDIA_METADATA' AND replaces_publication_id IS NULL;
CREATE UNIQUE INDEX content_publications_site_locale_root_unique
  ON public.content_publications ((true))
  WHERE content_type = 'SITE_LOCALE_CONFIG' AND replaces_publication_id IS NULL;
CREATE UNIQUE INDEX payment_config_publications_root_unique
  ON public.payment_config_publications ((true))
  WHERE replaces_publication_id IS NULL;

CREATE TABLE public.price_book_publications (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  price_book_id uuid NOT NULL,
  price_book_revision public.positive_version NOT NULL,
  market_id uuid NOT NULL,
  market public.market_code NOT NULL,
  currency public.currency_code NOT NULL,
  action text NOT NULL CHECK (action IN ('PUBLISH', 'ROLLBACK')),
  replaces_publication_id uuid
    REFERENCES public.price_book_publications(id) ON DELETE RESTRICT,
  manifest_hash public.sha256_hex NOT NULL,
  published_by uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  idempotency_key idempotency_key_value NOT NULL,
  CONSTRAINT price_book_publications_target_fk
    FOREIGN KEY (price_book_id, price_book_revision, market, currency)
    REFERENCES public.price_books(id, revision, market, currency) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT price_book_publications_market_fk
    FOREIGN KEY (market_id, market)
    REFERENCES public.markets(id, market) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT price_book_publications_replaces_unique UNIQUE (replaces_publication_id),
  CONSTRAINT price_book_publications_audit_unique UNIQUE (audit_log_id),
  CONSTRAINT price_book_publications_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT price_book_publications_not_self_check CHECK (id <> replaces_publication_id),
  CONSTRAINT price_book_publications_rollback_check CHECK (
    action = 'PUBLISH' OR replaces_publication_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX price_book_publications_root_unique
  ON public.price_book_publications (market, currency)
  WHERE replaces_publication_id IS NULL;

CREATE TABLE public.idol_publication_heads (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  idol_id uuid NOT NULL REFERENCES public.idols(id) ON DELETE RESTRICT,
  publication_id uuid NOT NULL UNIQUE
    REFERENCES public.content_publications(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  idol_revision_id uuid NOT NULL,
  version public.positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT idol_publication_heads_owner_unique UNIQUE (idol_id),
  CONSTRAINT idol_publication_heads_revision_owner_fk
    FOREIGN KEY (idol_revision_id, idol_id)
    REFERENCES public.idol_revisions(id, idol_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT idol_publication_heads_time_check CHECK (updated_at >= created_at)
);

CREATE TABLE public.gift_publication_heads (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  gift_id uuid NOT NULL REFERENCES public.gifts(id) ON DELETE RESTRICT,
  publication_id uuid NOT NULL UNIQUE
    REFERENCES public.content_publications(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  gift_revision_id uuid NOT NULL,
  version public.positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT gift_publication_heads_owner_unique UNIQUE (gift_id),
  CONSTRAINT gift_publication_heads_revision_owner_fk
    FOREIGN KEY (gift_revision_id, gift_id)
    REFERENCES public.gift_revisions(id, gift_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT gift_publication_heads_time_check CHECK (updated_at >= created_at)
);

CREATE TABLE public.homepage_publication_heads (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  singleton_key boolean NOT NULL DEFAULT true CHECK (singleton_key),
  publication_id uuid NOT NULL UNIQUE
    REFERENCES public.content_publications(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  homepage_revision_id uuid NOT NULL
    REFERENCES public.homepage_revisions(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  version public.positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT homepage_publication_heads_singleton_unique UNIQUE (singleton_key),
  CONSTRAINT homepage_publication_heads_time_check CHECK (updated_at >= created_at)
);

CREATE TABLE public.policy_publication_heads (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  policy_key text NOT NULL REFERENCES public.policies(policy_key) ON DELETE RESTRICT,
  publication_id uuid NOT NULL UNIQUE
    REFERENCES public.content_publications(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  policy_revision_id uuid NOT NULL,
  version public.positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT policy_publication_heads_owner_unique UNIQUE (policy_key),
  CONSTRAINT policy_publication_heads_revision_owner_fk
    FOREIGN KEY (policy_revision_id, policy_key)
    REFERENCES public.policy_revisions(id, policy_key) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT policy_publication_heads_time_check CHECK (updated_at >= created_at)
);

CREATE TABLE public.media_metadata_publication_heads (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  media_asset_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE RESTRICT,
  publication_id uuid NOT NULL UNIQUE
    REFERENCES public.content_publications(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  media_metadata_revision_id uuid NOT NULL,
  version public.positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT media_metadata_publication_heads_owner_unique UNIQUE (media_asset_id),
  CONSTRAINT media_metadata_publication_heads_revision_owner_fk
    FOREIGN KEY (media_metadata_revision_id, media_asset_id)
    REFERENCES public.media_metadata_revisions(id, media_asset_id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT media_metadata_publication_heads_time_check CHECK (updated_at >= created_at)
);

CREATE TABLE public.site_locale_config_publication_heads (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  singleton_key boolean NOT NULL DEFAULT true CHECK (singleton_key),
  publication_id uuid NOT NULL UNIQUE
    REFERENCES public.content_publications(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  site_locale_config_revision_id uuid NOT NULL
    REFERENCES public.site_locale_config_revisions(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  version public.positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT site_locale_config_publication_heads_singleton_unique UNIQUE (singleton_key),
  CONSTRAINT site_locale_config_publication_heads_time_check CHECK (updated_at >= created_at)
);

CREATE TABLE public.price_book_publication_heads (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  market_id uuid NOT NULL,
  market public.market_code NOT NULL,
  currency public.currency_code NOT NULL,
  publication_id uuid NOT NULL UNIQUE
    REFERENCES public.price_book_publications(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  price_book_id uuid NOT NULL,
  price_book_revision public.positive_version NOT NULL,
  version public.positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT price_book_publication_heads_owner_unique UNIQUE (market, currency),
  CONSTRAINT price_book_publication_heads_market_fk
    FOREIGN KEY (market_id, market)
    REFERENCES public.markets(id, market) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT price_book_publication_heads_revision_fk
    FOREIGN KEY (price_book_id, price_book_revision, market, currency)
    REFERENCES public.price_books(id, revision, market, currency) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT price_book_publication_heads_time_check CHECK (updated_at >= created_at)
);

CREATE TABLE public.payment_config_publication_heads (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  singleton_key boolean NOT NULL DEFAULT true CHECK (singleton_key),
  config_kind text NOT NULL DEFAULT 'PAYMENT_ROUTING' CHECK (config_kind = 'PAYMENT_ROUTING'),
  publication_id uuid NOT NULL UNIQUE
    REFERENCES public.payment_config_publications(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  config_version_id uuid NOT NULL,
  config_version public.positive_version NOT NULL,
  version public.positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT payment_config_publication_heads_singleton_unique UNIQUE (singleton_key),
  CONSTRAINT payment_config_publication_heads_revision_fk
    FOREIGN KEY (config_version_id, config_kind, config_version)
    REFERENCES public.config_versions(id, config_kind, version) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT payment_config_publication_heads_time_check CHECK (updated_at >= created_at)
);

CREATE FUNCTION public.guard_publication_head_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' THEN
    RAISE EXCEPTION 'publication head guard is restricted to public schema'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'publication heads cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'publication head must start at version one' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'publication head update requires one version increment and a later timestamp'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.id <> OLD.id OR NEW.schema_version <> OLD.schema_version
     OR NEW.created_at <> OLD.created_at OR NEW.publication_id = OLD.publication_id THEN
    RAISE EXCEPTION 'publication head identity is immutable and its publication must advance'
      USING ERRCODE = '55000';
  END IF;

  IF TG_TABLE_NAME = 'idol_publication_heads' THEN
    IF NEW.idol_id <> OLD.idol_id OR NEW.idol_revision_id = OLD.idol_revision_id THEN
      RAISE EXCEPTION 'idol publication head owner is immutable and revision must change'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'gift_publication_heads' THEN
    IF NEW.gift_id <> OLD.gift_id OR NEW.gift_revision_id = OLD.gift_revision_id THEN
      RAISE EXCEPTION 'gift publication head owner is immutable and revision must change'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'homepage_publication_heads' THEN
    IF NEW.singleton_key <> OLD.singleton_key
       OR NEW.homepage_revision_id = OLD.homepage_revision_id THEN
      RAISE EXCEPTION 'homepage publication head owner is immutable and revision must change'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'policy_publication_heads' THEN
    IF NEW.policy_key <> OLD.policy_key OR NEW.policy_revision_id = OLD.policy_revision_id THEN
      RAISE EXCEPTION 'policy publication head owner is immutable and revision must change'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'media_metadata_publication_heads' THEN
    IF NEW.media_asset_id <> OLD.media_asset_id
       OR NEW.media_metadata_revision_id = OLD.media_metadata_revision_id THEN
      RAISE EXCEPTION 'media publication head owner is immutable and revision must change'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'site_locale_config_publication_heads' THEN
    IF NEW.singleton_key <> OLD.singleton_key
       OR NEW.site_locale_config_revision_id = OLD.site_locale_config_revision_id THEN
      RAISE EXCEPTION 'locale-config publication head owner is immutable and revision must change'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'price_book_publication_heads' THEN
    IF NEW.market_id <> OLD.market_id OR NEW.market <> OLD.market
       OR NEW.currency <> OLD.currency
       OR (NEW.price_book_id = OLD.price_book_id
           AND NEW.price_book_revision = OLD.price_book_revision) THEN
      RAISE EXCEPTION 'price-book publication head owner is immutable and revision must change'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'payment_config_publication_heads' THEN
    IF NEW.singleton_key <> OLD.singleton_key OR NEW.config_kind <> OLD.config_kind
       OR (NEW.config_version_id = OLD.config_version_id
           AND NEW.config_version = OLD.config_version) THEN
      RAISE EXCEPTION 'payment-config publication head owner is immutable and revision must change'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported publication head table: %', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.assert_content_publication_heads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.content_publications publication
    LEFT JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE audit.id IS NULL
       OR audit.actor_type <> 'ADMIN'
       OR audit.actor_id IS DISTINCT FROM publication.published_by
       OR audit.action <> CASE publication.action
            WHEN 'PUBLISH' THEN 'CONTENT_PUBLISH'
            ELSE 'CONTENT_ROLLBACK'
          END
       OR audit.subject_type <> 'CONTENT_PUBLICATION'
       OR audit.subject_id <> publication.id
       OR audit.outcome <> 'SUCCEEDED'
       OR audit.request_id IS NULL
       OR audit.correlation_id IS NULL
  ) THEN
    RAISE EXCEPTION 'content publication requires exact successful audit evidence'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.content_publications publication
    JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    CROSS JOIN LATERAL (
      SELECT
        pg_catalog.count(*) AS locale_event_count,
        pg_catalog.count(DISTINCT outbox.locale) AS distinct_locale_event_count
      FROM public.outbox_events outbox
      WHERE outbox.event_type = 'CONTENT_PUBLICATION_CHANGED'
        AND outbox.aggregate_type = 'CONTENT_PUBLICATION'
        AND outbox.aggregate_id = publication.id
        AND outbox.aggregate_version = 1
        AND outbox.primary_subject_id = publication.id
        AND outbox.secondary_subject_id = COALESCE(
          publication.idol_revision_id,
          publication.gift_revision_id,
          publication.homepage_revision_id,
          publication.policy_revision_id,
          publication.media_metadata_revision_id,
          publication.site_locale_config_revision_id
        )
        AND outbox.locale IS NOT NULL
        AND outbox.market IS NULL
        AND outbox.currency IS NULL
        AND outbox.idempotency_key =
          'content-publication:' || publication.id::text || ':' || outbox.locale::text
        AND outbox.request_id = audit.request_id
        AND outbox.correlation_id = audit.correlation_id
        AND outbox.occurred_at = publication.published_at
    ) exact_outbox
    WHERE exact_outbox.locale_event_count <> 7
       OR exact_outbox.distinct_locale_event_count <> 7
  ) THEN
    RAISE EXCEPTION 'content publication and exactly seven localized outbox records must commit together'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.content_publications publication
    WHERE publication.action = 'ROLLBACK'
      AND NOT EXISTS (
        SELECT 1
        FROM public.content_publications historical
        WHERE historical.id <> publication.id
          AND historical.published_at <= publication.published_at
          AND (
            (publication.content_type = 'IDOL'
              AND historical.content_type = 'IDOL'
              AND historical.idol_id = publication.idol_id
              AND historical.idol_revision_id = publication.idol_revision_id)
            OR (publication.content_type = 'GIFT'
              AND historical.content_type = 'GIFT'
              AND historical.gift_id = publication.gift_id
              AND historical.gift_revision_id = publication.gift_revision_id)
            OR (publication.content_type = 'HOMEPAGE'
              AND historical.content_type = 'HOMEPAGE'
              AND historical.homepage_revision_id = publication.homepage_revision_id)
            OR (publication.content_type = 'POLICY'
              AND historical.content_type = 'POLICY'
              AND historical.policy_key = publication.policy_key
              AND historical.policy_revision_id = publication.policy_revision_id)
            OR (publication.content_type = 'MEDIA_METADATA'
              AND historical.content_type = 'MEDIA_METADATA'
              AND historical.media_asset_id = publication.media_asset_id
              AND historical.media_metadata_revision_id = publication.media_metadata_revision_id)
            OR (publication.content_type = 'SITE_LOCALE_CONFIG'
              AND historical.content_type = 'SITE_LOCALE_CONFIG'
              AND historical.site_locale_config_revision_id =
                publication.site_locale_config_revision_id)
          )
      )
  ) THEN
    RAISE EXCEPTION 'content rollback must target a previously published immutable revision'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.idol_publication_heads head
    LEFT JOIN public.content_publications publication
      ON publication.id = head.publication_id
    LEFT JOIN public.idol_revisions revision
      ON revision.id = head.idol_revision_id AND revision.idol_id = head.idol_id
    LEFT JOIN public.idols idol ON idol.id = head.idol_id
    WHERE publication.id IS NULL
       OR publication.content_type <> 'IDOL'
       OR publication.idol_id <> head.idol_id
       OR publication.idol_revision_id <> head.idol_revision_id
       OR revision.id IS NULL
       OR NOT (revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED'))
       OR (publication.action = 'PUBLISH' AND revision.lifecycle <> 'PUBLISHED')
       OR (publication.action = 'ROLLBACK' AND revision.lifecycle <> 'SUPERSEDED')
       OR idol.published_revision_id IS DISTINCT FROM head.idol_revision_id
       OR EXISTS (
         SELECT 1 FROM public.content_publications successor
         WHERE successor.replaces_publication_id = publication.id
       )
  ) THEN
    RAISE EXCEPTION 'idol published pointer must equal its current head'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.idols idol
    WHERE idol.published_revision_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.idol_publication_heads head
        WHERE head.idol_id = idol.id
          AND head.idol_revision_id = idol.published_revision_id
      )
  ) THEN
    RAISE EXCEPTION 'idol published pointer must equal its current head'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.gift_publication_heads head
    LEFT JOIN public.content_publications publication
      ON publication.id = head.publication_id
    LEFT JOIN public.gift_revisions revision
      ON revision.id = head.gift_revision_id AND revision.gift_id = head.gift_id
    LEFT JOIN public.gifts gift ON gift.id = head.gift_id
    WHERE publication.id IS NULL
       OR publication.content_type <> 'GIFT'
       OR publication.gift_id <> head.gift_id
       OR publication.gift_revision_id <> head.gift_revision_id
       OR revision.id IS NULL
       OR NOT (revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED'))
       OR (publication.action = 'PUBLISH' AND revision.lifecycle <> 'PUBLISHED')
       OR (publication.action = 'ROLLBACK' AND revision.lifecycle <> 'SUPERSEDED')
       OR gift.published_revision_id IS DISTINCT FROM head.gift_revision_id
       OR EXISTS (
         SELECT 1 FROM public.content_publications successor
         WHERE successor.replaces_publication_id = publication.id
       )
  ) THEN
    RAISE EXCEPTION 'gift published pointer must equal its current head'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.gifts gift
    WHERE gift.published_revision_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.gift_publication_heads head
        WHERE head.gift_id = gift.id
          AND head.gift_revision_id = gift.published_revision_id
      )
  ) THEN
    RAISE EXCEPTION 'gift published pointer must equal its current head'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.homepage_publication_heads head
    LEFT JOIN public.content_publications publication
      ON publication.id = head.publication_id
    LEFT JOIN public.homepage_revisions revision
      ON revision.id = head.homepage_revision_id
    WHERE publication.id IS NULL
       OR publication.content_type <> 'HOMEPAGE'
       OR publication.homepage_revision_id <> head.homepage_revision_id
       OR revision.id IS NULL
       OR NOT (revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED'))
       OR (publication.action = 'PUBLISH' AND revision.lifecycle <> 'PUBLISHED')
       OR (publication.action = 'ROLLBACK' AND revision.lifecycle <> 'SUPERSEDED')
       OR EXISTS (
         SELECT 1 FROM public.content_publications successor
         WHERE successor.replaces_publication_id = publication.id
       )
  ) THEN
    RAISE EXCEPTION 'homepage publication head is inconsistent'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.policy_publication_heads head
    LEFT JOIN public.content_publications publication
      ON publication.id = head.publication_id
    LEFT JOIN public.policy_revisions revision
      ON revision.id = head.policy_revision_id AND revision.policy_key = head.policy_key
    WHERE publication.id IS NULL
       OR publication.content_type <> 'POLICY'
       OR publication.policy_key <> head.policy_key
       OR publication.policy_revision_id <> head.policy_revision_id
       OR revision.id IS NULL
       OR NOT (revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED'))
       OR (publication.action = 'PUBLISH' AND revision.lifecycle <> 'PUBLISHED')
       OR (publication.action = 'ROLLBACK' AND revision.lifecycle <> 'SUPERSEDED')
       OR EXISTS (
         SELECT 1 FROM public.content_publications successor
         WHERE successor.replaces_publication_id = publication.id
       )
  ) THEN
    RAISE EXCEPTION 'policy publication head is inconsistent'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.media_metadata_publication_heads head
    LEFT JOIN public.content_publications publication
      ON publication.id = head.publication_id
    LEFT JOIN public.media_metadata_revisions revision
      ON revision.id = head.media_metadata_revision_id
     AND revision.media_asset_id = head.media_asset_id
    WHERE publication.id IS NULL
       OR publication.content_type <> 'MEDIA_METADATA'
       OR publication.media_asset_id <> head.media_asset_id
       OR publication.media_metadata_revision_id <> head.media_metadata_revision_id
       OR revision.id IS NULL
       OR NOT (revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED'))
       OR (publication.action = 'PUBLISH' AND revision.lifecycle <> 'PUBLISHED')
       OR (publication.action = 'ROLLBACK' AND revision.lifecycle <> 'SUPERSEDED')
       OR EXISTS (
         SELECT 1 FROM public.content_publications successor
         WHERE successor.replaces_publication_id = publication.id
       )
  ) THEN
    RAISE EXCEPTION 'media publication head is inconsistent'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.site_locale_config_publication_heads head
    LEFT JOIN public.content_publications publication
      ON publication.id = head.publication_id
    LEFT JOIN public.site_locale_config_revisions revision
      ON revision.id = head.site_locale_config_revision_id
    WHERE publication.id IS NULL
       OR publication.content_type <> 'SITE_LOCALE_CONFIG'
       OR publication.site_locale_config_revision_id <>
          head.site_locale_config_revision_id
       OR revision.id IS NULL
       OR NOT (revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED'))
       OR (publication.action = 'PUBLISH' AND revision.lifecycle <> 'PUBLISHED')
       OR (publication.action = 'ROLLBACK' AND revision.lifecycle <> 'SUPERSEDED')
       OR EXISTS (
         SELECT 1 FROM public.content_publications successor
         WHERE successor.replaces_publication_id = publication.id
       )
  ) THEN
    RAISE EXCEPTION 'site-locale publication head is inconsistent'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.content_publications publication
    WHERE NOT EXISTS (
      SELECT 1 FROM public.content_publications successor
      WHERE successor.replaces_publication_id = publication.id
    )
      AND NOT (
        (publication.content_type = 'IDOL' AND EXISTS (
          SELECT 1 FROM public.idol_publication_heads head
          WHERE head.publication_id = publication.id
        ))
        OR (publication.content_type = 'GIFT' AND EXISTS (
          SELECT 1 FROM public.gift_publication_heads head
          WHERE head.publication_id = publication.id
        ))
        OR (publication.content_type = 'HOMEPAGE' AND EXISTS (
          SELECT 1 FROM public.homepage_publication_heads head
          WHERE head.publication_id = publication.id
        ))
        OR (publication.content_type = 'POLICY' AND EXISTS (
          SELECT 1 FROM public.policy_publication_heads head
          WHERE head.publication_id = publication.id
        ))
        OR (publication.content_type = 'MEDIA_METADATA' AND EXISTS (
          SELECT 1 FROM public.media_metadata_publication_heads head
          WHERE head.publication_id = publication.id
        ))
        OR (publication.content_type = 'SITE_LOCALE_CONFIG' AND EXISTS (
          SELECT 1 FROM public.site_locale_config_publication_heads head
          WHERE head.publication_id = publication.id
        ))
      )
  ) THEN
    RAISE EXCEPTION 'content publication leaf must equal its typed current head'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.assert_price_book_publication_heads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.price_book_publications publication
    LEFT JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE audit.id IS NULL
       OR audit.actor_type <> 'ADMIN'
       OR audit.actor_id IS DISTINCT FROM publication.published_by
       OR audit.action <> CASE publication.action
            WHEN 'PUBLISH' THEN 'PRICE_BOOK_PUBLISH'
            ELSE 'PRICE_BOOK_ROLLBACK'
          END
       OR audit.subject_type <> 'PRICE_BOOK_PUBLICATION'
       OR audit.subject_id <> publication.id
       OR audit.outcome <> 'SUCCEEDED'
       OR audit.request_id IS NULL
       OR audit.correlation_id IS NULL
  ) THEN
    RAISE EXCEPTION 'price-book publication requires exact successful audit evidence'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.price_book_publications publication
    JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.outbox_events outbox
      WHERE outbox.event_type = 'PRICE_BOOK_PUBLISHED'
        AND outbox.aggregate_type = 'PRICE_BOOK'
        AND outbox.aggregate_id = publication.price_book_id
        AND outbox.aggregate_version = publication.price_book_revision
        AND outbox.primary_subject_id = publication.id
        AND outbox.secondary_subject_id = publication.price_book_id
        AND outbox.locale IS NULL
        AND outbox.market = publication.market
        AND outbox.currency = publication.currency
        AND outbox.idempotency_key = 'price-book-publication:' || publication.id::text
        AND outbox.request_id = audit.request_id
        AND outbox.correlation_id = audit.correlation_id
        AND outbox.occurred_at = publication.published_at
    )
  ) THEN
    RAISE EXCEPTION 'price-book publication and exact outbox record must commit together'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.price_book_publications publication
    LEFT JOIN public.price_book_publications predecessor
      ON predecessor.id = publication.replaces_publication_id
    WHERE publication.replaces_publication_id IS NOT NULL
      AND (
        predecessor.id IS NULL
        OR predecessor.market <> publication.market
        OR predecessor.currency <> publication.currency
      )
  ) THEN
    RAISE EXCEPTION 'price-book publication replacement must stay on the same market and currency'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.price_book_publications publication
    WHERE publication.action = 'ROLLBACK'
      AND NOT EXISTS (
        SELECT 1
        FROM public.price_book_publications historical
        WHERE historical.id <> publication.id
          AND historical.market = publication.market
          AND historical.currency = publication.currency
          AND historical.price_book_id = publication.price_book_id
          AND historical.price_book_revision = publication.price_book_revision
          AND historical.published_at <= publication.published_at
      )
  ) THEN
    RAISE EXCEPTION 'price-book rollback must target a previously published immutable revision'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.price_book_publication_heads head
    LEFT JOIN public.price_book_publications publication
      ON publication.id = head.publication_id
    LEFT JOIN public.price_books revision
      ON revision.id = head.price_book_id
     AND revision.revision = head.price_book_revision
     AND revision.market = head.market
     AND revision.currency = head.currency
    WHERE publication.id IS NULL
       OR publication.market_id <> head.market_id
       OR publication.market <> head.market
       OR publication.currency <> head.currency
       OR publication.price_book_id <> head.price_book_id
       OR publication.price_book_revision <> head.price_book_revision
       OR revision.market_id <> head.market_id
       OR NOT (revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED'))
       OR (publication.action = 'PUBLISH' AND revision.lifecycle <> 'PUBLISHED')
       OR (publication.action = 'ROLLBACK' AND revision.lifecycle <> 'SUPERSEDED')
       OR EXISTS (
         SELECT 1 FROM public.price_book_publications successor
         WHERE successor.replaces_publication_id = publication.id
       )
  ) THEN
    RAISE EXCEPTION 'price-book publication head is inconsistent'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.price_book_publications publication
    WHERE NOT EXISTS (
      SELECT 1 FROM public.price_book_publications successor
      WHERE successor.replaces_publication_id = publication.id
    )
      AND NOT EXISTS (
        SELECT 1 FROM public.price_book_publication_heads head
        WHERE head.publication_id = publication.id
      )
  ) THEN
    RAISE EXCEPTION 'price-book publication leaf must equal its current head'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.assert_payment_config_publication_heads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.payment_config_publications publication
    LEFT JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE audit.id IS NULL
       OR audit.actor_type <> 'ADMIN'
       OR audit.actor_id IS DISTINCT FROM publication.published_by
       OR audit.action <> CASE publication.action
            WHEN 'PUBLISH' THEN 'PAYMENT_CONFIG_PUBLISH'
            ELSE 'PAYMENT_CONFIG_ROLLBACK'
          END
       OR audit.subject_type <> 'PAYMENT_CONFIG_PUBLICATION'
       OR audit.subject_id <> publication.id
       OR audit.outcome <> 'SUCCEEDED'
       OR audit.request_id IS NULL
       OR audit.correlation_id IS NULL
  ) THEN
    RAISE EXCEPTION 'payment-config publication requires exact successful audit evidence'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_config_publications publication
    JOIN public.config_versions revision ON revision.id = publication.config_version_id
    JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.outbox_events outbox
      WHERE outbox.event_type = 'PAYMENT_CONFIG_PUBLISHED'
        AND outbox.aggregate_type = 'PAYMENT_CONFIG'
        AND outbox.aggregate_id = publication.config_version_id
        AND outbox.aggregate_version = revision.version
        AND outbox.primary_subject_id = publication.id
        AND outbox.secondary_subject_id IS NULL
        AND outbox.locale IS NULL
        AND outbox.market IS NULL
        AND outbox.currency IS NULL
        AND outbox.idempotency_key = 'payment-config-publication:' || publication.id::text
        AND outbox.request_id = audit.request_id
        AND outbox.correlation_id = audit.correlation_id
        AND outbox.occurred_at = publication.created_at
    )
  ) THEN
    RAISE EXCEPTION 'payment-config publication and exact outbox record must commit together'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_config_publications publication
    WHERE publication.action = 'ROLLBACK'
      AND NOT EXISTS (
        SELECT 1
        FROM public.payment_config_publications historical
        WHERE historical.id <> publication.id
          AND historical.config_version_id = publication.config_version_id
          AND historical.created_at <= publication.created_at
      )
  ) THEN
    RAISE EXCEPTION 'payment-config rollback must target a previously published immutable revision'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_config_publication_heads head
    LEFT JOIN public.payment_config_publications publication
      ON publication.id = head.publication_id
    LEFT JOIN public.config_versions revision
      ON revision.id = head.config_version_id
     AND revision.config_kind = head.config_kind
     AND revision.version = head.config_version
    WHERE publication.id IS NULL
       OR publication.config_version_id <> head.config_version_id
       OR revision.id IS NULL
       OR NOT (revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED'))
       OR (publication.action = 'PUBLISH' AND revision.lifecycle <> 'PUBLISHED')
       OR (publication.action = 'ROLLBACK' AND revision.lifecycle <> 'SUPERSEDED')
       OR EXISTS (
         SELECT 1 FROM public.payment_config_publications successor
         WHERE successor.replaces_publication_id = publication.id
       )
  ) THEN
    RAISE EXCEPTION 'payment-config publication head is inconsistent'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_config_publications publication
    WHERE NOT EXISTS (
      SELECT 1 FROM public.payment_config_publications successor
      WHERE successor.replaces_publication_id = publication.id
    )
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_config_publication_heads head
        WHERE head.publication_id = publication.id
      )
  ) THEN
    RAISE EXCEPTION 'payment-config publication leaf must equal its current head'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.assert_publication_outbox_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.event_type = 'CONTENT_PUBLICATION_CHANGED' AND NOT EXISTS (
    SELECT 1
    FROM public.content_publications publication
    JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE publication.id = NEW.aggregate_id
      AND NEW.aggregate_type = 'CONTENT_PUBLICATION'
      AND NEW.aggregate_version = 1
      AND NEW.primary_subject_id = publication.id
      AND NEW.secondary_subject_id = COALESCE(
        publication.idol_revision_id,
        publication.gift_revision_id,
        publication.homepage_revision_id,
        publication.policy_revision_id,
        publication.media_metadata_revision_id,
        publication.site_locale_config_revision_id
      )
      AND NEW.locale IS NOT NULL
      AND NEW.market IS NULL
      AND NEW.currency IS NULL
      AND NEW.idempotency_key =
        'content-publication:' || publication.id::text || ':' || NEW.locale::text
      AND NEW.request_id = audit.request_id
      AND NEW.correlation_id = audit.correlation_id
      AND NEW.occurred_at = publication.published_at
      AND (
        (publication.content_type = 'IDOL' AND EXISTS (
          SELECT 1
          FROM public.idol_revision_translations translation
          WHERE translation.idol_revision_id = publication.idol_revision_id
            AND translation.locale = NEW.locale
        ))
        OR (publication.content_type = 'GIFT' AND EXISTS (
          SELECT 1
          FROM public.gift_revision_translations translation
          WHERE translation.gift_revision_id = publication.gift_revision_id
            AND translation.locale = NEW.locale
        ))
        OR (publication.content_type = 'HOMEPAGE' AND EXISTS (
          SELECT 1
          FROM public.homepage_revision_translations translation
          WHERE translation.homepage_revision_id = publication.homepage_revision_id
            AND translation.locale = NEW.locale
        ))
        OR (publication.content_type = 'POLICY' AND EXISTS (
          SELECT 1
          FROM public.policy_revision_translations translation
          WHERE translation.policy_revision_id = publication.policy_revision_id
            AND translation.locale = NEW.locale
        ))
        OR (publication.content_type = 'MEDIA_METADATA' AND EXISTS (
          SELECT 1
          FROM public.media_metadata_revision_translations translation
          WHERE translation.media_metadata_revision_id =
            publication.media_metadata_revision_id
            AND translation.locale = NEW.locale
        ))
        OR (publication.content_type = 'SITE_LOCALE_CONFIG' AND EXISTS (
          SELECT 1
          FROM public.site_locale_config_entries entry
          WHERE entry.site_locale_config_revision_id =
            publication.site_locale_config_revision_id
            AND entry.locale = NEW.locale
            AND entry.enabled
        ))
      )
  ) THEN
    RAISE EXCEPTION 'content publication outbox must reference its authoritative source'
      USING ERRCODE = '23514';
  ELSIF NEW.event_type = 'PAYMENT_CONFIG_PUBLISHED' AND NOT EXISTS (
    SELECT 1
    FROM public.payment_config_publications publication
    JOIN public.config_versions revision ON revision.id = publication.config_version_id
    JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE NEW.aggregate_type = 'PAYMENT_CONFIG'
      AND NEW.aggregate_id = publication.config_version_id
      AND NEW.aggregate_version = revision.version
      AND NEW.primary_subject_id = publication.id
      AND NEW.secondary_subject_id IS NULL
      AND NEW.locale IS NULL
      AND NEW.market IS NULL
      AND NEW.currency IS NULL
      AND NEW.idempotency_key = 'payment-config-publication:' || publication.id::text
      AND NEW.request_id = audit.request_id
      AND NEW.correlation_id = audit.correlation_id
      AND NEW.occurred_at = publication.created_at
  ) THEN
    RAISE EXCEPTION 'payment-config outbox must reference its authoritative source'
      USING ERRCODE = '23514';
  ELSIF NEW.event_type = 'PRICE_BOOK_PUBLISHED' AND NOT EXISTS (
    SELECT 1
    FROM public.price_book_publications publication
    JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE NEW.aggregate_type = 'PRICE_BOOK'
      AND NEW.aggregate_id = publication.price_book_id
      AND NEW.aggregate_version = publication.price_book_revision
      AND NEW.primary_subject_id = publication.id
      AND NEW.secondary_subject_id = publication.price_book_id
      AND NEW.locale IS NULL
      AND NEW.market = publication.market
      AND NEW.currency = publication.currency
      AND NEW.idempotency_key = 'price-book-publication:' || publication.id::text
      AND NEW.request_id = audit.request_id
      AND NEW.correlation_id = audit.correlation_id
      AND NEW.occurred_at = publication.published_at
  ) THEN
    RAISE EXCEPTION 'price-book outbox must reference its authoritative source'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER idol_publication_heads_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.idol_publication_heads
  FOR EACH ROW EXECUTE FUNCTION public.guard_publication_head_transition();
CREATE TRIGGER gift_publication_heads_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.gift_publication_heads
  FOR EACH ROW EXECUTE FUNCTION public.guard_publication_head_transition();
CREATE TRIGGER homepage_publication_heads_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.homepage_publication_heads
  FOR EACH ROW EXECUTE FUNCTION public.guard_publication_head_transition();
CREATE TRIGGER policy_publication_heads_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.policy_publication_heads
  FOR EACH ROW EXECUTE FUNCTION public.guard_publication_head_transition();
CREATE TRIGGER media_metadata_publication_heads_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.media_metadata_publication_heads
  FOR EACH ROW EXECUTE FUNCTION public.guard_publication_head_transition();
CREATE TRIGGER site_locale_config_publication_heads_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.site_locale_config_publication_heads
  FOR EACH ROW EXECUTE FUNCTION public.guard_publication_head_transition();
CREATE TRIGGER price_book_publication_heads_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.price_book_publication_heads
  FOR EACH ROW EXECUTE FUNCTION public.guard_publication_head_transition();
CREATE TRIGGER payment_config_publication_heads_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.payment_config_publication_heads
  FOR EACH ROW EXECUTE FUNCTION public.guard_publication_head_transition();

CREATE TRIGGER price_book_publications_append_only_trigger
  BEFORE UPDATE OR DELETE ON public.price_book_publications
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER price_book_publications_no_truncate_trigger
  BEFORE TRUNCATE ON public.price_book_publications
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE TRIGGER idol_publication_heads_no_truncate_trigger
  BEFORE TRUNCATE ON public.idol_publication_heads
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER gift_publication_heads_no_truncate_trigger
  BEFORE TRUNCATE ON public.gift_publication_heads
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER homepage_publication_heads_no_truncate_trigger
  BEFORE TRUNCATE ON public.homepage_publication_heads
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER policy_publication_heads_no_truncate_trigger
  BEFORE TRUNCATE ON public.policy_publication_heads
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER media_metadata_publication_heads_no_truncate_trigger
  BEFORE TRUNCATE ON public.media_metadata_publication_heads
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER site_locale_config_publication_heads_no_truncate_trigger
  BEFORE TRUNCATE ON public.site_locale_config_publication_heads
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER price_book_publication_heads_no_truncate_trigger
  BEFORE TRUNCATE ON public.price_book_publication_heads
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER payment_config_publication_heads_no_truncate_trigger
  BEFORE TRUNCATE ON public.payment_config_publication_heads
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE CONSTRAINT TRIGGER content_publications_head_consistency_trigger
  AFTER INSERT ON public.content_publications
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER idol_publication_heads_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.idol_publication_heads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER gift_publication_heads_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.gift_publication_heads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER homepage_publication_heads_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.homepage_publication_heads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER policy_publication_heads_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.policy_publication_heads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER media_metadata_publication_heads_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.media_metadata_publication_heads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER site_locale_config_publication_heads_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.site_locale_config_publication_heads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER idols_publication_head_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.idols
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER gifts_publication_head_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.gifts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER idol_revisions_publication_head_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.idol_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER gift_revisions_publication_head_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.gift_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER homepage_revisions_publication_head_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.homepage_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER policy_revisions_publication_head_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.policy_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER media_metadata_revisions_publication_head_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.media_metadata_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();
CREATE CONSTRAINT TRIGGER site_locale_revisions_publication_head_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.site_locale_config_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_heads();

CREATE CONSTRAINT TRIGGER price_book_publications_head_consistency_trigger
  AFTER INSERT ON public.price_book_publications
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_price_book_publication_heads();
CREATE CONSTRAINT TRIGGER price_book_publication_heads_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.price_book_publication_heads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_price_book_publication_heads();
CREATE CONSTRAINT TRIGGER price_books_publication_head_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.price_books
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_price_book_publication_heads();

CREATE CONSTRAINT TRIGGER payment_config_publications_head_consistency_trigger
  AFTER INSERT ON public.payment_config_publications
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_payment_config_publication_heads();
CREATE CONSTRAINT TRIGGER payment_config_publication_heads_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_config_publication_heads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_payment_config_publication_heads();
CREATE CONSTRAINT TRIGGER config_versions_publication_head_consistency_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.config_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_payment_config_publication_heads();

CREATE CONSTRAINT TRIGGER publication_outbox_source_consistency_trigger
  AFTER INSERT ON public.outbox_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_publication_outbox_source();

-- Upgrade existing 0005 content history in place. Publication rows are
-- append-only, so the migration only fills the newly introduced audit link,
-- reuses any exact audit/outbox evidence, and creates missing evidence without
-- rewriting an existing event.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.outbox_events outbox
    LEFT JOIN public.content_publications publication
      ON publication.id = outbox.primary_subject_id
    WHERE outbox.event_type = 'CONTENT_PUBLICATION_CHANGED'
      AND (
        publication.id IS NULL
        OR outbox.aggregate_type IS DISTINCT FROM 'CONTENT_PUBLICATION'
        OR outbox.aggregate_id IS DISTINCT FROM publication.id
        OR outbox.aggregate_version IS DISTINCT FROM 1
        OR outbox.secondary_subject_id IS DISTINCT FROM COALESCE(
          publication.idol_revision_id,
          publication.gift_revision_id,
          publication.homepage_revision_id,
          publication.policy_revision_id,
          publication.media_metadata_revision_id,
          publication.site_locale_config_revision_id
        )
        OR outbox.locale IS NULL
        OR outbox.market IS NOT NULL
        OR outbox.currency IS NOT NULL
        OR outbox.idempotency_key IS DISTINCT FROM
          'content-publication:' || publication.id::text || ':' || outbox.locale::text
        OR outbox.occurred_at IS DISTINCT FROM publication.published_at
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.outbox_events outbox
    WHERE outbox.event_type = 'CONTENT_PUBLICATION_CHANGED'
    GROUP BY outbox.primary_subject_id
    HAVING pg_catalog.count(DISTINCT outbox.request_id) <> 1
       OR pg_catalog.count(DISTINCT outbox.correlation_id) <> 1
  ) THEN
    RAISE EXCEPTION 'migration 0006 cannot adopt conflicting content-publication outbox evidence'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE TEMPORARY TABLE publication_0006_content_evidence
ON COMMIT DROP
AS
SELECT
  publication.id AS publication_id,
  COALESCE(
    existing_event.request_id,
    existing_audit.request_id,
    pg_catalog.gen_random_uuid()
  ) AS request_id,
  COALESCE(
    existing_event.correlation_id,
    existing_audit.correlation_id,
    pg_catalog.gen_random_uuid()
  ) AS correlation_id,
  NULL::uuid AS audit_log_id
FROM public.content_publications publication
LEFT JOIN LATERAL (
  SELECT outbox.request_id, outbox.correlation_id
  FROM public.outbox_events outbox
  WHERE outbox.event_type = 'CONTENT_PUBLICATION_CHANGED'
    AND outbox.primary_subject_id = publication.id
  ORDER BY outbox.locale::text
  LIMIT 1
) existing_event ON true
LEFT JOIN LATERAL (
  SELECT audit.request_id, audit.correlation_id
  FROM public.audit_logs audit
  WHERE audit.actor_type = 'ADMIN'
    AND audit.actor_id = publication.published_by
    AND audit.action = CASE publication.action
      WHEN 'PUBLISH' THEN 'CONTENT_PUBLISH'
      ELSE 'CONTENT_ROLLBACK'
    END
    AND audit.subject_type = 'CONTENT_PUBLICATION'
    AND audit.subject_id = publication.id
    AND audit.outcome = 'SUCCEEDED'
    AND audit.request_id IS NOT NULL
    AND audit.correlation_id IS NOT NULL
  ORDER BY audit.created_at, audit.id
  LIMIT 1
) existing_audit ON true;

INSERT INTO public.audit_logs (
  id,
  schema_version,
  actor_type,
  actor_id,
  task_name,
  action,
  subject_type,
  subject_id,
  reason_code,
  request_id,
  correlation_id,
  outcome,
  field_category,
  created_at
)
SELECT
  pg_catalog.gen_random_uuid(),
  1,
  'ADMIN',
  publication.published_by,
  NULL,
  CASE publication.action
    WHEN 'PUBLISH' THEN 'CONTENT_PUBLISH'
    ELSE 'CONTENT_ROLLBACK'
  END,
  'CONTENT_PUBLICATION',
  publication.id,
  'MIGRATION_BACKFILL',
  evidence.request_id,
  evidence.correlation_id,
  'SUCCEEDED',
  NULL,
  publication.published_at
FROM public.content_publications publication
JOIN publication_0006_content_evidence evidence
  ON evidence.publication_id = publication.id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.audit_logs audit
  WHERE audit.actor_type = 'ADMIN'
    AND audit.actor_id = publication.published_by
    AND audit.action = CASE publication.action
      WHEN 'PUBLISH' THEN 'CONTENT_PUBLISH'
      ELSE 'CONTENT_ROLLBACK'
    END
    AND audit.subject_type = 'CONTENT_PUBLICATION'
    AND audit.subject_id = publication.id
    AND audit.outcome = 'SUCCEEDED'
    AND audit.request_id = evidence.request_id
    AND audit.correlation_id = evidence.correlation_id
);

UPDATE publication_0006_content_evidence evidence
SET audit_log_id = (
  SELECT audit.id
  FROM public.content_publications publication
  JOIN public.audit_logs audit
    ON audit.actor_type = 'ADMIN'
   AND audit.actor_id = publication.published_by
   AND audit.action = CASE publication.action
      WHEN 'PUBLISH' THEN 'CONTENT_PUBLISH'
      ELSE 'CONTENT_ROLLBACK'
    END
   AND audit.subject_type = 'CONTENT_PUBLICATION'
   AND audit.subject_id = publication.id
   AND audit.outcome = 'SUCCEEDED'
   AND audit.request_id = evidence.request_id
   AND audit.correlation_id = evidence.correlation_id
  WHERE publication.id = evidence.publication_id
  ORDER BY (audit.reason_code = 'MIGRATION_BACKFILL') DESC,
    audit.created_at,
    audit.id
  LIMIT 1
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM publication_0006_content_evidence
    WHERE audit_log_id IS NULL
  ) THEN
    RAISE EXCEPTION 'migration 0006 could not establish content-publication audit evidence'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

UPDATE public.content_publications publication
SET audit_log_id = evidence.audit_log_id
FROM publication_0006_content_evidence evidence
WHERE evidence.publication_id = publication.id;

SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE public.content_publications
  ALTER COLUMN audit_log_id SET NOT NULL;
CREATE TRIGGER content_publications_append_only_trigger
  BEFORE UPDATE OR DELETE ON public.content_publications
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO public.outbox_events (
  id,
  schema_version,
  event_type,
  aggregate_type,
  aggregate_id,
  aggregate_version,
  primary_subject_id,
  secondary_subject_id,
  locale,
  market,
  currency,
  idempotency_key,
  correlation_id,
  causation_id,
  request_id,
  trace_id,
  occurred_at,
  available_at,
  created_at
)
SELECT
  pg_catalog.gen_random_uuid(),
  1,
  'CONTENT_PUBLICATION_CHANGED',
  'CONTENT_PUBLICATION',
  publication.id,
  1,
  publication.id,
  COALESCE(
    publication.idol_revision_id,
    publication.gift_revision_id,
    publication.homepage_revision_id,
    publication.policy_revision_id,
    publication.media_metadata_revision_id,
    publication.site_locale_config_revision_id
  ),
  locale.value,
  NULL,
  NULL,
  'content-publication:' || publication.id::text || ':' || locale.value::text,
  evidence.correlation_id,
  NULL,
  evidence.request_id,
  NULL,
  publication.published_at,
  publication.published_at,
  GREATEST(publication.published_at, pg_catalog.transaction_timestamp())
FROM public.content_publications publication
JOIN publication_0006_content_evidence evidence
  ON evidence.publication_id = publication.id
CROSS JOIN (
  VALUES
    ('en'::public.supported_locale),
    ('zh-CN'::public.supported_locale),
    ('th'::public.supported_locale),
    ('vi'::public.supported_locale),
    ('ja'::public.supported_locale),
    ('es'::public.supported_locale),
    ('pt'::public.supported_locale)
) locale(value)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.outbox_events existing
  WHERE existing.event_type = 'CONTENT_PUBLICATION_CHANGED'
    AND existing.primary_subject_id = publication.id
    AND existing.locale = locale.value
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.payment_config_publications publication
    JOIN public.config_versions revision
      ON revision.id = publication.config_version_id
    LEFT JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE audit.id IS NULL
       OR audit.actor_type <> 'ADMIN'
       OR audit.actor_id IS DISTINCT FROM publication.published_by
       OR audit.action <> CASE publication.action
          WHEN 'PUBLISH' THEN 'PAYMENT_CONFIG_PUBLISH'
          ELSE 'PAYMENT_CONFIG_ROLLBACK'
        END
       OR audit.subject_type <> 'PAYMENT_CONFIG_PUBLICATION'
       OR audit.subject_id <> publication.id
       OR audit.outcome <> 'SUCCEEDED'
       OR audit.request_id IS NULL
       OR audit.correlation_id IS NULL
       OR (
         SELECT pg_catalog.count(*)
         FROM public.outbox_events outbox
         WHERE outbox.event_type = 'PAYMENT_CONFIG_PUBLISHED'
           AND outbox.aggregate_type = 'PAYMENT_CONFIG'
           AND outbox.aggregate_id = publication.config_version_id
           AND outbox.aggregate_version = revision.version
           AND outbox.primary_subject_id = publication.id
           AND outbox.secondary_subject_id IS NULL
           AND outbox.locale IS NULL
           AND outbox.market IS NULL
           AND outbox.currency IS NULL
           AND outbox.idempotency_key =
             'payment-config-publication:' || publication.id::text
           AND outbox.request_id = audit.request_id
           AND outbox.correlation_id = audit.correlation_id
           AND outbox.occurred_at = publication.created_at
       ) <> 1
  ) THEN
    RAISE EXCEPTION 'migration 0006 cannot adopt conflicting payment-config publication evidence'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

INSERT INTO public.idol_publication_heads (
  id, schema_version, idol_id, publication_id, idol_revision_id,
  version, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), 1, publication.idol_id, publication.id,
  publication.idol_revision_id, 1,
  pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
FROM public.content_publications publication
WHERE publication.content_type = 'IDOL'
  AND NOT EXISTS (
    SELECT 1 FROM public.content_publications successor
    WHERE successor.replaces_publication_id = publication.id
  );

INSERT INTO public.gift_publication_heads (
  id, schema_version, gift_id, publication_id, gift_revision_id,
  version, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), 1, publication.gift_id, publication.id,
  publication.gift_revision_id, 1,
  pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
FROM public.content_publications publication
WHERE publication.content_type = 'GIFT'
  AND NOT EXISTS (
    SELECT 1 FROM public.content_publications successor
    WHERE successor.replaces_publication_id = publication.id
  );

INSERT INTO public.homepage_publication_heads (
  id, schema_version, singleton_key, publication_id, homepage_revision_id,
  version, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), 1, true, publication.id,
  publication.homepage_revision_id, 1,
  pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
FROM public.content_publications publication
WHERE publication.content_type = 'HOMEPAGE'
  AND NOT EXISTS (
    SELECT 1 FROM public.content_publications successor
    WHERE successor.replaces_publication_id = publication.id
  );

INSERT INTO public.policy_publication_heads (
  id, schema_version, policy_key, publication_id, policy_revision_id,
  version, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), 1, publication.policy_key, publication.id,
  publication.policy_revision_id, 1,
  pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
FROM public.content_publications publication
WHERE publication.content_type = 'POLICY'
  AND NOT EXISTS (
    SELECT 1 FROM public.content_publications successor
    WHERE successor.replaces_publication_id = publication.id
  );

INSERT INTO public.media_metadata_publication_heads (
  id, schema_version, media_asset_id, publication_id,
  media_metadata_revision_id, version, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), 1, publication.media_asset_id, publication.id,
  publication.media_metadata_revision_id, 1,
  pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
FROM public.content_publications publication
WHERE publication.content_type = 'MEDIA_METADATA'
  AND NOT EXISTS (
    SELECT 1 FROM public.content_publications successor
    WHERE successor.replaces_publication_id = publication.id
  );

INSERT INTO public.site_locale_config_publication_heads (
  id, schema_version, singleton_key, publication_id,
  site_locale_config_revision_id, version, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), 1, true, publication.id,
  publication.site_locale_config_revision_id, 1,
  pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
FROM public.content_publications publication
WHERE publication.content_type = 'SITE_LOCALE_CONFIG'
  AND NOT EXISTS (
    SELECT 1 FROM public.content_publications successor
    WHERE successor.replaces_publication_id = publication.id
  );

INSERT INTO public.payment_config_publication_heads (
  id, schema_version, singleton_key, config_kind, publication_id,
  config_version_id, config_version, version, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), 1, true, revision.config_kind, publication.id,
  publication.config_version_id, revision.version, 1,
  pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
FROM public.payment_config_publications publication
JOIN public.config_versions revision
  ON revision.id = publication.config_version_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_config_publications successor
  WHERE successor.replaces_publication_id = publication.id
);
