SET search_path = public;

CREATE FUNCTION guard_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.lifecycle IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED') THEN
      RAISE EXCEPTION 'published revision rows cannot be deleted'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF (to_jsonb(NEW) - 'lifecycle' - 'validated_at' - 'published_at' - 'superseded_at' - 'archived_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'lifecycle' - 'validated_at' - 'published_at' - 'superseded_at' - 'archived_at') THEN
    RAISE EXCEPTION 'revision content is immutable; create a new revision'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    NEW.lifecycle = OLD.lifecycle
    OR (OLD.lifecycle = 'DRAFT' AND NEW.lifecycle = 'VALIDATED')
    OR (OLD.lifecycle = 'VALIDATED' AND NEW.lifecycle = 'PUBLISHED')
    OR (OLD.lifecycle = 'PUBLISHED' AND NEW.lifecycle = 'SUPERSEDED')
    OR (OLD.lifecycle = 'SUPERSEDED' AND NEW.lifecycle = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'invalid revision lifecycle transition: % -> %', OLD.lifecycle, NEW.lifecycle
      USING ERRCODE = '23514';
  END IF;

  IF NEW.lifecycle = OLD.lifecycle AND (
    NEW.validated_at IS DISTINCT FROM OLD.validated_at
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
    OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
  ) THEN
    RAISE EXCEPTION 'lifecycle timestamps are immutable without a state transition'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_revision_lifecycle_times()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.lifecycle <> 'DRAFT' THEN
    RAISE EXCEPTION 'new revisions must start in DRAFT' USING ERRCODE = '23514';
  END IF;
  IF NEW.lifecycle = 'DRAFT' AND (
    NEW.validated_at IS NOT NULL OR NEW.published_at IS NOT NULL
    OR NEW.superseded_at IS NOT NULL OR NEW.archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'draft revisions cannot carry lifecycle timestamps'
      USING ERRCODE = '23514';
  ELSIF NEW.lifecycle = 'VALIDATED' AND (
    NEW.validated_at IS NULL OR NEW.published_at IS NOT NULL
    OR NEW.superseded_at IS NOT NULL OR NEW.archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'validated revisions require only validated_at'
      USING ERRCODE = '23514';
  ELSIF NEW.lifecycle = 'PUBLISHED' AND (
    NEW.validated_at IS NULL OR NEW.published_at IS NULL
    OR NEW.superseded_at IS NOT NULL OR NEW.archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'published revisions require validation and publication timestamps'
      USING ERRCODE = '23514';
  ELSIF NEW.lifecycle = 'SUPERSEDED' AND (
    NEW.validated_at IS NULL OR NEW.published_at IS NULL
    OR NEW.superseded_at IS NULL OR NEW.archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'superseded revisions require validation, publication, and supersession timestamps'
      USING ERRCODE = '23514';
  ELSIF NEW.lifecycle = 'ARCHIVED' AND (
    NEW.validated_at IS NULL OR NEW.published_at IS NULL
    OR NEW.superseded_at IS NULL OR NEW.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'archived revisions require the complete lifecycle timeline'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.validated_at IS NOT NULL AND NEW.validated_at < NEW.created_at THEN
    RAISE EXCEPTION 'validated_at cannot precede created_at' USING ERRCODE = '23514';
  END IF;
  IF NEW.published_at IS NOT NULL AND NEW.validated_at IS NULL THEN
    RAISE EXCEPTION 'published_at requires validated_at' USING ERRCODE = '23514';
  END IF;
  IF NEW.published_at IS NOT NULL AND NEW.published_at < NEW.validated_at THEN
    RAISE EXCEPTION 'published_at cannot precede validated_at' USING ERRCODE = '23514';
  END IF;
  IF NEW.superseded_at IS NOT NULL AND NEW.published_at IS NULL THEN
    RAISE EXCEPTION 'superseded_at requires published_at' USING ERRCODE = '23514';
  END IF;
  IF NEW.superseded_at IS NOT NULL AND NEW.superseded_at < NEW.published_at THEN
    RAISE EXCEPTION 'superseded_at cannot precede published_at' USING ERRCODE = '23514';
  END IF;
  IF NEW.archived_at IS NOT NULL AND NEW.superseded_at IS NOT NULL
     AND NEW.archived_at < NEW.superseded_at THEN
    RAISE EXCEPTION 'archived_at cannot precede superseded_at' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_translation_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.locale = 'en' AND NEW.source_hash <> NEW.translated_from_source_hash THEN
    RAISE EXCEPTION 'English source and translated-from hashes must match'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.origin = 'IMPORT' AND NEW.import_batch_id IS NULL THEN
    RAISE EXCEPTION 'imported translations require import_batch_id'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.origin <> 'IMPORT' AND NEW.import_batch_id IS NOT NULL THEN
    RAISE EXCEPTION 'only imported translations may carry import_batch_id'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_translation_review_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  translation_table regclass := TG_ARGV[0]::regclass;
  translation_column text := TG_ARGV[1];
  parent_table regclass := TG_ARGV[2]::regclass;
  parent_column text := TG_ARGV[3];
  editor uuid;
  edited timestamptz;
  localized_hash sha256_hex;
  english_hash sha256_hex;
  translation_origin text;
  parent_lifecycle text;
  previous_sequence bigint;
  previous_status text;
  previous_submitted_at timestamptz;
BEGIN
  EXECUTE format(
    'SELECT t.editor_id, t.edited_at, t.source_hash, t.translated_from_source_hash, t.origin, p.lifecycle '
    'FROM %s t JOIN %s p ON p.id = t.%I WHERE t.id = $1',
    translation_table,
    parent_table,
    parent_column
  ) INTO editor, edited, localized_hash, english_hash, translation_origin, parent_lifecycle
    USING (to_jsonb(NEW) ->> translation_column)::uuid;

  IF editor IS NULL THEN
    RAISE EXCEPTION 'translation review references a missing translation'
      USING ERRCODE = '23503';
  END IF;
  IF parent_lifecycle IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'published translation review evidence is immutable'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE format(
    'SELECT sequence, status, submitted_at FROM %s WHERE %I = $1 ORDER BY sequence DESC LIMIT 1',
    TG_RELID::regclass,
    translation_column
  ) INTO previous_sequence, previous_status, previous_submitted_at
    USING (to_jsonb(NEW) ->> translation_column)::uuid;

  IF previous_sequence IS NULL THEN
    IF NEW.sequence <> 1 OR NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'the first translation review event must be DRAFT sequence 1'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.sequence <> previous_sequence + 1 THEN
    RAISE EXCEPTION 'translation review sequence must increment exactly once'
      USING ERRCODE = '23514';
  ELSIF previous_status = 'APPROVED' THEN
    RAISE EXCEPTION 'approved translation evidence is terminal for this revision'
      USING ERRCODE = '55000';
  ELSIF NOT (
    (previous_status = 'DRAFT' AND NEW.status = 'IN_REVIEW')
    OR (previous_status = 'IN_REVIEW' AND NEW.status = 'APPROVED')
  ) THEN
    RAISE EXCEPTION 'invalid translation review transition: % -> %', previous_status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'DRAFT' THEN
    IF NEW.submitted_at IS NOT NULL OR NEW.reviewer_id IS NOT NULL
       OR NEW.reviewed_at IS NOT NULL OR NEW.reviewed_source_hash IS NOT NULL
       OR NEW.reviewed_content_hash IS NOT NULL THEN
      RAISE EXCEPTION 'draft review events cannot carry review evidence'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'IN_REVIEW' THEN
    IF NEW.submitted_at IS NULL OR NEW.submitted_at < edited
       OR NEW.reviewer_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
       OR NEW.reviewed_source_hash IS NOT NULL OR NEW.reviewed_content_hash IS NOT NULL THEN
      RAISE EXCEPTION 'in-review evidence is inconsistent with the translation edit'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'APPROVED' THEN
    IF NEW.submitted_at IS NOT NULL OR NEW.reviewer_id IS NULL OR NEW.reviewed_at IS NULL
       OR NEW.reviewed_source_hash IS NULL OR NEW.reviewed_content_hash IS NULL
       OR NEW.reviewer_id = editor OR NEW.reviewed_at < edited
       OR NEW.reviewed_at < previous_submitted_at
       OR NEW.reviewed_source_hash <> english_hash
       OR NEW.reviewed_content_hash <> localized_hash THEN
      RAISE EXCEPTION 'approval must be independent and bind current source/content hashes'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION assert_translation_initial_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  review_count integer;
BEGIN
  EXECUTE format(
    'SELECT count(*) FROM %s WHERE %I = $1 AND sequence = 1 AND status = ''DRAFT''',
    TG_ARGV[0]::regclass,
    TG_ARGV[1]
  ) INTO review_count USING NEW.id;
  IF review_count <> 1 THEN
    RAISE EXCEPTION 'translation creation requires one initial DRAFT review event'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_translation_package(
  translation_table regclass,
  parent_column text,
  parent_id uuid,
  review_table regclass,
  review_translation_column text
)
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
  EXECUTE format(
    'SELECT source_hash FROM %s WHERE %I = $1 AND locale = ''en''',
    translation_table,
    parent_column
  ) INTO english_hash USING parent_id;

  IF english_hash IS NULL THEN
    RAISE EXCEPTION 'publication requires an English translation row'
      USING ERRCODE = '23514';
  END IF;

  EXECUTE format(
    'SELECT count(*), '
    'count(*) FILTER (WHERE latest.status = ''APPROVED''), '
    'count(*) FILTER (WHERE t.translated_from_source_hash = $2) '
    'FROM %s t '
    'LEFT JOIN LATERAL ('
    '  SELECT r.status FROM %s r '
    '  WHERE r.%I = t.id ORDER BY r.sequence DESC LIMIT 1'
    ') latest ON true '
    'WHERE t.%I = $1',
    translation_table,
    review_table,
    review_translation_column,
    parent_column
  ) INTO translation_count, approved_count, lineage_count
    USING parent_id, english_hash;

  IF translation_count <> 7 OR approved_count <> 7 OR lineage_count <> 7 THEN
    RAISE EXCEPTION 'publication requires seven approved translations with current English lineage'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION guard_revision_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.lifecycle = 'PUBLISHED'
     AND (TG_OP = 'INSERT' OR OLD.lifecycle IS DISTINCT FROM NEW.lifecycle) THEN
    PERFORM assert_translation_package(
      TG_ARGV[0]::regclass,
      TG_ARGV[1],
      NEW.id,
      TG_ARGV[2]::regclass,
      TG_ARGV[3]
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE media_assets (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  checksum_sha256 sha256_hex NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 9007199254740991),
  object_key media_object_key NOT NULL,
  processing_status text NOT NULL CHECK (processing_status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED')),
  processing_error_code text CHECK (processing_error_code IS NULL OR processing_error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  rights_status text NOT NULL CHECK (rights_status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  rights_reference text NOT NULL CHECK (length(rights_reference) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT media_assets_checksum_unique UNIQUE (checksum_sha256),
  CONSTRAINT media_assets_object_key_unique UNIQUE (object_key),
  CONSTRAINT media_assets_processing_error_check CHECK (
    (processing_status = 'FAILED' AND processing_error_code IS NOT NULL)
    OR (processing_status <> 'FAILED' AND processing_error_code IS NULL)
  )
);

CREATE TABLE media_variants (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  format text NOT NULL CHECK (format IN ('AVIF', 'WEBP', 'JPEG')),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 9007199254740991),
  checksum_sha256 sha256_hex NOT NULL,
  object_key media_object_key NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING', 'READY', 'FAILED', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT media_variants_shape_unique UNIQUE (media_asset_id, format, width, height),
  CONSTRAINT media_variants_object_key_unique UNIQUE (object_key)
);

CREATE TABLE media_metadata_revisions (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  revision positive_version NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  presentation_kind text NOT NULL CHECK (presentation_kind IN ('INFORMATIVE', 'DECORATIVE')),
  focal_x numeric(6,5) NOT NULL CHECK (focal_x BETWEEN 0 AND 1),
  focal_y numeric(6,5) NOT NULL CHECK (focal_y BETWEEN 0 AND 1),
  created_by uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  validated_at timestamptz,
  published_at timestamptz,
  superseded_at timestamptz,
  archived_at timestamptz,
  CONSTRAINT media_metadata_revisions_asset_revision_unique UNIQUE (media_asset_id, revision),
  CONSTRAINT media_metadata_revisions_id_asset_unique UNIQUE (id, media_asset_id)
);

CREATE UNIQUE INDEX media_metadata_revisions_one_published_per_asset_idx
  ON media_metadata_revisions (media_asset_id) WHERE lifecycle = 'PUBLISHED';

CREATE TABLE media_metadata_revision_translations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  media_metadata_revision_id uuid NOT NULL REFERENCES media_metadata_revisions(id) ON DELETE RESTRICT,
  locale supported_locale NOT NULL,
  source_hash sha256_hex NOT NULL,
  translated_from_source_hash sha256_hex NOT NULL,
  origin text NOT NULL CHECK (origin IN ('HUMAN', 'MACHINE', 'IMPORT')),
  import_batch_id uuid,
  editor_id uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  edited_at timestamptz NOT NULL,
  alt text NOT NULL CHECK (length(alt) <= 300),
  title text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 160),
  caption text CHECK (caption IS NULL OR length(caption) BETWEEN 1 AND 300),
  CONSTRAINT media_metadata_translation_locale_unique UNIQUE (media_metadata_revision_id, locale)
);

CREATE TABLE media_metadata_translation_reviews (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  media_metadata_translation_id uuid NOT NULL REFERENCES media_metadata_revision_translations(id) ON DELETE RESTRICT,
  sequence positive_version NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')),
  submitted_at timestamptz,
  reviewer_id uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  reviewed_source_hash sha256_hex,
  reviewed_content_hash sha256_hex,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT media_metadata_translation_review_sequence_unique UNIQUE (media_metadata_translation_id, sequence)
);

CREATE TABLE idols (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  handle text NOT NULL CHECK (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(handle) <= 128),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  accepting_gifts boolean NOT NULL DEFAULT false,
  draft_revision_id uuid,
  published_revision_id uuid,
  version positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT idols_handle_unique UNIQUE (handle),
  CONSTRAINT idols_accepting_gifts_check CHECK (NOT accepting_gifts OR status = 'active')
);

CREATE TABLE idol_revisions (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  idol_id uuid NOT NULL REFERENCES idols(id) ON DELETE RESTRICT,
  revision positive_version NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  theme_accent text NOT NULL CHECK (theme_accent ~ '^#[A-Fa-f0-9]{6}$'),
  hero_text_tone text NOT NULL CHECK (hero_text_tone IN ('light', 'dark')),
  display_order integer NOT NULL CHECK (display_order >= 0),
  created_by uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  validated_at timestamptz,
  published_at timestamptz,
  superseded_at timestamptz,
  archived_at timestamptz,
  CONSTRAINT idol_revisions_id_owner_unique UNIQUE (id, idol_id),
  CONSTRAINT idol_revisions_owner_revision_unique UNIQUE (idol_id, revision)
);

CREATE UNIQUE INDEX idol_revisions_one_published_per_idol_idx
  ON idol_revisions (idol_id) WHERE lifecycle = 'PUBLISHED';

ALTER TABLE idols
  ADD CONSTRAINT idols_draft_revision_owner_fk
    FOREIGN KEY (draft_revision_id, id) REFERENCES idol_revisions(id, idol_id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT idols_published_revision_owner_fk
    FOREIGN KEY (published_revision_id, id) REFERENCES idol_revisions(id, idol_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE idol_revision_translations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  idol_revision_id uuid NOT NULL REFERENCES idol_revisions(id) ON DELETE RESTRICT,
  locale supported_locale NOT NULL,
  source_hash sha256_hex NOT NULL,
  translated_from_source_hash sha256_hex NOT NULL,
  origin text NOT NULL CHECK (origin IN ('HUMAN', 'MACHINE', 'IMPORT')),
  import_batch_id uuid,
  editor_id uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  edited_at timestamptz NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  short_bio text NOT NULL CHECK (length(short_bio) BETWEEN 1 AND 160),
  full_bio text NOT NULL CHECK (length(full_bio) BETWEEN 1 AND 600),
  seo_title text NOT NULL CHECK (length(seo_title) BETWEEN 1 AND 60),
  seo_description text NOT NULL CHECK (length(seo_description) BETWEEN 1 AND 155),
  CONSTRAINT idol_revision_translation_locale_unique UNIQUE (idol_revision_id, locale)
);

CREATE TABLE idol_translation_reviews (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  idol_translation_id uuid NOT NULL REFERENCES idol_revision_translations(id) ON DELETE RESTRICT,
  sequence positive_version NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')),
  submitted_at timestamptz,
  reviewer_id uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  reviewed_source_hash sha256_hex,
  reviewed_content_hash sha256_hex,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT idol_translation_review_sequence_unique UNIQUE (idol_translation_id, sequence)
);

CREATE TABLE idol_revision_media (
  idol_revision_id uuid NOT NULL REFERENCES idol_revisions(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('PORTRAIT', 'HERO_DESKTOP', 'HERO_MOBILE', 'GALLERY')),
  media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  media_metadata_revision_id uuid NOT NULL REFERENCES media_metadata_revisions(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY (idol_revision_id, role, sort_order),
  CONSTRAINT idol_revision_media_metadata_owner_fk
    FOREIGN KEY (media_metadata_revision_id, media_asset_id)
    REFERENCES media_metadata_revisions(id, media_asset_id) ON DELETE RESTRICT,
  CONSTRAINT idol_revision_media_asset_once_unique UNIQUE (idol_revision_id, media_asset_id, media_metadata_revision_id)
);

CREATE TABLE gifts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  handle text NOT NULL CHECK (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(handle) <= 128),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  draft_revision_id uuid,
  published_revision_id uuid,
  version positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT gifts_handle_unique UNIQUE (handle)
);

CREATE TABLE gift_revisions (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  gift_id uuid NOT NULL REFERENCES gifts(id) ON DELETE RESTRICT,
  revision positive_version NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  category text NOT NULL CHECK (category IN ('FLOWERS', 'FOOD', 'BEAUTY', 'ACCESSORY', 'OTHER')),
  delivery_minimum integer NOT NULL CHECK (delivery_minimum > 0),
  delivery_maximum integer NOT NULL CHECK (delivery_maximum >= delivery_minimum),
  delivery_unit text NOT NULL CHECK (delivery_unit IN ('DAY', 'WEEK')),
  requires_safety_notice boolean NOT NULL,
  shipping_mode text NOT NULL DEFAULT 'internal_to_idol' CHECK (shipping_mode = 'internal_to_idol'),
  created_by uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  validated_at timestamptz,
  published_at timestamptz,
  superseded_at timestamptz,
  archived_at timestamptz,
  CONSTRAINT gift_revisions_id_owner_unique UNIQUE (id, gift_id),
  CONSTRAINT gift_revisions_owner_revision_unique UNIQUE (gift_id, revision)
);

CREATE UNIQUE INDEX gift_revisions_one_published_per_gift_idx
  ON gift_revisions (gift_id) WHERE lifecycle = 'PUBLISHED';

ALTER TABLE gifts
  ADD CONSTRAINT gifts_draft_revision_owner_fk
    FOREIGN KEY (draft_revision_id, id) REFERENCES gift_revisions(id, gift_id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT gifts_published_revision_owner_fk
    FOREIGN KEY (published_revision_id, id) REFERENCES gift_revisions(id, gift_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE gift_revision_contents (
  gift_revision_id uuid NOT NULL REFERENCES gift_revisions(id) ON DELETE RESTRICT,
  component_code text NOT NULL CHECK (component_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (unit IN ('ITEM', 'GRAM', 'MILLILITER')),
  PRIMARY KEY (gift_revision_id, component_code)
);

CREATE TABLE gift_variants (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  gift_id uuid NOT NULL REFERENCES gifts(id) ON DELETE RESTRICT,
  sku text NOT NULL CHECK (sku ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(sku) <= 64),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  inventory_policy text NOT NULL CHECK (inventory_policy IN ('TRACKED', 'PROCURE_ON_DEMAND', 'PREORDER')),
  version positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT gift_variants_sku_unique UNIQUE (sku),
  CONSTRAINT gift_variants_id_owner_unique UNIQUE (id, gift_id)
);

CREATE TABLE gift_variant_idol_eligibility (
  gift_variant_id uuid NOT NULL REFERENCES gift_variants(id) ON DELETE RESTRICT,
  idol_id uuid NOT NULL REFERENCES idols(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (gift_variant_id, idol_id)
);

CREATE TABLE gift_revision_translations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  gift_revision_id uuid NOT NULL REFERENCES gift_revisions(id) ON DELETE RESTRICT,
  locale supported_locale NOT NULL,
  source_hash sha256_hex NOT NULL,
  translated_from_source_hash sha256_hex NOT NULL,
  origin text NOT NULL CHECK (origin IN ('HUMAN', 'MACHINE', 'IMPORT')),
  import_batch_id uuid,
  editor_id uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  edited_at timestamptz NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  subtitle text CHECK (subtitle IS NULL OR length(subtitle) BETWEEN 1 AND 80),
  short_description text NOT NULL CHECK (length(short_description) BETWEEN 1 AND 160),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 600),
  fulfillment_description text NOT NULL CHECK (length(fulfillment_description) BETWEEN 1 AND 600),
  safety_notice text CHECK (safety_notice IS NULL OR length(safety_notice) BETWEEN 1 AND 600),
  seo_title text NOT NULL CHECK (length(seo_title) BETWEEN 1 AND 60),
  seo_description text NOT NULL CHECK (length(seo_description) BETWEEN 1 AND 155),
  CONSTRAINT gift_revision_translation_locale_unique UNIQUE (gift_revision_id, locale)
);

CREATE TABLE gift_translation_reviews (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  gift_translation_id uuid NOT NULL REFERENCES gift_revision_translations(id) ON DELETE RESTRICT,
  sequence positive_version NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')),
  submitted_at timestamptz,
  reviewer_id uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  reviewed_source_hash sha256_hex,
  reviewed_content_hash sha256_hex,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT gift_translation_review_sequence_unique UNIQUE (gift_translation_id, sequence)
);

CREATE TABLE gift_variant_labels (
  gift_translation_id uuid NOT NULL REFERENCES gift_revision_translations(id) ON DELETE RESTRICT,
  gift_variant_id uuid NOT NULL REFERENCES gift_variants(id) ON DELETE RESTRICT,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  PRIMARY KEY (gift_translation_id, gift_variant_id)
);

CREATE TABLE gift_revision_media (
  gift_revision_id uuid NOT NULL REFERENCES gift_revisions(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('PRIMARY', 'GALLERY')),
  media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  media_metadata_revision_id uuid NOT NULL REFERENCES media_metadata_revisions(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY (gift_revision_id, role, sort_order),
  CONSTRAINT gift_revision_media_metadata_owner_fk
    FOREIGN KEY (media_metadata_revision_id, media_asset_id)
    REFERENCES media_metadata_revisions(id, media_asset_id) ON DELETE RESTRICT,
  CONSTRAINT gift_revision_media_asset_once_unique UNIQUE (gift_revision_id, media_asset_id, media_metadata_revision_id)
);

CREATE TABLE policies (
  policy_key text PRIMARY KEY CHECK (policy_key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND length(policy_key) <= 64),
  kind text NOT NULL CHECK (kind IN ('TERMS', 'PRIVACY', 'REFUND', 'DELIVERY')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT policies_key_kind_unique UNIQUE (policy_key, kind)
);

CREATE TABLE homepage_revisions (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  revision positive_version NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  created_by uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  validated_at timestamptz,
  published_at timestamptz,
  superseded_at timestamptz,
  archived_at timestamptz,
  CONSTRAINT homepage_revisions_revision_unique UNIQUE (revision)
);

CREATE UNIQUE INDEX homepage_revisions_one_published_idx
  ON homepage_revisions ((true)) WHERE lifecycle = 'PUBLISHED';

CREATE TABLE homepage_revision_translations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  homepage_revision_id uuid NOT NULL REFERENCES homepage_revisions(id) ON DELETE RESTRICT,
  locale supported_locale NOT NULL,
  source_hash sha256_hex NOT NULL,
  translated_from_source_hash sha256_hex NOT NULL,
  origin text NOT NULL CHECK (origin IN ('HUMAN', 'MACHINE', 'IMPORT')),
  import_batch_id uuid,
  editor_id uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  edited_at timestamptz NOT NULL,
  hero_title text NOT NULL CHECK (length(hero_title) BETWEEN 1 AND 120),
  hero_subtitle text NOT NULL CHECK (length(hero_subtitle) BETWEEN 1 AND 240),
  cta_label text NOT NULL CHECK (length(cta_label) BETWEEN 1 AND 80),
  announcement text CHECK (announcement IS NULL OR length(announcement) BETWEEN 1 AND 240),
  seo_title text NOT NULL CHECK (length(seo_title) BETWEEN 1 AND 60),
  seo_description text NOT NULL CHECK (length(seo_description) BETWEEN 1 AND 155),
  CONSTRAINT homepage_revision_translation_locale_unique UNIQUE (homepage_revision_id, locale)
);

CREATE TABLE homepage_translation_reviews (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  homepage_translation_id uuid NOT NULL REFERENCES homepage_revision_translations(id) ON DELETE RESTRICT,
  sequence positive_version NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')),
  submitted_at timestamptz,
  reviewer_id uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  reviewed_source_hash sha256_hex,
  reviewed_content_hash sha256_hex,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT homepage_translation_review_sequence_unique UNIQUE (homepage_translation_id, sequence)
);

CREATE TABLE homepage_slots (
  homepage_revision_id uuid NOT NULL REFERENCES homepage_revisions(id) ON DELETE RESTRICT,
  slot_key text NOT NULL CHECK (slot_key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND length(slot_key) <= 64),
  kind text NOT NULL CHECK (kind IN ('HERO_IDOL', 'FEATURED_IDOL', 'FEATURED_GIFT', 'POLICY_LINK')),
  idol_id uuid REFERENCES idols(id) ON DELETE RESTRICT,
  gift_id uuid REFERENCES gifts(id) ON DELETE RESTRICT,
  policy_key text REFERENCES policies(policy_key) ON DELETE RESTRICT,
  desktop_media_asset_id uuid REFERENCES media_assets(id) ON DELETE RESTRICT,
  desktop_media_metadata_revision_id uuid REFERENCES media_metadata_revisions(id) ON DELETE RESTRICT,
  mobile_media_asset_id uuid REFERENCES media_assets(id) ON DELETE RESTRICT,
  mobile_media_metadata_revision_id uuid REFERENCES media_metadata_revisions(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY (homepage_revision_id, slot_key),
  CONSTRAINT homepage_slots_order_unique UNIQUE (homepage_revision_id, sort_order),
  CONSTRAINT homepage_slots_desktop_metadata_owner_fk
    FOREIGN KEY (desktop_media_metadata_revision_id, desktop_media_asset_id)
    REFERENCES media_metadata_revisions(id, media_asset_id) ON DELETE RESTRICT,
  CONSTRAINT homepage_slots_mobile_metadata_owner_fk
    FOREIGN KEY (mobile_media_metadata_revision_id, mobile_media_asset_id)
    REFERENCES media_metadata_revisions(id, media_asset_id) ON DELETE RESTRICT,
  CONSTRAINT homepage_slots_kind_shape_check CHECK (
    (kind = 'HERO_IDOL' AND idol_id IS NOT NULL AND gift_id IS NULL AND policy_key IS NULL
      AND desktop_media_asset_id IS NOT NULL AND desktop_media_metadata_revision_id IS NOT NULL
      AND mobile_media_asset_id IS NOT NULL AND mobile_media_metadata_revision_id IS NOT NULL
      AND desktop_media_asset_id <> mobile_media_asset_id
      AND desktop_media_metadata_revision_id <> mobile_media_metadata_revision_id)
    OR (kind = 'FEATURED_IDOL' AND idol_id IS NOT NULL AND gift_id IS NULL AND policy_key IS NULL
      AND desktop_media_asset_id IS NULL AND desktop_media_metadata_revision_id IS NULL
      AND mobile_media_asset_id IS NULL AND mobile_media_metadata_revision_id IS NULL)
    OR (kind = 'FEATURED_GIFT' AND idol_id IS NULL AND gift_id IS NOT NULL AND policy_key IS NULL
      AND desktop_media_asset_id IS NULL AND desktop_media_metadata_revision_id IS NULL
      AND mobile_media_asset_id IS NULL AND mobile_media_metadata_revision_id IS NULL)
    OR (kind = 'POLICY_LINK' AND idol_id IS NULL AND gift_id IS NULL AND policy_key IS NOT NULL
      AND desktop_media_asset_id IS NULL AND desktop_media_metadata_revision_id IS NULL
      AND mobile_media_asset_id IS NULL AND mobile_media_metadata_revision_id IS NULL)
  )
);

CREATE TABLE homepage_slot_translations (
  homepage_translation_id uuid NOT NULL REFERENCES homepage_revision_translations(id) ON DELETE RESTRICT,
  slot_key text NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  PRIMARY KEY (homepage_translation_id, slot_key)
);

CREATE TABLE policy_revisions (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  policy_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('TERMS', 'PRIVACY', 'REFUND', 'DELIVERY')),
  revision positive_version NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  effective_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  validated_at timestamptz,
  published_at timestamptz,
  superseded_at timestamptz,
  archived_at timestamptz,
  CONSTRAINT policy_revisions_id_key_unique UNIQUE (id, policy_key),
  CONSTRAINT policy_revisions_policy_fk
    FOREIGN KEY (policy_key, kind) REFERENCES policies(policy_key, kind) ON DELETE RESTRICT,
  CONSTRAINT policy_revisions_key_revision_unique UNIQUE (policy_key, revision)
);

CREATE UNIQUE INDEX policy_revisions_one_published_per_key_idx
  ON policy_revisions (policy_key) WHERE lifecycle = 'PUBLISHED';

CREATE TABLE policy_revision_translations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  policy_revision_id uuid NOT NULL REFERENCES policy_revisions(id) ON DELETE RESTRICT,
  locale supported_locale NOT NULL,
  source_hash sha256_hex NOT NULL,
  translated_from_source_hash sha256_hex NOT NULL,
  origin text NOT NULL CHECK (origin IN ('HUMAN', 'MACHINE', 'IMPORT')),
  import_batch_id uuid,
  editor_id uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  edited_at timestamptz NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 300),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  CONSTRAINT policy_revision_translation_locale_unique UNIQUE (policy_revision_id, locale),
  CONSTRAINT policy_translation_id_parent_unique UNIQUE (id, policy_revision_id)
);

CREATE TABLE policy_translation_reviews (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  policy_translation_id uuid NOT NULL REFERENCES policy_revision_translations(id) ON DELETE RESTRICT,
  sequence positive_version NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')),
  submitted_at timestamptz,
  reviewer_id uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  reviewed_source_hash sha256_hex,
  reviewed_content_hash sha256_hex,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT policy_translation_review_sequence_unique UNIQUE (policy_translation_id, sequence)
);

CREATE TABLE site_locale_config_revisions (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  revision positive_version NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  created_by uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  validated_at timestamptz,
  published_at timestamptz,
  superseded_at timestamptz,
  archived_at timestamptz,
  CONSTRAINT site_locale_config_revision_unique UNIQUE (revision)
);

CREATE UNIQUE INDEX site_locale_config_one_published_idx
  ON site_locale_config_revisions ((true)) WHERE lifecycle = 'PUBLISHED';

CREATE TABLE site_locale_config_entries (
  site_locale_config_revision_id uuid NOT NULL REFERENCES site_locale_config_revisions(id) ON DELETE RESTRICT,
  locale supported_locale NOT NULL,
  enabled boolean NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 6),
  PRIMARY KEY (site_locale_config_revision_id, locale),
  CONSTRAINT site_locale_config_sort_unique UNIQUE (site_locale_config_revision_id, sort_order)
);

CREATE TABLE content_publications (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  content_type text NOT NULL CHECK (content_type IN ('IDOL', 'GIFT', 'HOMEPAGE', 'POLICY', 'MEDIA_METADATA', 'SITE_LOCALE_CONFIG')),
  idol_id uuid REFERENCES idols(id) ON DELETE RESTRICT,
  idol_revision_id uuid REFERENCES idol_revisions(id) ON DELETE RESTRICT,
  gift_id uuid REFERENCES gifts(id) ON DELETE RESTRICT,
  gift_revision_id uuid REFERENCES gift_revisions(id) ON DELETE RESTRICT,
  homepage_revision_id uuid REFERENCES homepage_revisions(id) ON DELETE RESTRICT,
  policy_key text REFERENCES policies(policy_key) ON DELETE RESTRICT,
  policy_revision_id uuid REFERENCES policy_revisions(id) ON DELETE RESTRICT,
  media_asset_id uuid REFERENCES media_assets(id) ON DELETE RESTRICT,
  media_metadata_revision_id uuid REFERENCES media_metadata_revisions(id) ON DELETE RESTRICT,
  site_locale_config_revision_id uuid REFERENCES site_locale_config_revisions(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('PUBLISH', 'ROLLBACK')),
  replaces_publication_id uuid REFERENCES content_publications(id) ON DELETE RESTRICT,
  translation_manifest_hash sha256_hex NOT NULL,
  approval_manifest_hash sha256_hex NOT NULL,
  media_manifest_hash sha256_hex,
  published_by uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  idempotency_key idempotency_key_value NOT NULL,
  CONSTRAINT content_publications_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT content_publications_replaces_unique UNIQUE (replaces_publication_id),
  CONSTRAINT content_publications_idol_owner_fk
    FOREIGN KEY (idol_revision_id, idol_id) REFERENCES idol_revisions(id, idol_id) ON DELETE RESTRICT,
  CONSTRAINT content_publications_gift_owner_fk
    FOREIGN KEY (gift_revision_id, gift_id) REFERENCES gift_revisions(id, gift_id) ON DELETE RESTRICT,
  CONSTRAINT content_publications_policy_owner_fk
    FOREIGN KEY (policy_revision_id, policy_key) REFERENCES policy_revisions(id, policy_key) ON DELETE RESTRICT,
  CONSTRAINT content_publications_media_owner_fk
    FOREIGN KEY (media_metadata_revision_id, media_asset_id)
    REFERENCES media_metadata_revisions(id, media_asset_id) ON DELETE RESTRICT,
  CONSTRAINT content_publications_typed_target_check CHECK (
    (content_type = 'IDOL' AND idol_id IS NOT NULL AND idol_revision_id IS NOT NULL
      AND gift_id IS NULL AND gift_revision_id IS NULL AND homepage_revision_id IS NULL
      AND policy_key IS NULL AND policy_revision_id IS NULL AND media_asset_id IS NULL
      AND media_metadata_revision_id IS NULL AND site_locale_config_revision_id IS NULL)
    OR (content_type = 'GIFT' AND idol_id IS NULL AND idol_revision_id IS NULL
      AND gift_id IS NOT NULL AND gift_revision_id IS NOT NULL AND homepage_revision_id IS NULL
      AND policy_key IS NULL AND policy_revision_id IS NULL AND media_asset_id IS NULL
      AND media_metadata_revision_id IS NULL AND site_locale_config_revision_id IS NULL)
    OR (content_type = 'HOMEPAGE' AND idol_id IS NULL AND idol_revision_id IS NULL
      AND gift_id IS NULL AND gift_revision_id IS NULL AND homepage_revision_id IS NOT NULL
      AND policy_key IS NULL AND policy_revision_id IS NULL AND media_asset_id IS NULL
      AND media_metadata_revision_id IS NULL AND site_locale_config_revision_id IS NULL)
    OR (content_type = 'POLICY' AND idol_id IS NULL AND idol_revision_id IS NULL
      AND gift_id IS NULL AND gift_revision_id IS NULL AND homepage_revision_id IS NULL
      AND policy_key IS NOT NULL AND policy_revision_id IS NOT NULL AND media_asset_id IS NULL
      AND media_metadata_revision_id IS NULL AND site_locale_config_revision_id IS NULL)
    OR (content_type = 'MEDIA_METADATA' AND idol_id IS NULL AND idol_revision_id IS NULL
      AND gift_id IS NULL AND gift_revision_id IS NULL AND homepage_revision_id IS NULL
      AND policy_key IS NULL AND policy_revision_id IS NULL AND media_asset_id IS NOT NULL
      AND media_metadata_revision_id IS NOT NULL AND site_locale_config_revision_id IS NULL)
    OR (content_type = 'SITE_LOCALE_CONFIG' AND idol_id IS NULL AND idol_revision_id IS NULL
      AND gift_id IS NULL AND gift_revision_id IS NULL AND homepage_revision_id IS NULL
      AND policy_key IS NULL AND policy_revision_id IS NULL AND media_asset_id IS NULL
      AND media_metadata_revision_id IS NULL AND site_locale_config_revision_id IS NOT NULL)
  ),
  CONSTRAINT content_publications_rollback_chain_check CHECK (
    action = 'PUBLISH' OR replaces_publication_id IS NOT NULL
  ),
  CONSTRAINT content_publications_media_manifest_check CHECK (
    (content_type IN ('IDOL', 'GIFT', 'HOMEPAGE', 'MEDIA_METADATA') AND media_manifest_hash IS NOT NULL)
    OR (content_type IN ('POLICY', 'SITE_LOCALE_CONFIG') AND media_manifest_hash IS NULL)
  )
);

CREATE TABLE slug_redirects (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  entity_type text NOT NULL CHECK (entity_type IN ('IDOL', 'GIFT')),
  idol_id uuid REFERENCES idols(id) ON DELETE RESTRICT,
  gift_id uuid REFERENCES gifts(id) ON DELETE RESTRICT,
  old_handle text NOT NULL CHECK (old_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  new_handle text NOT NULL CHECK (new_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT slug_redirects_source_unique UNIQUE (entity_type, old_handle),
  CONSTRAINT slug_redirects_change_check CHECK (old_handle <> new_handle),
  CONSTRAINT slug_redirects_typed_owner_check CHECK (
    (entity_type = 'IDOL' AND idol_id IS NOT NULL AND gift_id IS NULL)
    OR (entity_type = 'GIFT' AND idol_id IS NULL AND gift_id IS NOT NULL)
  )
);

CREATE TABLE markets (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  market market_code NOT NULL,
  default_currency currency_code NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
  version positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT markets_market_unique UNIQUE (market),
  CONSTRAINT markets_id_market_unique UNIQUE (id, market)
);

CREATE TABLE price_books (
  id uuid NOT NULL,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  market market_code NOT NULL,
  currency currency_code NOT NULL,
  revision positive_version NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  valid_from finite_timestamptz NOT NULL,
  valid_until timestamptz,
  created_by uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  validated_at timestamptz,
  published_at timestamptz,
  superseded_at timestamptz,
  archived_at timestamptz,
  PRIMARY KEY (id, revision),
  CONSTRAINT price_books_market_fk
    FOREIGN KEY (market_id, market) REFERENCES markets(id, market) ON DELETE RESTRICT,
  CONSTRAINT price_books_market_currency_revision_unique UNIQUE (market_id, currency, revision),
  CONSTRAINT price_books_id_revision_market_currency_unique UNIQUE (id, revision, market, currency),
  CONSTRAINT price_books_validity_check CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX price_books_one_published_per_market_currency_idx
  ON price_books (market_id, currency) WHERE lifecycle = 'PUBLISHED';

CREATE TABLE prices (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  price_book_id uuid NOT NULL,
  price_book_revision positive_version NOT NULL,
  market market_code NOT NULL,
  currency currency_code NOT NULL,
  gift_variant_id uuid NOT NULL REFERENCES gift_variants(id) ON DELETE RESTRICT,
  revision positive_version NOT NULL,
  amount_minor minor_amount NOT NULL,
  valid_from finite_timestamptz NOT NULL,
  valid_to finite_timestamptz,
  valid_during tstzrange GENERATED ALWAYS AS (tstzrange(valid_from, valid_to, '[)')) STORED,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT prices_book_revision_fk
    FOREIGN KEY (price_book_id, price_book_revision, market, currency)
    REFERENCES price_books(id, revision, market, currency) ON DELETE RESTRICT,
  CONSTRAINT prices_id_revision_variant_unique UNIQUE (id, revision, gift_variant_id),
  CONSTRAINT prices_revision_unique UNIQUE (price_book_id, price_book_revision, gift_variant_id, revision),
  CONSTRAINT prices_valid_range_check CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT prices_published_interval_exclusion EXCLUDE USING gist (
    market WITH =,
    currency WITH =,
    gift_variant_id WITH =,
    valid_during WITH &&
  ) WHERE (status = 'PUBLISHED')
);

CREATE TABLE inventory_locations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  location_key text NOT NULL CHECK (location_key ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT inventory_locations_key_unique UNIQUE (location_key)
);

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  gift_variant_id uuid NOT NULL REFERENCES gift_variants(id) ON DELETE RESTRICT,
  sku text NOT NULL CHECK (sku ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(sku) <= 64),
  policy text NOT NULL CHECK (policy IN ('TRACKED', 'PROCURE_ON_DEMAND', 'PREORDER')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT inventory_items_variant_unique UNIQUE (gift_variant_id),
  CONSTRAINT inventory_items_sku_unique UNIQUE (sku),
  CONSTRAINT inventory_items_id_variant_unique UNIQUE (id, gift_variant_id)
);

CREATE TABLE inventory_balances (
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  inventory_item_id uuid NOT NULL,
  location_id uuid NOT NULL,
  on_hand bigint NOT NULL DEFAULT 0 CHECK (on_hand >= 0 AND on_hand <= 9007199254740991),
  reserved bigint NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= on_hand),
  version positive_version NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (inventory_item_id, location_id),
  CONSTRAINT inventory_balances_item_fk
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
  CONSTRAINT inventory_balances_location_fk
    FOREIGN KEY (location_id) REFERENCES inventory_locations(id) ON DELETE RESTRICT
);

CREATE FUNCTION assert_inventory_item_variant_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_variant_id uuid;
  variant_sku text;
  variant_policy text;
  item_sku text;
  item_policy text;
BEGIN
  target_variant_id := COALESCE(
    (to_jsonb(NEW) ->> 'gift_variant_id')::uuid,
    (to_jsonb(OLD) ->> 'gift_variant_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid,
    (to_jsonb(OLD) ->> 'id')::uuid
  );
  SELECT sku, inventory_policy INTO variant_sku, variant_policy
    FROM gift_variants WHERE id = target_variant_id;
  SELECT sku, policy INTO item_sku, item_policy
    FROM inventory_items WHERE gift_variant_id = target_variant_id;
  IF item_sku IS NOT NULL AND (item_sku <> variant_sku OR item_policy <> variant_policy) THEN
    RAISE EXCEPTION 'inventory item sku/policy must match its gift variant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION guard_site_locale_config_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  locale_count integer;
  enabled_count integer;
BEGIN
  IF NEW.lifecycle = 'PUBLISHED'
     AND (TG_OP = 'INSERT' OR OLD.lifecycle IS DISTINCT FROM NEW.lifecycle) THEN
    SELECT count(*), count(*) FILTER (WHERE enabled)
      INTO locale_count, enabled_count
      FROM site_locale_config_entries
      WHERE site_locale_config_revision_id = NEW.id;
    IF locale_count <> 7 OR enabled_count <> 7 THEN
      RAISE EXCEPTION 'published locale config must enable all seven supported locales'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_revision_payload_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent_id uuid;
  parent_lifecycle text;
BEGIN
  parent_id := COALESCE(
    (to_jsonb(NEW) ->> TG_ARGV[1])::uuid,
    (to_jsonb(OLD) ->> TG_ARGV[1])::uuid
  );
  EXECUTE format('SELECT lifecycle FROM %s WHERE id = $1', TG_ARGV[0]::regclass)
    INTO parent_lifecycle USING parent_id;
  IF parent_lifecycle IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'published revision payload is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION guard_translation_payload_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  translation_id uuid;
  parent_lifecycle text;
BEGIN
  translation_id := COALESCE(
    (to_jsonb(NEW) ->> TG_ARGV[1])::uuid,
    (to_jsonb(OLD) ->> TG_ARGV[1])::uuid
  );
  EXECUTE format(
    'SELECT p.lifecycle FROM %s t JOIN %s p ON p.id = t.%I WHERE t.id = $1',
    TG_ARGV[0]::regclass,
    TG_ARGV[2]::regclass,
    TG_ARGV[3]
  ) INTO parent_lifecycle USING translation_id;
  IF parent_lifecycle IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'published translation payload is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION validate_gift_variant_label_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  revision_gift_id uuid;
  variant_gift_id uuid;
BEGIN
  SELECT revision.gift_id INTO revision_gift_id
    FROM gift_revision_translations translation
    JOIN gift_revisions revision ON revision.id = translation.gift_revision_id
    WHERE translation.id = NEW.gift_translation_id;
  SELECT gift_id INTO variant_gift_id FROM gift_variants WHERE id = NEW.gift_variant_id;
  IF revision_gift_id IS NULL OR variant_gift_id IS NULL OR revision_gift_id <> variant_gift_id THEN
    RAISE EXCEPTION 'gift variant label crosses gift ownership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_homepage_slot_translation_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  translation_revision_id uuid;
  matching_slot_count integer;
BEGIN
  SELECT homepage_revision_id INTO translation_revision_id
    FROM homepage_revision_translations WHERE id = NEW.homepage_translation_id;
  SELECT count(*) INTO matching_slot_count FROM homepage_slots
    WHERE homepage_revision_id = translation_revision_id AND slot_key = NEW.slot_key;
  IF matching_slot_count <> 1 THEN
    RAISE EXCEPTION 'homepage slot label crosses revision ownership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_price_parent_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  book_from timestamptz;
  book_until timestamptz;
  book_lifecycle text;
BEGIN
  SELECT valid_from, valid_until, lifecycle
    INTO book_from, book_until, book_lifecycle
    FROM price_books
    WHERE id = NEW.price_book_id AND revision = NEW.price_book_revision;
  IF book_from IS NULL OR NEW.valid_from < book_from
     OR (book_until IS NOT NULL AND (NEW.valid_to IS NULL OR NEW.valid_to > book_until)) THEN
    RAISE EXCEPTION 'price validity must be contained by its price-book revision'
      USING ERRCODE = '23514';
  END IF;
  IF (NEW.status = 'PUBLISHED') <> (book_lifecycle = 'PUBLISHED') THEN
    RAISE EXCEPTION 'price publication status must match its price-book revision'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_content_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_lifecycle text;
  previous_type text;
  previous_owner text;
  current_owner text;
  media_revision record;
  required_media_count integer;
  required_row_count integer;
  present_row_count integer;
BEGIN
  IF NEW.id = NEW.replaces_publication_id THEN
    RAISE EXCEPTION 'publication cannot replace itself' USING ERRCODE = '23514';
  END IF;

  IF NEW.content_type = 'IDOL' THEN
    SELECT lifecycle INTO target_lifecycle FROM idol_revisions WHERE id = NEW.idol_revision_id;
    current_owner := NEW.idol_id::text;
    PERFORM assert_translation_package(
      'idol_revision_translations', 'idol_revision_id', NEW.idol_revision_id,
      'idol_translation_reviews', 'idol_translation_id'
    );
    SELECT count(*) INTO required_media_count
      FROM (
        SELECT role FROM idol_revision_media
        WHERE idol_revision_id = NEW.idol_revision_id
          AND role IN ('PORTRAIT', 'HERO_DESKTOP', 'HERO_MOBILE')
        GROUP BY role
      ) required_roles;
    IF required_media_count <> 3 THEN
      RAISE EXCEPTION 'idol publication requires portrait, desktop hero, and mobile hero media'
        USING ERRCODE = '23514';
    END IF;
    FOR media_revision IN
      SELECT DISTINCT m.id, m.lifecycle, asset.processing_status, asset.rights_status,
        EXISTS (
          SELECT 1 FROM media_variants variant
          WHERE variant.media_asset_id = asset.id AND variant.status = 'READY'
        ) AS has_ready_variant
      FROM idol_revision_media irm
      JOIN media_metadata_revisions m ON m.id = irm.media_metadata_revision_id
      JOIN media_assets asset ON asset.id = irm.media_asset_id
      WHERE idol_revision_id = NEW.idol_revision_id
    LOOP
      IF media_revision.lifecycle NOT IN ('PUBLISHED', 'SUPERSEDED')
         OR media_revision.processing_status <> 'READY'
         OR media_revision.rights_status <> 'APPROVED'
         OR NOT media_revision.has_ready_variant THEN
        RAISE EXCEPTION 'publication media metadata must be immutable published evidence'
          USING ERRCODE = '23514';
      END IF;
      PERFORM assert_translation_package(
        'media_metadata_revision_translations', 'media_metadata_revision_id', media_revision.id,
        'media_metadata_translation_reviews', 'media_metadata_translation_id'
      );
    END LOOP;
  ELSIF NEW.content_type = 'GIFT' THEN
    SELECT lifecycle INTO target_lifecycle FROM gift_revisions WHERE id = NEW.gift_revision_id;
    current_owner := NEW.gift_id::text;
    PERFORM assert_translation_package(
      'gift_revision_translations', 'gift_revision_id', NEW.gift_revision_id,
      'gift_translation_reviews', 'gift_translation_id'
    );
    SELECT count(*), count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM gift_variant_idol_eligibility eligibility
      JOIN idols idol ON idol.id = eligibility.idol_id
      WHERE eligibility.gift_variant_id = variant.id
        AND idol.status = 'active' AND idol.accepting_gifts
        AND idol.published_revision_id IS NOT NULL
    ))
      INTO required_row_count, present_row_count
      FROM gift_variants variant
      WHERE variant.gift_id = NEW.gift_id AND variant.status <> 'archived';
    IF required_row_count = 0 OR present_row_count <> required_row_count THEN
      RAISE EXCEPTION 'gift publication requires a published eligible idol for every non-archived variant'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM gift_variants
      WHERE gift_id = NEW.gift_id AND status IN ('active', 'paused')
    ) OR (
      (SELECT status FROM gifts WHERE id = NEW.gift_id) = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM gift_variants
        WHERE gift_id = NEW.gift_id AND status = 'active'
      )
    ) THEN
      RAISE EXCEPTION 'gift publication requires a usable variant'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(*) * 7 INTO required_row_count
      FROM gift_variants WHERE gift_id = NEW.gift_id;
    SELECT count(*) INTO present_row_count
      FROM gift_variant_labels label
      JOIN gift_revision_translations translation ON translation.id = label.gift_translation_id
      JOIN gift_variants variant ON variant.id = label.gift_variant_id
      WHERE translation.gift_revision_id = NEW.gift_revision_id
        AND variant.gift_id = NEW.gift_id;
    IF present_row_count <> required_row_count THEN
      RAISE EXCEPTION 'gift publication requires every variant label in all seven locales'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM gift_revisions revision
      JOIN gift_revision_translations translation
        ON translation.gift_revision_id = revision.id
      WHERE revision.id = NEW.gift_revision_id
        AND revision.requires_safety_notice
        AND translation.safety_notice IS NULL
    ) THEN
      RAISE EXCEPTION 'gift publication requires localized safety notices'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO required_media_count FROM gift_revision_media
      WHERE gift_revision_id = NEW.gift_revision_id AND role = 'PRIMARY';
    IF required_media_count < 1 THEN
      RAISE EXCEPTION 'gift publication requires primary media' USING ERRCODE = '23514';
    END IF;
    FOR media_revision IN
      SELECT DISTINCT m.id, m.lifecycle, asset.processing_status, asset.rights_status,
        EXISTS (
          SELECT 1 FROM media_variants variant
          WHERE variant.media_asset_id = asset.id AND variant.status = 'READY'
        ) AS has_ready_variant
      FROM gift_revision_media grm
      JOIN media_metadata_revisions m ON m.id = grm.media_metadata_revision_id
      JOIN media_assets asset ON asset.id = grm.media_asset_id
      WHERE gift_revision_id = NEW.gift_revision_id
    LOOP
      IF media_revision.lifecycle NOT IN ('PUBLISHED', 'SUPERSEDED')
         OR media_revision.processing_status <> 'READY'
         OR media_revision.rights_status <> 'APPROVED'
         OR NOT media_revision.has_ready_variant THEN
        RAISE EXCEPTION 'publication media metadata must be immutable published evidence'
          USING ERRCODE = '23514';
      END IF;
      PERFORM assert_translation_package(
        'media_metadata_revision_translations', 'media_metadata_revision_id', media_revision.id,
        'media_metadata_translation_reviews', 'media_metadata_translation_id'
      );
    END LOOP;
  ELSIF NEW.content_type = 'HOMEPAGE' THEN
    SELECT lifecycle INTO target_lifecycle FROM homepage_revisions WHERE id = NEW.homepage_revision_id;
    current_owner := 'homepage';
    PERFORM assert_translation_package(
      'homepage_revision_translations', 'homepage_revision_id', NEW.homepage_revision_id,
      'homepage_translation_reviews', 'homepage_translation_id'
    );
    SELECT count(*) INTO required_media_count FROM homepage_slots
      WHERE homepage_revision_id = NEW.homepage_revision_id AND kind = 'HERO_IDOL';
    IF required_media_count <> 1 THEN
      RAISE EXCEPTION 'homepage publication requires exactly one hero idol slot'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(*) * 7 INTO required_row_count
      FROM homepage_slots WHERE homepage_revision_id = NEW.homepage_revision_id;
    SELECT count(*) INTO present_row_count
      FROM homepage_slot_translations label
      JOIN homepage_revision_translations translation
        ON translation.id = label.homepage_translation_id
      WHERE translation.homepage_revision_id = NEW.homepage_revision_id;
    IF present_row_count <> required_row_count THEN
      RAISE EXCEPTION 'homepage publication requires every slot label in all seven locales'
        USING ERRCODE = '23514';
    END IF;
    FOR media_revision IN
      SELECT DISTINCT m.id, m.lifecycle, asset.processing_status, asset.rights_status,
        EXISTS (
          SELECT 1 FROM media_variants variant
          WHERE variant.media_asset_id = asset.id AND variant.status = 'READY'
        ) AS has_ready_variant
      FROM (
        SELECT desktop_media_metadata_revision_id AS id, desktop_media_asset_id AS asset_id
          FROM homepage_slots WHERE homepage_revision_id = NEW.homepage_revision_id
        UNION
        SELECT mobile_media_metadata_revision_id AS id, mobile_media_asset_id AS asset_id
          FROM homepage_slots WHERE homepage_revision_id = NEW.homepage_revision_id
      ) slot_media
      JOIN media_metadata_revisions m ON m.id = slot_media.id
      JOIN media_assets asset ON asset.id = slot_media.asset_id
      WHERE slot_media.id IS NOT NULL
    LOOP
      IF media_revision.lifecycle NOT IN ('PUBLISHED', 'SUPERSEDED')
         OR media_revision.processing_status <> 'READY'
         OR media_revision.rights_status <> 'APPROVED'
         OR NOT media_revision.has_ready_variant THEN
        RAISE EXCEPTION 'publication media metadata must be immutable published evidence'
          USING ERRCODE = '23514';
      END IF;
      PERFORM assert_translation_package(
        'media_metadata_revision_translations', 'media_metadata_revision_id', media_revision.id,
        'media_metadata_translation_reviews', 'media_metadata_translation_id'
      );
    END LOOP;
  ELSIF NEW.content_type = 'POLICY' THEN
    SELECT lifecycle INTO target_lifecycle FROM policy_revisions WHERE id = NEW.policy_revision_id;
    current_owner := NEW.policy_key;
    PERFORM assert_translation_package(
      'policy_revision_translations', 'policy_revision_id', NEW.policy_revision_id,
      'policy_translation_reviews', 'policy_translation_id'
    );
  ELSIF NEW.content_type = 'MEDIA_METADATA' THEN
    SELECT metadata.lifecycle INTO target_lifecycle
      FROM media_metadata_revisions metadata
      JOIN media_assets asset ON asset.id = metadata.media_asset_id
      WHERE metadata.id = NEW.media_metadata_revision_id
        AND asset.processing_status = 'READY'
        AND asset.rights_status = 'APPROVED'
        AND EXISTS (
          SELECT 1 FROM media_variants variant
          WHERE variant.media_asset_id = asset.id AND variant.status = 'READY'
        );
    current_owner := NEW.media_asset_id::text;
    PERFORM assert_translation_package(
      'media_metadata_revision_translations', 'media_metadata_revision_id', NEW.media_metadata_revision_id,
      'media_metadata_translation_reviews', 'media_metadata_translation_id'
    );
  ELSE
    SELECT lifecycle INTO target_lifecycle FROM site_locale_config_revisions
      WHERE id = NEW.site_locale_config_revision_id;
    current_owner := 'site-locale-config';
  END IF;

  IF target_lifecycle NOT IN ('PUBLISHED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'publication target must be immutable published evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.replaces_publication_id IS NOT NULL THEN
    SELECT content_type,
      CASE content_type
        WHEN 'IDOL' THEN idol_id::text
        WHEN 'GIFT' THEN gift_id::text
        WHEN 'HOMEPAGE' THEN 'homepage'
        WHEN 'POLICY' THEN policy_key
        WHEN 'MEDIA_METADATA' THEN media_asset_id::text
        ELSE 'site-locale-config'
      END
      INTO previous_type, previous_owner
      FROM content_publications WHERE id = NEW.replaces_publication_id;
    IF previous_type IS NULL OR previous_type <> NEW.content_type OR previous_owner <> current_owner THEN
      RAISE EXCEPTION 'publication replacement must stay on the same typed object'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_published_price_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'published price evidence cannot be deleted' USING ERRCODE = '55000';
  ELSIF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'price revision fields are immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'DRAFT' AND NEW.status IN ('PUBLISHED', 'ARCHIVED'))
    OR (OLD.status = 'PUBLISHED' AND NEW.status = 'SUPERSEDED')
    OR (OLD.status = 'SUPERSEDED' AND NEW.status = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'invalid price lifecycle transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION assert_price_book_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  price_count integer;
  published_count integer;
BEGIN
  IF NEW.lifecycle = 'PUBLISHED' THEN
    SELECT count(*), count(*) FILTER (WHERE status = 'PUBLISHED')
      INTO price_count, published_count
      FROM prices WHERE price_book_id = NEW.id AND price_book_revision = NEW.revision;
    IF price_count = 0 OR price_count <> published_count THEN
      RAISE EXCEPTION 'published price-book revision requires a non-empty published price set'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER media_assets_identity_immutable_trigger
  BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns(
    'id', 'schema_version', 'checksum_sha256', 'mime_type', 'width', 'height',
    'byte_size', 'object_key', 'rights_reference', 'created_at'
  );

CREATE TRIGGER media_variants_identity_immutable_trigger
  BEFORE UPDATE ON media_variants
  FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns(
    'id', 'schema_version', 'media_asset_id', 'format', 'width', 'height',
    'byte_size', 'checksum_sha256', 'object_key', 'created_at'
  );

CREATE TRIGGER media_metadata_revision_lifecycle_shape_trigger
  BEFORE INSERT OR UPDATE ON media_metadata_revisions
  FOR EACH ROW EXECUTE FUNCTION validate_revision_lifecycle_times();
CREATE TRIGGER media_metadata_revision_immutable_trigger
  BEFORE UPDATE OR DELETE ON media_metadata_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_revision_mutation();
CREATE TRIGGER media_metadata_revision_publication_trigger
  BEFORE INSERT OR UPDATE OF lifecycle ON media_metadata_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_revision_publication(
    'media_metadata_revision_translations', 'media_metadata_revision_id',
    'media_metadata_translation_reviews', 'media_metadata_translation_id'
  );

CREATE TRIGGER media_metadata_translation_validate_trigger
  BEFORE INSERT ON media_metadata_revision_translations
  FOR EACH ROW EXECUTE FUNCTION validate_translation_row();
CREATE TRIGGER media_metadata_translation_parent_guard_trigger
  BEFORE INSERT ON media_metadata_revision_translations
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation(
    'media_metadata_revisions', 'media_metadata_revision_id'
  );
CREATE TRIGGER media_metadata_translation_append_only_trigger
  BEFORE UPDATE OR DELETE ON media_metadata_revision_translations
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER media_metadata_translation_initial_review_trigger
  AFTER INSERT ON media_metadata_revision_translations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_translation_initial_review(
    'media_metadata_translation_reviews', 'media_metadata_translation_id'
  );
CREATE TRIGGER media_metadata_translation_review_validate_trigger
  BEFORE INSERT ON media_metadata_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION validate_translation_review_event(
    'media_metadata_revision_translations', 'media_metadata_translation_id',
    'media_metadata_revisions', 'media_metadata_revision_id'
  );
CREATE TRIGGER media_metadata_translation_review_append_only_trigger
  BEFORE UPDATE OR DELETE ON media_metadata_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER idol_revision_lifecycle_shape_trigger
  BEFORE INSERT OR UPDATE ON idol_revisions
  FOR EACH ROW EXECUTE FUNCTION validate_revision_lifecycle_times();
CREATE TRIGGER idol_revision_immutable_trigger
  BEFORE UPDATE OR DELETE ON idol_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_revision_mutation();
CREATE TRIGGER idol_revision_publication_trigger
  BEFORE INSERT OR UPDATE OF lifecycle ON idol_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_revision_publication(
    'idol_revision_translations', 'idol_revision_id',
    'idol_translation_reviews', 'idol_translation_id'
  );
CREATE TRIGGER idol_translation_validate_trigger
  BEFORE INSERT ON idol_revision_translations
  FOR EACH ROW EXECUTE FUNCTION validate_translation_row();
CREATE TRIGGER idol_translation_parent_guard_trigger
  BEFORE INSERT ON idol_revision_translations
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation('idol_revisions', 'idol_revision_id');
CREATE TRIGGER idol_translation_append_only_trigger
  BEFORE UPDATE OR DELETE ON idol_revision_translations
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER idol_translation_initial_review_trigger
  AFTER INSERT ON idol_revision_translations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_translation_initial_review(
    'idol_translation_reviews', 'idol_translation_id'
  );
CREATE TRIGGER idol_translation_review_validate_trigger
  BEFORE INSERT ON idol_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION validate_translation_review_event(
    'idol_revision_translations', 'idol_translation_id',
    'idol_revisions', 'idol_revision_id'
  );
CREATE TRIGGER idol_translation_review_append_only_trigger
  BEFORE UPDATE OR DELETE ON idol_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER gift_revision_lifecycle_shape_trigger
  BEFORE INSERT OR UPDATE ON gift_revisions
  FOR EACH ROW EXECUTE FUNCTION validate_revision_lifecycle_times();
CREATE TRIGGER gift_revision_immutable_trigger
  BEFORE UPDATE OR DELETE ON gift_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_revision_mutation();
CREATE TRIGGER gift_revision_publication_trigger
  BEFORE INSERT OR UPDATE OF lifecycle ON gift_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_revision_publication(
    'gift_revision_translations', 'gift_revision_id',
    'gift_translation_reviews', 'gift_translation_id'
  );
CREATE TRIGGER gift_translation_validate_trigger
  BEFORE INSERT ON gift_revision_translations
  FOR EACH ROW EXECUTE FUNCTION validate_translation_row();
CREATE TRIGGER gift_translation_parent_guard_trigger
  BEFORE INSERT ON gift_revision_translations
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation('gift_revisions', 'gift_revision_id');
CREATE TRIGGER gift_translation_append_only_trigger
  BEFORE UPDATE OR DELETE ON gift_revision_translations
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER gift_translation_initial_review_trigger
  AFTER INSERT ON gift_revision_translations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_translation_initial_review(
    'gift_translation_reviews', 'gift_translation_id'
  );
CREATE TRIGGER gift_translation_review_validate_trigger
  BEFORE INSERT ON gift_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION validate_translation_review_event(
    'gift_revision_translations', 'gift_translation_id',
    'gift_revisions', 'gift_revision_id'
  );
CREATE TRIGGER gift_translation_review_append_only_trigger
  BEFORE UPDATE OR DELETE ON gift_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER homepage_revision_lifecycle_shape_trigger
  BEFORE INSERT OR UPDATE ON homepage_revisions
  FOR EACH ROW EXECUTE FUNCTION validate_revision_lifecycle_times();
CREATE TRIGGER homepage_revision_immutable_trigger
  BEFORE UPDATE OR DELETE ON homepage_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_revision_mutation();
CREATE TRIGGER homepage_revision_publication_trigger
  BEFORE INSERT OR UPDATE OF lifecycle ON homepage_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_revision_publication(
    'homepage_revision_translations', 'homepage_revision_id',
    'homepage_translation_reviews', 'homepage_translation_id'
  );
CREATE TRIGGER homepage_translation_validate_trigger
  BEFORE INSERT ON homepage_revision_translations
  FOR EACH ROW EXECUTE FUNCTION validate_translation_row();
CREATE TRIGGER homepage_translation_parent_guard_trigger
  BEFORE INSERT ON homepage_revision_translations
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation('homepage_revisions', 'homepage_revision_id');
CREATE TRIGGER homepage_translation_append_only_trigger
  BEFORE UPDATE OR DELETE ON homepage_revision_translations
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER homepage_translation_initial_review_trigger
  AFTER INSERT ON homepage_revision_translations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_translation_initial_review(
    'homepage_translation_reviews', 'homepage_translation_id'
  );
CREATE TRIGGER homepage_translation_review_validate_trigger
  BEFORE INSERT ON homepage_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION validate_translation_review_event(
    'homepage_revision_translations', 'homepage_translation_id',
    'homepage_revisions', 'homepage_revision_id'
  );
CREATE TRIGGER homepage_translation_review_append_only_trigger
  BEFORE UPDATE OR DELETE ON homepage_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER policy_revision_lifecycle_shape_trigger
  BEFORE INSERT OR UPDATE ON policy_revisions
  FOR EACH ROW EXECUTE FUNCTION validate_revision_lifecycle_times();
CREATE TRIGGER policy_revision_immutable_trigger
  BEFORE UPDATE OR DELETE ON policy_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_revision_mutation();
CREATE TRIGGER policy_revision_publication_trigger
  BEFORE INSERT OR UPDATE OF lifecycle ON policy_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_revision_publication(
    'policy_revision_translations', 'policy_revision_id',
    'policy_translation_reviews', 'policy_translation_id'
  );
CREATE TRIGGER policy_translation_validate_trigger
  BEFORE INSERT ON policy_revision_translations
  FOR EACH ROW EXECUTE FUNCTION validate_translation_row();
CREATE TRIGGER policy_translation_parent_guard_trigger
  BEFORE INSERT ON policy_revision_translations
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation('policy_revisions', 'policy_revision_id');
CREATE TRIGGER policy_translation_append_only_trigger
  BEFORE UPDATE OR DELETE ON policy_revision_translations
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE CONSTRAINT TRIGGER policy_translation_initial_review_trigger
  AFTER INSERT ON policy_revision_translations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_translation_initial_review(
    'policy_translation_reviews', 'policy_translation_id'
  );
CREATE TRIGGER policy_translation_review_validate_trigger
  BEFORE INSERT ON policy_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION validate_translation_review_event(
    'policy_revision_translations', 'policy_translation_id',
    'policy_revisions', 'policy_revision_id'
  );
CREATE TRIGGER policy_translation_review_append_only_trigger
  BEFORE UPDATE OR DELETE ON policy_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER site_locale_config_lifecycle_shape_trigger
  BEFORE INSERT OR UPDATE ON site_locale_config_revisions
  FOR EACH ROW EXECUTE FUNCTION validate_revision_lifecycle_times();
CREATE TRIGGER site_locale_config_revision_immutable_trigger
  BEFORE UPDATE OR DELETE ON site_locale_config_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_revision_mutation();
CREATE TRIGGER site_locale_config_publication_trigger
  BEFORE INSERT OR UPDATE OF lifecycle ON site_locale_config_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_site_locale_config_publication();

CREATE TRIGGER idol_revision_media_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON idol_revision_media
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation('idol_revisions', 'idol_revision_id');
CREATE TRIGGER gift_revision_contents_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON gift_revision_contents
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation('gift_revisions', 'gift_revision_id');
CREATE TRIGGER gift_revision_media_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON gift_revision_media
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation('gift_revisions', 'gift_revision_id');
CREATE TRIGGER gift_variant_labels_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON gift_variant_labels
  FOR EACH ROW EXECUTE FUNCTION guard_translation_payload_mutation(
    'gift_revision_translations', 'gift_translation_id', 'gift_revisions', 'gift_revision_id'
  );
CREATE TRIGGER gift_variant_labels_ownership_trigger
  BEFORE INSERT OR UPDATE ON gift_variant_labels
  FOR EACH ROW EXECUTE FUNCTION validate_gift_variant_label_ownership();
CREATE TRIGGER homepage_slots_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON homepage_slots
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation('homepage_revisions', 'homepage_revision_id');
CREATE TRIGGER homepage_slot_translations_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON homepage_slot_translations
  FOR EACH ROW EXECUTE FUNCTION guard_translation_payload_mutation(
    'homepage_revision_translations', 'homepage_translation_id', 'homepage_revisions', 'homepage_revision_id'
  );
CREATE TRIGGER homepage_slot_translations_ownership_trigger
  BEFORE INSERT OR UPDATE ON homepage_slot_translations
  FOR EACH ROW EXECUTE FUNCTION validate_homepage_slot_translation_ownership();
CREATE TRIGGER site_locale_config_entries_parent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON site_locale_config_entries
  FOR EACH ROW EXECUTE FUNCTION guard_revision_payload_mutation(
    'site_locale_config_revisions', 'site_locale_config_revision_id'
  );

CREATE TRIGGER content_publications_validate_trigger
  BEFORE INSERT ON content_publications
  FOR EACH ROW EXECUTE FUNCTION validate_content_publication();
CREATE TRIGGER content_publications_append_only_trigger
  BEFORE UPDATE OR DELETE ON content_publications
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER content_publications_no_truncate_trigger
  BEFORE TRUNCATE ON content_publications
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER slug_redirects_append_only_trigger
  BEFORE UPDATE OR DELETE ON slug_redirects
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER slug_redirects_no_truncate_trigger
  BEFORE TRUNCATE ON slug_redirects
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER media_metadata_translations_no_truncate_trigger
  BEFORE TRUNCATE ON media_metadata_revision_translations
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER media_metadata_reviews_no_truncate_trigger
  BEFORE TRUNCATE ON media_metadata_translation_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER idol_translations_no_truncate_trigger
  BEFORE TRUNCATE ON idol_revision_translations
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER idol_reviews_no_truncate_trigger
  BEFORE TRUNCATE ON idol_translation_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER gift_translations_no_truncate_trigger
  BEFORE TRUNCATE ON gift_revision_translations
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER gift_reviews_no_truncate_trigger
  BEFORE TRUNCATE ON gift_translation_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER homepage_translations_no_truncate_trigger
  BEFORE TRUNCATE ON homepage_revision_translations
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER homepage_reviews_no_truncate_trigger
  BEFORE TRUNCATE ON homepage_translation_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER policy_translations_no_truncate_trigger
  BEFORE TRUNCATE ON policy_revision_translations
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER policy_reviews_no_truncate_trigger
  BEFORE TRUNCATE ON policy_translation_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER price_book_lifecycle_shape_trigger
  BEFORE INSERT OR UPDATE ON price_books
  FOR EACH ROW EXECUTE FUNCTION validate_revision_lifecycle_times();
CREATE TRIGGER price_book_revision_immutable_trigger
  BEFORE UPDATE OR DELETE ON price_books
  FOR EACH ROW EXECUTE FUNCTION guard_revision_mutation();
CREATE CONSTRAINT TRIGGER price_book_publication_consistency_trigger
  AFTER INSERT OR UPDATE ON price_books
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_price_book_publication();
CREATE TRIGGER prices_parent_window_trigger
  BEFORE INSERT OR UPDATE ON prices
  FOR EACH ROW EXECUTE FUNCTION validate_price_parent_window();
CREATE TRIGGER prices_published_immutable_trigger
  BEFORE UPDATE OR DELETE ON prices
  FOR EACH ROW EXECUTE FUNCTION guard_published_price_mutation();

CREATE CONSTRAINT TRIGGER inventory_items_variant_consistency_trigger
  AFTER INSERT OR UPDATE ON inventory_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_inventory_item_variant_consistency();
CREATE CONSTRAINT TRIGGER gift_variants_inventory_consistency_trigger
  AFTER UPDATE OF sku, inventory_policy ON gift_variants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_inventory_item_variant_consistency();
