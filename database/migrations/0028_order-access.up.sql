SET search_path = public;

-- Only keyed bucket digests are persisted. The transport's network address and
-- all raw link/session credentials stay outside the business database.
CREATE TABLE public.order_access_rate_limits (
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  scope text NOT NULL CHECK (scope IN ('EXCHANGE', 'BOOTSTRAP', 'READ', 'REVOKE')),
  bucket_digest bytea NOT NULL CHECK (octet_length(bucket_digest) = 32),
  pepper_version text NOT NULL CHECK (pepper_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 1000000),
  window_started_at public.finite_timestamptz NOT NULL,
  window_expires_at public.finite_timestamptz NOT NULL,
  updated_at public.finite_timestamptz NOT NULL,
  PRIMARY KEY (scope, bucket_digest, pepper_version),
  CHECK (window_expires_at > window_started_at),
  CHECK (updated_at >= window_started_at)
);
CREATE INDEX order_access_rate_limits_expiry_idx
  ON public.order_access_rate_limits (window_expires_at);

-- Access events carry references and processing identity, never credentials,
-- contacts, private support text, or snapshots of an HTTP request/response.
CREATE TABLE public.order_access_audits (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  token_id uuid REFERENCES public.order_access_tokens(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES public.order_access_sessions(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('ISSUE', 'EXCHANGE', 'BOOTSTRAP', 'REVOKE')),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  task_name text NOT NULL CHECK (
    length(task_name) BETWEEN 1 AND 128
    AND task_name ~ '^[a-z][a-z0-9]*([-_:][a-z0-9]+)*$'
  ),
  created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK ((action = 'ISSUE' AND token_id IS NOT NULL AND session_id IS NULL)
    OR (action IN ('EXCHANGE', 'BOOTSTRAP') AND token_id IS NOT NULL AND session_id IS NOT NULL)
    OR action = 'REVOKE')
);
CREATE INDEX order_access_audits_order_created_idx
  ON public.order_access_audits (order_id, created_at, id);
CREATE TRIGGER order_access_audits_append_only
  BEFORE UPDATE OR DELETE ON public.order_access_audits
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER order_access_audits_no_truncate
  BEFORE TRUNCATE ON public.order_access_audits
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE FUNCTION public.validate_order_access_audit_scope()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.token_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.order_access_tokens token
    WHERE token.id = NEW.token_id AND token.order_id = NEW.order_id
  ) THEN
    RAISE EXCEPTION 'order access audit token must belong to its order' USING ERRCODE = '23514';
  END IF;
  IF NEW.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.order_access_sessions session
    WHERE session.id = NEW.session_id AND session.order_id = NEW.order_id
      AND (NEW.token_id IS NULL OR session.exchanged_token_id = NEW.token_id)
  ) THEN
    RAISE EXCEPTION 'order access audit session must belong to its order and token' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER order_access_audits_scope
  AFTER INSERT ON public.order_access_audits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_order_access_audit_scope();
