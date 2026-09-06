-- Stored generated columns are calculated after BEFORE triggers.
-- valid_during is derived only from the immutable valid_from/valid_to fields below.
-- Keep every source field immutable while allowing the existing status transitions.
CREATE OR REPLACE FUNCTION public.guard_published_price_mutation()
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

  IF (to_jsonb(NEW) - 'status' - 'valid_during') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'valid_during') THEN
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
