SET search_path=public;
-- L2-10: operator-chosen display order for artists and gifts. Non-linguistic layout metadata (ADR-020):
-- frozen content revisions are untouched; the newest row per kind is the current order.
CREATE FUNCTION catalog_display_order_distinct(ids uuid[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT count(DISTINCT id)=cardinality(ids) AND bool_and(id IS NOT NULL) IS NOT FALSE FROM unnest(ids) AS id
$$;
CREATE TABLE catalog_display_orders (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  kind text NOT NULL CHECK (kind IN ('IDOL','GIFT')),
  version positive_version NOT NULL,
  ordered_ids uuid[] NOT NULL CHECK (cardinality(ordered_ids)<=500 AND catalog_display_order_distinct(ordered_ids)),
  actor_id uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES admin_sessions(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id) ON DELETE RESTRICT,
  idempotency_key idempotency_key_value NOT NULL,
  request_hash sha256_hex NOT NULL,
  created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (kind, version),
  UNIQUE (actor_id, idempotency_key)
);
CREATE FUNCTION guard_catalog_display_order() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.created_at<transaction_timestamp() OR NEW.created_at>clock_timestamp() THEN
    RAISE EXCEPTION 'display order must use database time' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM public.catalog_display_orders WHERE kind=NEW.kind),0)+1 THEN
    RAISE EXCEPTION 'display order versions are consecutive' USING ERRCODE='40001';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.admin_sessions s JOIN public.admin_identities i ON i.id=s.admin_identity_id
      WHERE s.id=NEW.session_id AND s.admin_identity_id=NEW.actor_id AND s.revoked_at IS NULL
        AND s.expires_at>clock_timestamp() AND s.authenticated_with_mfa AND i.status='ACTIVE') THEN
    RAISE EXCEPTION 'display order requires the actor''s live session' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='IDOL' AND EXISTS(SELECT 1 FROM unnest(NEW.ordered_ids) AS entry(id)
      WHERE NOT EXISTS(SELECT 1 FROM public.idols WHERE idols.id=entry.id AND idols.status<>'archived')) THEN
    RAISE EXCEPTION 'display order may only list existing artists' USING ERRCODE='23503';
  END IF;
  IF NEW.kind='GIFT' AND EXISTS(SELECT 1 FROM unnest(NEW.ordered_ids) AS entry(id)
      WHERE NOT EXISTS(SELECT 1 FROM public.gifts WHERE gifts.id=entry.id AND gifts.status<>'archived')) THEN
    RAISE EXCEPTION 'display order may only list existing gifts' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_display_order_guard BEFORE INSERT ON catalog_display_orders
FOR EACH ROW EXECUTE FUNCTION guard_catalog_display_order();
CREATE TRIGGER catalog_display_order_no_update BEFORE UPDATE OR DELETE ON catalog_display_orders
FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER catalog_display_order_no_truncate BEFORE TRUNCATE ON catalog_display_orders
FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE FUNCTION assert_catalog_display_order_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.id=NEW.audit_log_id AND a.actor_type='ADMIN'
      AND a.actor_id=NEW.actor_id AND a.action='CATALOG_DISPLAY_ORDER_SAVE' AND a.subject_type='CATALOG_DISPLAY_ORDER'
      AND a.subject_id=NEW.id AND a.created_at=NEW.created_at AND a.outcome='SUCCEEDED' AND a.request_id IS NOT NULL
      AND a.reason_code IN ('IDOL_ORDER','GIFT_ORDER') AND a.reason_code=NEW.kind||'_ORDER') THEN
    RAISE EXCEPTION 'display order requires exact immutable audit' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER catalog_display_order_audit AFTER INSERT ON catalog_display_orders
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_catalog_display_order_audit();
