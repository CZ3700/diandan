-- Restore the 0001 media_object_key semantics exactly. The newer constraint is
-- strictly narrower, so every value accepted at 0008 is safe under this rule.
LOCK TABLE public.media_assets, public.media_variants, public.order_items IN ACCESS EXCLUSIVE MODE;

ALTER DOMAIN public.media_object_key
  DROP CONSTRAINT media_object_key_check;

ALTER DOMAIN public.media_object_key
  ADD CONSTRAINT media_object_key_check CHECK (
    length(VALUE) BETWEEN 1 AND 1024
    AND VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    AND VALUE !~ '(^|/)\.\.(/|$)'
  );
