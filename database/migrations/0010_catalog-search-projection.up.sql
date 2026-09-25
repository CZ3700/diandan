-- Rebuildable search data. Typed translations and publication heads remain authoritative.
-- Application writes use the same Unicode normalization as query planning, never SQL lower().
CREATE TABLE public.idol_translation_search_projections (
  idol_translation_id uuid PRIMARY KEY
    REFERENCES public.idol_revision_translations(id) ON DELETE CASCADE,
  source_hash public.sha256_hex NOT NULL,
  algorithm_version integer NOT NULL CHECK (algorithm_version = 1),
  normalized_name text NOT NULL CHECK (char_length(normalized_name) BETWEEN 1 AND 240)
);
CREATE INDEX idol_translation_search_projections_name_idx
  ON public.idol_translation_search_projections (normalized_name text_pattern_ops);
COMMENT ON TABLE public.idol_translation_search_projections IS
  'Rebuildable Unicode search projection; match translation source_hash before use. No publishing authority.';
