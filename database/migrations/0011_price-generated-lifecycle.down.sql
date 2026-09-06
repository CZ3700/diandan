-- Restore the prior guard when explicitly rolling back this fix.
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
