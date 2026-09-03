SET search_path = public;

CREATE EXTENSION btree_gist;

CREATE DOMAIN supported_locale AS text
  CHECK (VALUE IN ('en', 'zh-CN', 'th', 'vi', 'ja', 'es', 'pt'));

CREATE DOMAIN currency_code AS text
  CHECK (VALUE ~ '^[A-Z]{3}$');

CREATE DOMAIN country_code AS text
  CHECK (VALUE ~ '^[A-Z]{2}$');

CREATE DOMAIN market_code AS text
  CHECK (VALUE ~ '^[A-Z][A-Z0-9_-]{1,15}$');

CREATE DOMAIN minor_amount AS bigint
  CHECK (VALUE >= 0 AND VALUE <= 9007199254740991);

CREATE DOMAIN positive_version AS bigint
  CHECK (VALUE >= 1 AND VALUE <= 9007199254740991);

CREATE DOMAIN sha256_hex AS text
  CHECK (VALUE ~ '^[a-f0-9]{64}$');

CREATE DOMAIN idempotency_key_value AS text
  CHECK (
    length(VALUE) BETWEEN 16 AND 256
    AND VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  );

CREATE DOMAIN media_object_key AS text
  CHECK (
    length(VALUE) BETWEEN 1 AND 1024
    AND VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    AND VALUE !~ '(^|/)\.\.(/|$)'
  );

CREATE DOMAIN opaque_provider_reference AS text
  CHECK (
    length(VALUE) BETWEEN 1 AND 256
    AND VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
  );

CREATE DOMAIN finite_timestamptz AS timestamptz
  CHECK (isfinite(VALUE));

CREATE DOMAIN idempotency_actor_reference AS text
  CHECK (
    length(VALUE) BETWEEN 55 AND 96
    AND VALUE ~ '^actor-ref:v1:(guest|admin|system|worker):([a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
  );

CREATE DOMAIN safe_idempotency_result_reference AS text
  CHECK (
    length(VALUE) BETWEEN 15 AND 96
    AND (
      VALUE ~ '^result-ref:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR VALUE IN (
        'error-ref:v1:NOT_FOUND',
        'error-ref:v1:REQUEST_REJECTED',
        'error-ref:v1:VALIDATION_FAILED',
        'error-ref:v1:UNAUTHORIZED',
        'error-ref:v1:FORBIDDEN',
        'error-ref:v1:CONFLICT',
        'error-ref:v1:IDEMPOTENCY_CONFLICT',
        'error-ref:v1:STALE_VERSION',
        'error-ref:v1:RATE_LIMITED',
        'error-ref:v1:PAYMENT_UNAVAILABLE',
        'error-ref:v1:INTERNAL_ERROR'
      )
    )
  );

CREATE DOMAIN secret_reference AS text
  CHECK (
    length(VALUE) BETWEEN 18 AND 512
    AND VALUE ~ '^secret-ref:v1:[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._/@-]*$'
  );

CREATE DOMAIN ciphertext_bytes AS bytea
  CHECK (octet_length(VALUE) >= 16);

CREATE FUNCTION guard_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION guard_immutable_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  column_name text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV
  LOOP
    IF (to_jsonb(NEW) -> column_name) IS DISTINCT FROM
       (to_jsonb(OLD) -> column_name) THEN
      RAISE EXCEPTION '% column %.% is immutable', TG_TABLE_NAME, TG_TABLE_NAME, column_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_config_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle <> 'DRAFT' THEN
      RAISE EXCEPTION 'new configuration revisions must start in DRAFT'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'configuration revisions cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - 'lifecycle' - 'published_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'lifecycle' - 'published_at') THEN
    RAISE EXCEPTION 'configuration revision payload is immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    NEW.lifecycle = OLD.lifecycle
    OR (OLD.lifecycle = 'DRAFT' AND NEW.lifecycle = 'VALIDATED')
    OR (OLD.lifecycle = 'VALIDATED' AND NEW.lifecycle = 'PUBLISHED')
    OR (OLD.lifecycle = 'PUBLISHED' AND NEW.lifecycle = 'SUPERSEDED')
    OR (OLD.lifecycle = 'SUPERSEDED' AND NEW.lifecycle = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'invalid configuration lifecycle transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.lifecycle = OLD.lifecycle AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'configuration publication time is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_idempotency_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'safe_result_reference' - 'updated_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'safe_result_reference' - 'updated_at') THEN
    RAISE EXCEPTION 'idempotency request identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('SUCCEEDED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'invalid idempotency status transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'IN_PROGRESS' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'terminal idempotency evidence is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE admin_identities (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 512),
  external_subject_hash bytea NOT NULL CHECK (octet_length(external_subject_hash) >= 32),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  mfa_required boolean NOT NULL DEFAULT true,
  version positive_version NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT admin_identities_issuer_subject_unique UNIQUE (issuer, external_subject_hash)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  role_key text NOT NULL CHECK (role_key ~ '^[a-z][a-z0-9.:-]{1,127}$'),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT roles_role_key_unique UNIQUE (role_key)
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  permission_key text NOT NULL CHECK (permission_key ~ '^[a-z][a-z0-9.:-]{1,127}$'),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT permissions_permission_key_unique UNIQUE (permission_key)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  granted_by uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE admin_identity_roles (
  admin_identity_id uuid NOT NULL REFERENCES admin_identities(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  granted_by uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  PRIMARY KEY (admin_identity_id, role_id)
);

CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  admin_identity_id uuid NOT NULL REFERENCES admin_identities(id) ON DELETE CASCADE,
  session_token_digest bytea NOT NULL CHECK (octet_length(session_token_digest) >= 32),
  csrf_token_digest bytea NOT NULL CHECK (octet_length(csrf_token_digest) >= 32),
  authenticated_with_mfa boolean NOT NULL,
  expires_at finite_timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT admin_sessions_token_digest_unique UNIQUE (session_token_digest),
  CONSTRAINT admin_sessions_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT admin_sessions_revocation_check CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX admin_sessions_identity_active_idx
  ON admin_sessions (admin_identity_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE config_versions (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  config_kind text NOT NULL CHECK (config_kind ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  version positive_version NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  created_by uuid NOT NULL REFERENCES admin_identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  published_at timestamptz,
  CONSTRAINT config_versions_kind_version_unique UNIQUE (config_kind, version),
  CONSTRAINT config_versions_publication_time_check CHECK (
    (lifecycle IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED') AND published_at IS NOT NULL)
    OR (lifecycle IN ('DRAFT', 'VALIDATED') AND published_at IS NULL)
  )
);

CREATE UNIQUE INDEX config_versions_one_published_per_kind_idx
  ON config_versions (config_kind)
  WHERE lifecycle = 'PUBLISHED';

CREATE TRIGGER config_versions_mutation_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON config_versions
  FOR EACH ROW EXECUTE FUNCTION guard_config_version_mutation();

CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  actor idempotency_actor_reference NOT NULL,
  operation text NOT NULL CHECK (
    length(operation) BETWEEN 2 AND 128
    AND operation ~ '^[a-z][a-z0-9._:-]{1,127}$'
  ),
  idempotency_key idempotency_key_value NOT NULL,
  canonical_request_hash sha256_hex NOT NULL,
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED')),
  safe_result_reference safe_idempotency_result_reference,
  expires_at finite_timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT idempotency_records_scope_key_unique UNIQUE (
    actor,
    operation,
    idempotency_key
  ),
  CONSTRAINT idempotency_records_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT idempotency_records_result_check CHECK (
    (status = 'IN_PROGRESS' AND safe_result_reference IS NULL)
    OR (status IN ('SUCCEEDED', 'FAILED') AND safe_result_reference IS NOT NULL)
  )
);

CREATE INDEX idempotency_records_expiry_idx ON idempotency_records (expires_at);

CREATE TRIGGER idempotency_records_mutation_trigger
  BEFORE UPDATE ON idempotency_records
  FOR EACH ROW EXECUTE FUNCTION guard_idempotency_record_mutation();

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  actor_type text NOT NULL CHECK (actor_type IN ('ADMIN', 'SYSTEM', 'WORKER')),
  actor_id uuid REFERENCES admin_identities(id) ON DELETE RESTRICT,
  task_name text CHECK (
    task_name IS NULL
    OR (length(task_name) BETWEEN 1 AND 128
      AND task_name ~ '^[a-z][a-z0-9]*([-_:][a-z0-9]+)*$')
  ),
  action text NOT NULL CHECK (action ~ '^[A-Z][A-Z0-9_]{1,127}$'),
  subject_type text NOT NULL CHECK (subject_type ~ '^[A-Z][A-Z0-9_]{1,127}$'),
  subject_id uuid NOT NULL,
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,127}$'),
  request_id uuid,
  correlation_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'REJECTED', 'FAILED')),
  field_category text CHECK (field_category IS NULL OR field_category ~ '^[A-Z][A-Z0-9_]{1,127}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT audit_logs_actor_check CHECK (
    (actor_type = 'ADMIN' AND actor_id IS NOT NULL AND task_name IS NULL)
    OR (actor_type IN ('SYSTEM', 'WORKER') AND actor_id IS NULL AND task_name IS NOT NULL)
  )
);

CREATE INDEX audit_logs_subject_created_idx
  ON audit_logs (subject_type, subject_id, created_at DESC);

CREATE TRIGGER audit_logs_append_only_trigger
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER audit_logs_no_truncate_trigger
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
