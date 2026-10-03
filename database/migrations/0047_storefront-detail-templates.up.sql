SET search_path = public;
-- Detail templates remain independent of presentation; old theme JSON is never rewritten.
CREATE OR REPLACE FUNCTION valid_storefront_theme(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE presentation jsonb; detail_templates jsonb;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR value->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR
    (SELECT count(*) FROM jsonb_object_keys(value))<>(5+(CASE WHEN value ? 'presentation' THEN 1 ELSE 0 END)+(CASE WHEN value ? 'detailTemplates' THEN 1 ELSE 0 END)) THEN RETURN false; END IF;
 IF NOT coalesce(value->>'palette'=ANY(ARRAY['BLACK_GOLD','GRAPHITE_PEARL','MIDNIGHT_BLUE']) AND
   value->>'typography'=ANY(ARRAY['STANDARD','LARGE']) AND
   value->>'density'=ANY(ARRAY['STANDARD','COMPACT','AIRY']) AND
   value->>'corners'=ANY(ARRAY['SOFT','SHARP','ROUND']),false) THEN RETURN false; END IF;
 IF value ? 'presentation' THEN
  presentation := value->'presentation';
  IF jsonb_typeof(presentation) IS DISTINCT FROM 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(presentation))<>4 THEN RETURN false; END IF;
  IF NOT coalesce(presentation->>'heroLayout'=ANY(ARRAY['IMMERSIVE','SPLIT']) AND
    presentation->>'giftLayout'=ANY(ARRAY['GRID','SHOWCASE']) AND
    presentation->>'motion'=ANY(ARRAY['STANDARD','SUBTLE','NONE']) AND
    presentation->>'motionSpeed'=ANY(ARRAY['STANDARD','QUICK']),false) THEN RETURN false; END IF;
 END IF;
 IF value ? 'detailTemplates' THEN
  detail_templates := value->'detailTemplates';
  IF jsonb_typeof(detail_templates) IS DISTINCT FROM 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(detail_templates))<>2 THEN RETURN false; END IF;
  IF NOT coalesce(detail_templates->>'artist'=ANY(ARRAY['IMMERSIVE','SPLIT']) AND
    detail_templates->>'gift'=ANY(ARRAY['IMAGE_LEFT','IMAGE_RIGHT']),false) THEN RETURN false; END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
