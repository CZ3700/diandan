SET search_path = public;
LOCK TABLE storefront_theme_heads,storefront_theme_revisions,storefront_theme_publications,storefront_theme_receipts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storefront_theme_revisions WHERE theme ? 'presentation') THEN
  RAISE EXCEPTION 'presentation history cannot be downgraded' USING ERRCODE='55000';
 END IF;
END $$;
-- A legacy-only history can safely return to the exact previous validation contract.
CREATE OR REPLACE FUNCTION valid_storefront_theme(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR value->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR
    (SELECT count(*) FROM jsonb_object_keys(value))<>5 THEN RETURN false; END IF;
 RETURN coalesce(value->>'palette'=ANY(ARRAY['BLACK_GOLD','GRAPHITE_PEARL','MIDNIGHT_BLUE']) AND
   value->>'typography'=ANY(ARRAY['STANDARD','LARGE']) AND
   value->>'density'=ANY(ARRAY['STANDARD','COMPACT','AIRY']) AND
   value->>'corners'=ANY(ARRAY['SOFT','SHARP','ROUND']),false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
