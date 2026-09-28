SET search_path = public;
LOCK TABLE storefront_theme_heads,storefront_theme_revisions,storefront_theme_publications,storefront_theme_receipts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storefront_theme_revisions WHERE theme ? 'detailTemplates') THEN
  RAISE EXCEPTION 'detail template history cannot be downgraded' USING ERRCODE='55000';
 END IF;
END $$;
-- Preserve both previous generations without deleting fields or rewriting history.
CREATE OR REPLACE FUNCTION valid_storefront_theme(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE presentation jsonb;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR value->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR
    (SELECT count(*) FROM jsonb_object_keys(value))<>(CASE WHEN value ? 'presentation' THEN 6 ELSE 5 END) THEN RETURN false; END IF;
 IF NOT coalesce(value->>'palette'=ANY(ARRAY['BLACK_GOLD','GRAPHITE_PEARL','MIDNIGHT_BLUE']) AND
   value->>'typography'=ANY(ARRAY['STANDARD','LARGE']) AND
   value->>'density'=ANY(ARRAY['STANDARD','COMPACT','AIRY']) AND
   value->>'corners'=ANY(ARRAY['SOFT','SHARP','ROUND']),false) THEN RETURN false; END IF;
 IF NOT value ? 'presentation' THEN RETURN true; END IF;
 presentation := value->'presentation';
 IF jsonb_typeof(presentation) IS DISTINCT FROM 'object' OR
    (SELECT count(*) FROM jsonb_object_keys(presentation))<>4 THEN RETURN false; END IF;
 RETURN coalesce(presentation->>'heroLayout'=ANY(ARRAY['IMMERSIVE','SPLIT']) AND
   presentation->>'giftLayout'=ANY(ARRAY['GRID','SHOWCASE']) AND
   presentation->>'motion'=ANY(ARRAY['STANDARD','SUBTLE','NONE']) AND
   presentation->>'motionSpeed'=ANY(ARRAY['STANDARD','QUICK']),false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
