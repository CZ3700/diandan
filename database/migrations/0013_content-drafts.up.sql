-- These typed extensions are private drafts until their publication proof is implemented.
CREATE TABLE public.idol_revision_alias_sets (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  idol_revision_id uuid NOT NULL UNIQUE REFERENCES public.idol_revisions(id) ON DELETE RESTRICT,
  content_hash public.sha256_hex NOT NULL,
  command_hash public.sha256_hex NOT NULL,
  alias_count smallint NOT NULL CHECK (alias_count BETWEEN 0 AND 64),
  editor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  edited_at timestamptz NOT NULL,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE
);
CREATE TABLE public.idol_revision_aliases (
  alias_set_id uuid NOT NULL REFERENCES public.idol_revision_alias_sets(id) ON DELETE RESTRICT,
  alias_id text NOT NULL CHECK (length(alias_id) BETWEEN 1 AND 64 AND alias_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 63),
  locale public.supported_locale,
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 80 AND text !~ '[<>]'),
  PRIMARY KEY (alias_set_id, alias_id),
  UNIQUE (alias_set_id, position),
  UNIQUE NULLS NOT DISTINCT (alias_set_id, locale, text)
);
CREATE TABLE public.idol_revision_alias_reviews (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  alias_set_id uuid NOT NULL REFERENCES public.idol_revision_alias_sets(id) ON DELETE RESTRICT,
  sequence public.positive_version NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')),
  submitted_at timestamptz,
  reviewer_id uuid REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  reviewed_content_hash public.sha256_hex,
  audit_log_id uuid NOT NULL REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (alias_set_id, sequence)
);
CREATE UNIQUE INDEX idol_alias_review_audit_once ON public.idol_revision_alias_reviews(audit_log_id) WHERE status <> 'DRAFT';

CREATE TABLE public.gift_detail_documents (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  gift_revision_id uuid NOT NULL UNIQUE REFERENCES public.gift_revisions(id) ON DELETE RESTRICT,
  command_hash public.sha256_hex NOT NULL,
  block_count smallint NOT NULL CHECK (block_count BETWEEN 1 AND 32),
  translation_count smallint NOT NULL CHECK (translation_count BETWEEN 1 AND 7),
  editor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  edited_at timestamptz NOT NULL,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  UNIQUE (id, gift_revision_id)
);
CREATE TABLE public.gift_detail_blocks (
  document_id uuid NOT NULL REFERENCES public.gift_detail_documents(id) ON DELETE RESTRICT,
  block_id text NOT NULL CHECK (length(block_id) BETWEEN 1 AND 64 AND block_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 31),
  kind text NOT NULL CHECK (kind IN ('HEADING', 'PARAGRAPH', 'LIST', 'SPECIFICATIONS', 'MEDIA')),
  heading_level smallint,
  list_style text,
  item_count smallint NOT NULL DEFAULT 0 CHECK (item_count BETWEEN 0 AND 24),
  media_asset_id uuid REFERENCES public.media_assets(id) ON DELETE RESTRICT,
  media_metadata_revision_id uuid REFERENCES public.media_metadata_revisions(id) ON DELETE RESTRICT,
  caption_enabled boolean,
  PRIMARY KEY (document_id, block_id),
  UNIQUE (document_id, position),
  UNIQUE (document_id, block_id, kind),
  FOREIGN KEY (media_metadata_revision_id, media_asset_id) REFERENCES public.media_metadata_revisions(id, media_asset_id) ON DELETE RESTRICT,
  CHECK (
    (kind = 'HEADING' AND heading_level IS NOT NULL AND heading_level IN (2,3) AND list_style IS NULL AND item_count = 0 AND media_asset_id IS NULL AND media_metadata_revision_id IS NULL AND caption_enabled IS NULL)
    OR (kind = 'PARAGRAPH' AND heading_level IS NULL AND list_style IS NULL AND item_count = 0 AND media_asset_id IS NULL AND media_metadata_revision_id IS NULL AND caption_enabled IS NULL)
    OR (kind = 'LIST' AND heading_level IS NULL AND list_style IS NOT NULL AND list_style IN ('ORDERED','UNORDERED') AND item_count BETWEEN 1 AND 24 AND media_asset_id IS NULL AND media_metadata_revision_id IS NULL AND caption_enabled IS NULL)
    OR (kind = 'SPECIFICATIONS' AND heading_level IS NULL AND list_style IS NULL AND item_count BETWEEN 1 AND 24 AND media_asset_id IS NULL AND media_metadata_revision_id IS NULL AND caption_enabled IS NULL)
    OR (kind = 'MEDIA' AND heading_level IS NULL AND list_style IS NULL AND item_count = 0 AND media_asset_id IS NOT NULL AND media_metadata_revision_id IS NOT NULL AND caption_enabled IS NOT NULL)
  )
);
CREATE TABLE public.gift_detail_block_items (
  document_id uuid NOT NULL,
  block_id text NOT NULL,
  item_id text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 64 AND item_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 23),
  PRIMARY KEY (document_id, block_id, item_id),
  UNIQUE (document_id, block_id, position),
  FOREIGN KEY (document_id, block_id) REFERENCES public.gift_detail_blocks(document_id, block_id) ON DELETE RESTRICT
);
CREATE TABLE public.gift_detail_translations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  document_id uuid NOT NULL,
  gift_revision_id uuid NOT NULL REFERENCES public.gift_revisions(id) ON DELETE RESTRICT,
  locale public.supported_locale NOT NULL,
  source_hash public.sha256_hex NOT NULL,
  translated_from_source_hash public.sha256_hex NOT NULL,
  origin text NOT NULL CHECK (origin IN ('HUMAN','MACHINE','IMPORT')),
  import_batch_id uuid,
  editor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  edited_at timestamptz NOT NULL,
  UNIQUE (document_id, locale),
  UNIQUE (id, document_id),
  FOREIGN KEY (document_id, gift_revision_id) REFERENCES public.gift_detail_documents(id, gift_revision_id) ON DELETE RESTRICT
);
CREATE TABLE public.gift_detail_translation_blocks (
  translation_id uuid NOT NULL,
  document_id uuid NOT NULL,
  block_id text NOT NULL,
  kind text NOT NULL,
  text text,
  media_metadata_revision_id uuid REFERENCES public.media_metadata_revisions(id) ON DELETE RESTRICT,
  caption text,
  PRIMARY KEY (translation_id, block_id),
  UNIQUE (translation_id, document_id, block_id),
  FOREIGN KEY (translation_id, document_id) REFERENCES public.gift_detail_translations(id, document_id) ON DELETE RESTRICT,
  FOREIGN KEY (document_id, block_id, kind) REFERENCES public.gift_detail_blocks(document_id, block_id, kind) ON DELETE RESTRICT,
  CHECK (
    (kind = 'HEADING' AND text IS NOT NULL AND length(btrim(text)) BETWEEN 1 AND 160 AND media_metadata_revision_id IS NULL AND caption IS NULL)
    OR (kind = 'PARAGRAPH' AND text IS NOT NULL AND length(btrim(text)) BETWEEN 1 AND 4000 AND media_metadata_revision_id IS NULL AND caption IS NULL)
    OR (kind IN ('LIST','SPECIFICATIONS') AND text IS NULL AND media_metadata_revision_id IS NULL AND caption IS NULL)
    OR (kind = 'MEDIA' AND text IS NULL AND media_metadata_revision_id IS NOT NULL AND (caption IS NULL OR length(btrim(caption)) BETWEEN 1 AND 300))
  ),
  CHECK (text IS NULL OR text !~ '[<>]'),
  CHECK (caption IS NULL OR caption !~ '[<>]')
);
CREATE TABLE public.gift_detail_translation_items (
  translation_id uuid NOT NULL,
  document_id uuid NOT NULL,
  block_id text NOT NULL,
  item_id text NOT NULL,
  text text,
  label text,
  value text,
  PRIMARY KEY (translation_id, block_id, item_id),
  FOREIGN KEY (translation_id, document_id, block_id) REFERENCES public.gift_detail_translation_blocks(translation_id, document_id, block_id) ON DELETE RESTRICT,
  FOREIGN KEY (document_id, block_id, item_id) REFERENCES public.gift_detail_block_items(document_id, block_id, item_id) ON DELETE RESTRICT,
  CHECK ((text IS NOT NULL AND length(btrim(text)) BETWEEN 1 AND 600 AND label IS NULL AND value IS NULL)
    OR (text IS NULL AND label IS NOT NULL AND value IS NOT NULL AND length(btrim(label)) BETWEEN 1 AND 160 AND length(btrim(value)) BETWEEN 1 AND 600)),
  CHECK (coalesce(text,'') !~ '[<>]' AND coalesce(label,'') !~ '[<>]' AND coalesce(value,'') !~ '[<>]')
);
CREATE TABLE public.gift_detail_translation_reviews (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  gift_detail_translation_id uuid NOT NULL REFERENCES public.gift_detail_translations(id) ON DELETE RESTRICT,
  sequence public.positive_version NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED')),
  submitted_at timestamptz,
  reviewer_id uuid REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  reviewed_source_hash public.sha256_hex,
  reviewed_content_hash public.sha256_hex,
  audit_log_id uuid NOT NULL REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (gift_detail_translation_id, sequence)
);
CREATE UNIQUE INDEX gift_detail_review_audit_once ON public.gift_detail_translation_reviews(audit_log_id) WHERE status <> 'DRAFT';

-- Every insertion takes the same parent lock as a lifecycle update. No extension
-- can be attached after a concurrent publication has checked its payload.
CREATE FUNCTION public.guard_content_draft_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE owner_id uuid; parent_state text; document uuid; alias_set uuid; editor uuid; capacity integer; occupied integer;
BEGIN
  IF TG_TABLE_NAME = 'idol_revision_alias_sets' THEN
    owner_id := NEW.idol_revision_id; editor := NEW.editor_id;
  ELSIF TG_TABLE_NAME IN ('idol_revision_aliases','idol_revision_alias_reviews') THEN
    alias_set := NEW.alias_set_id;
    SELECT idol_revision_id INTO owner_id FROM public.idol_revision_alias_sets WHERE id = alias_set FOR UPDATE;
  ELSIF TG_TABLE_NAME = 'gift_detail_documents' THEN
    owner_id := NEW.gift_revision_id; editor := NEW.editor_id;
  ELSE
    IF TG_TABLE_NAME = 'gift_detail_translation_reviews' THEN
      SELECT document_id INTO document FROM public.gift_detail_translations WHERE id = NEW.gift_detail_translation_id FOR UPDATE;
    ELSE document := NEW.document_id;
    END IF;
    SELECT gift_revision_id INTO owner_id FROM public.gift_detail_documents WHERE id = document FOR UPDATE;
  END IF;
  IF TG_TABLE_NAME LIKE 'idol_%' THEN
    SELECT lifecycle INTO parent_state FROM public.idol_revisions WHERE id = owner_id FOR UPDATE;
  ELSE
    SELECT lifecycle INTO parent_state FROM public.gift_revisions WHERE id = owner_id FOR UPDATE;
  END IF;
  IF parent_state IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'content extensions require a draft parent revision' USING ERRCODE = '55000';
  END IF;
  IF editor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.admin_identities WHERE id = editor AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'content draft editor must be active' USING ERRCODE = '23514';
  END IF;
  -- Header commit proves that every immutable capacity is filled. Since child
  -- updates/deletes are forbidden, these locked limits also seal later inserts.
  IF TG_TABLE_NAME = 'idol_revision_aliases' THEN
    SELECT alias_count INTO capacity FROM public.idol_revision_alias_sets WHERE id = alias_set;
    SELECT count(*) INTO occupied FROM public.idol_revision_aliases WHERE alias_set_id = alias_set;
  ELSIF TG_TABLE_NAME = 'gift_detail_blocks' THEN
    SELECT block_count INTO capacity FROM public.gift_detail_documents WHERE id = document;
    SELECT count(*) INTO occupied FROM public.gift_detail_blocks WHERE document_id = document;
  ELSIF TG_TABLE_NAME = 'gift_detail_block_items' THEN
    SELECT item_count INTO capacity FROM public.gift_detail_blocks WHERE document_id = document AND block_id = NEW.block_id;
    SELECT count(*) INTO occupied FROM public.gift_detail_block_items WHERE document_id = document AND block_id = NEW.block_id;
  ELSIF TG_TABLE_NAME = 'gift_detail_translations' THEN
    SELECT translation_count INTO capacity FROM public.gift_detail_documents WHERE id = document;
    SELECT count(*) INTO occupied FROM public.gift_detail_translations WHERE document_id = document;
  ELSIF TG_TABLE_NAME = 'gift_detail_translation_blocks' THEN
    SELECT block_count INTO capacity FROM public.gift_detail_documents WHERE id = document;
    SELECT count(*) INTO occupied FROM public.gift_detail_translation_blocks WHERE translation_id = NEW.translation_id;
  ELSIF TG_TABLE_NAME = 'gift_detail_translation_items' THEN
    SELECT item_count INTO capacity FROM public.gift_detail_blocks WHERE document_id = document AND block_id = NEW.block_id;
    SELECT count(*) INTO occupied FROM public.gift_detail_translation_items WHERE translation_id = NEW.translation_id AND block_id = NEW.block_id;
  ELSE RETURN NEW;
  END IF;
  IF capacity IS NULL OR occupied >= capacity THEN
    RAISE EXCEPTION 'content draft child capacity is sealed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION public.assert_content_draft_audit(audit_id uuid, editor uuid, subject uuid, subject_kind text, action_key text, request uuid, edited timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.id = audit_id
    AND a.actor_type = 'ADMIN' AND a.actor_id = editor AND a.subject_type = subject_kind AND a.subject_id = subject
    AND a.action = action_key AND a.outcome = 'SUCCEEDED' AND a.reason_code IS NOT NULL
    AND a.request_id = request AND a.correlation_id = request AND a.created_at = edited) THEN
    RAISE EXCEPTION 'content draft requires exact creation audit evidence' USING ERRCODE = '23514';
  END IF;
END; $$;

CREATE FUNCTION public.assert_idol_alias_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE draft public.idol_revision_alias_sets%ROWTYPE; target uuid; n integer; last_position integer;
BEGIN
  IF TG_TABLE_NAME = 'idol_revision_alias_sets' THEN target := NEW.id;
  ELSE target := NEW.alias_set_id; END IF;
  SELECT * INTO draft FROM public.idol_revision_alias_sets WHERE id = target;
  PERFORM public.assert_content_draft_audit(draft.audit_log_id,draft.editor_id,draft.id,'IDOL_ALIAS_SET','IDOL_ALIAS_DRAFT_CREATE',draft.request_id,draft.edited_at);
  SELECT count(*),max(position) INTO n,last_position FROM public.idol_revision_aliases WHERE alias_set_id = target;
  IF n <> draft.alias_count OR (n > 0 AND last_position <> n - 1) THEN
    RAISE EXCEPTION 'alias draft rows must match the complete immutable set' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.idol_revision_alias_reviews WHERE alias_set_id = target AND sequence = 1 AND status = 'DRAFT' AND audit_log_id = draft.audit_log_id) THEN
    RAISE EXCEPTION 'alias creation requires its initial draft review' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END; $$;

CREATE FUNCTION public.assert_gift_detail_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE draft public.gift_detail_documents%ROWTYPE; target uuid; n integer; last_position integer; english_hash public.sha256_hex; block record; translation record;
BEGIN
  IF TG_TABLE_NAME = 'gift_detail_documents' THEN target := NEW.id;
  ELSIF TG_TABLE_NAME = 'gift_detail_translation_reviews' THEN
    SELECT document_id INTO target FROM public.gift_detail_translations WHERE id = NEW.gift_detail_translation_id;
  ELSE target := NEW.document_id; END IF;
  SELECT * INTO draft FROM public.gift_detail_documents WHERE id = target;
  PERFORM public.assert_content_draft_audit(draft.audit_log_id,draft.editor_id,draft.id,'GIFT_DETAIL_DOCUMENT','GIFT_DETAIL_DRAFT_CREATE',draft.request_id,draft.edited_at);
  SELECT count(*),max(position) INTO n,last_position FROM public.gift_detail_blocks WHERE document_id = target;
  IF n <> draft.block_count OR last_position <> n - 1 THEN
    RAISE EXCEPTION 'detail document requires its complete ordered blocks' USING ERRCODE = '23514';
  END IF;
  SELECT source_hash INTO english_hash FROM public.gift_detail_translations WHERE document_id = target AND locale = 'en';
  IF english_hash IS NULL OR (SELECT count(*) FROM public.gift_detail_translations WHERE document_id = target) <> draft.translation_count THEN
    RAISE EXCEPTION 'detail document requires its exact translation set including English' USING ERRCODE = '23514';
  END IF;
  FOR block IN SELECT * FROM public.gift_detail_blocks WHERE document_id = target LOOP
    SELECT count(*),max(position) INTO n,last_position FROM public.gift_detail_block_items WHERE document_id = target AND block_id = block.block_id;
    IF n <> block.item_count OR (n > 0 AND last_position <> n - 1) THEN
      RAISE EXCEPTION 'detail block requires its complete ordered item keys' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  FOR translation IN SELECT * FROM public.gift_detail_translations WHERE document_id = target LOOP
    IF translation.translated_from_source_hash <> english_hash OR translation.editor_id <> draft.editor_id OR translation.edited_at <> draft.edited_at THEN
      RAISE EXCEPTION 'detail translation must bind the canonical draft and English source' USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(*) FROM public.gift_detail_translation_blocks WHERE translation_id = translation.id) <> draft.block_count
      OR NOT EXISTS (SELECT 1 FROM public.gift_detail_translation_reviews WHERE gift_detail_translation_id = translation.id AND sequence = 1 AND status = 'DRAFT' AND audit_log_id = draft.audit_log_id) THEN
      RAISE EXCEPTION 'detail translation requires complete blocks and initial draft review' USING ERRCODE = '23514';
    END IF;
    FOR block IN SELECT b.*,t.media_metadata_revision_id translated_media,t.caption
      FROM public.gift_detail_blocks b JOIN public.gift_detail_translation_blocks t ON t.document_id = b.document_id AND t.block_id = b.block_id
      WHERE b.document_id = target AND t.translation_id = translation.id LOOP
      IF (SELECT count(*) FROM public.gift_detail_translation_items WHERE translation_id = translation.id AND block_id = block.block_id) <> block.item_count
        OR (block.kind = 'MEDIA' AND (block.translated_media IS DISTINCT FROM block.media_metadata_revision_id OR (block.caption_enabled AND block.caption IS NULL) OR (NOT block.caption_enabled AND block.caption IS NOT NULL)))
        OR EXISTS (SELECT 1 FROM public.gift_detail_translation_items i WHERE i.translation_id = translation.id AND i.block_id = block.block_id
          AND ((block.kind = 'LIST' AND i.text IS NULL) OR (block.kind = 'SPECIFICATIONS' AND (i.label IS NULL OR i.value IS NULL)))) THEN
        RAISE EXCEPTION 'translated detail items and media must match document structure' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END; $$;

CREATE FUNCTION public.validate_idol_alias_review() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE draft public.idol_revision_alias_sets%ROWTYPE; previous public.idol_revision_alias_reviews%ROWTYPE;
BEGIN
  SELECT * INTO draft FROM public.idol_revision_alias_sets WHERE id = NEW.alias_set_id FOR UPDATE;
  SELECT * INTO previous FROM public.idol_revision_alias_reviews WHERE alias_set_id = NEW.alias_set_id ORDER BY sequence DESC LIMIT 1;
  IF previous.id IS NULL THEN
    IF NEW.sequence <> 1 OR NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'alias review must begin with draft sequence one' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.sequence <> previous.sequence + 1 OR NOT ((previous.status = 'DRAFT' AND NEW.status = 'IN_REVIEW') OR (previous.status = 'IN_REVIEW' AND NEW.status = 'APPROVED')) THEN
    RAISE EXCEPTION 'invalid alias review transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'DRAFT' THEN
    IF NEW.submitted_at IS NOT NULL OR NEW.reviewer_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.reviewed_content_hash IS NOT NULL OR NEW.audit_log_id <> draft.audit_log_id THEN
      RAISE EXCEPTION 'initial alias review cannot carry approval evidence' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.status = 'IN_REVIEW' THEN
    IF NEW.submitted_at IS NULL OR NEW.submitted_at < draft.edited_at OR NEW.reviewer_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.reviewed_content_hash IS NOT NULL THEN
      RAISE EXCEPTION 'invalid alias submission evidence' USING ERRCODE = '23514'; END IF;
  ELSE
    IF NEW.submitted_at IS NOT NULL OR NEW.reviewer_id IS NULL OR NEW.reviewer_id = draft.editor_id OR NEW.reviewed_at IS NULL OR NEW.reviewed_at < previous.submitted_at OR NEW.reviewed_content_hash IS DISTINCT FROM draft.content_hash THEN
      RAISE EXCEPTION 'alias approval must independently bind immutable content' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION public.assert_content_extension_review_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE expected_actor uuid; creation_audit uuid; action_prefix text; subject_kind text; audit public.audit_logs%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'idol_revision_alias_reviews' THEN
    SELECT editor_id,audit_log_id INTO expected_actor,creation_audit FROM public.idol_revision_alias_sets WHERE id = NEW.alias_set_id;
    action_prefix := 'IDOL_ALIAS'; subject_kind := 'IDOL_ALIAS_REVIEW';
  ELSE
    SELECT t.editor_id,d.audit_log_id INTO expected_actor,creation_audit FROM public.gift_detail_translations t JOIN public.gift_detail_documents d ON d.id = t.document_id WHERE t.id = NEW.gift_detail_translation_id;
    action_prefix := 'GIFT_DETAIL'; subject_kind := 'GIFT_DETAIL_TRANSLATION_REVIEW';
  END IF;
  IF NEW.status = 'DRAFT' THEN
    IF NEW.audit_log_id <> creation_audit THEN RAISE EXCEPTION 'draft review must bind creation audit' USING ERRCODE = '23514'; END IF;
  ELSE
    IF NEW.status = 'APPROVED' THEN expected_actor := NEW.reviewer_id; END IF;
    SELECT * INTO audit FROM public.audit_logs WHERE id = NEW.audit_log_id;
    IF audit.id IS NULL OR audit.actor_type <> 'ADMIN' OR audit.actor_id IS DISTINCT FROM expected_actor OR audit.subject_type <> subject_kind OR audit.subject_id <> NEW.id
      OR audit.action <> (action_prefix || CASE NEW.status WHEN 'APPROVED' THEN '_APPROVE' ELSE '_SUBMIT' END)
      OR audit.outcome <> 'SUCCEEDED' OR audit.reason_code IS NULL OR audit.request_id IS NULL OR audit.correlation_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.admin_identities WHERE id = expected_actor AND status = 'ACTIVE') THEN
      RAISE EXCEPTION 'extension review requires exact audit and active actor evidence' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END; $$;

CREATE FUNCTION public.block_content_extension_publication() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE idol_revision uuid; gift_revision uuid;
BEGIN
  IF TG_TABLE_NAME = 'idol_revisions' THEN
    IF NEW.lifecycle = 'DRAFT' THEN RETURN NEW; END IF; idol_revision := NEW.id;
  ELSIF TG_TABLE_NAME = 'gift_revisions' THEN
    IF NEW.lifecycle = 'DRAFT' THEN RETURN NEW; END IF; gift_revision := NEW.id;
  ELSE idol_revision := NEW.idol_revision_id; gift_revision := NEW.gift_revision_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.idol_revision_alias_sets WHERE idol_revision_id = idol_revision)
    OR EXISTS (SELECT 1 FROM public.gift_detail_documents WHERE gift_revision_id = gift_revision) THEN
    RAISE EXCEPTION 'content extension publication proof is not enabled' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER idol_extension_publication_block BEFORE INSERT OR UPDATE OF lifecycle ON public.idol_revisions FOR EACH ROW EXECUTE FUNCTION public.block_content_extension_publication();
CREATE TRIGGER gift_extension_publication_block BEFORE INSERT OR UPDATE OF lifecycle ON public.gift_revisions FOR EACH ROW EXECUTE FUNCTION public.block_content_extension_publication();
CREATE TRIGGER content_extension_publication_block BEFORE INSERT ON public.content_publications FOR EACH ROW EXECUTE FUNCTION public.block_content_extension_publication();
CREATE TRIGGER gift_detail_translation_validate BEFORE INSERT ON public.gift_detail_translations FOR EACH ROW EXECUTE FUNCTION public.validate_translation_row();
CREATE TRIGGER gift_detail_review_validate BEFORE INSERT ON public.gift_detail_translation_reviews FOR EACH ROW EXECUTE FUNCTION public.validate_translation_review_event('public.gift_detail_translations','gift_detail_translation_id','public.gift_revisions','gift_revision_id');
CREATE TRIGGER idol_alias_review_validate BEFORE INSERT ON public.idol_revision_alias_reviews FOR EACH ROW EXECUTE FUNCTION public.validate_idol_alias_review();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['idol_revision_alias_sets','idol_revision_aliases','idol_revision_alias_reviews','gift_detail_documents','gift_detail_blocks','gift_detail_block_items','gift_detail_translations','gift_detail_translation_blocks','gift_detail_translation_items','gift_detail_translation_reviews'] LOOP
    EXECUTE format('CREATE TRIGGER content_draft_insert_guard BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_content_draft_insert()',table_name);
    EXECUTE format('CREATE TRIGGER content_draft_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_append_only()',table_name);
    EXECUTE format('CREATE TRIGGER content_draft_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only()',table_name);
    IF table_name IN ('idol_revision_alias_sets','gift_detail_documents') THEN
      EXECUTE format('CREATE CONSTRAINT TRIGGER content_draft_complete AFTER INSERT ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.%I()',table_name,CASE WHEN table_name LIKE 'idol_%' THEN 'assert_idol_alias_draft' ELSE 'assert_gift_detail_draft' END);
    END IF;
  END LOOP;
END; $$;
CREATE CONSTRAINT TRIGGER idol_alias_review_audit AFTER INSERT ON public.idol_revision_alias_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_extension_review_audit();
CREATE CONSTRAINT TRIGGER gift_detail_review_audit AFTER INSERT ON public.gift_detail_translation_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_extension_review_audit();
