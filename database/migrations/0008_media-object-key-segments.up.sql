-- mediaObjectKey treats both "." and ".." as non-canonical path segments.
-- Lock every dependent table before preflight so concurrent writes cannot race
-- the domain replacement. A legacy value aborts the whole migration before the
-- existing constraint is removed.
LOCK TABLE public.media_assets, public.media_variants, public.order_items IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.media_assets
    WHERE object_key ~ '(^|/)\.{1,2}(/|$)|//|/$'
  ) OR EXISTS (
    SELECT 1
    FROM public.media_variants
    WHERE object_key ~ '(^|/)\.{1,2}(/|$)|//|/$'
  ) OR EXISTS (
    SELECT 1
    FROM public.order_items
    WHERE idol_portrait_object_key ~ '(^|/)\.{1,2}(/|$)|//|/$'
      OR gift_image_object_key ~ '(^|/)\.{1,2}(/|$)|//|/$'
  ) THEN
    RAISE EXCEPTION 'migration 0008 cannot be applied while non-canonical media object keys exist'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER DOMAIN public.media_object_key
  DROP CONSTRAINT media_object_key_check;

ALTER DOMAIN public.media_object_key
  ADD CONSTRAINT media_object_key_check CHECK (
    length(VALUE) BETWEEN 1 AND 1024
    AND VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    AND VALUE !~ '(^|/)\.{1,2}(/|$)'
    AND VALUE !~ '//|/$'
  );
