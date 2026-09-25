-- Platform authorization remains owned by the existing identity/session/RBAC tables.
-- Language assignments are an additional capability, never a substitute for RBAC.
CREATE TABLE public.admin_content_locale_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_identity_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  locale public.supported_locale NOT NULL,
  granted_by uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  granted_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  revoked_at public.finite_timestamptz,
  revoked_audit_log_id uuid UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  CHECK ((revoked_at IS NULL) = (revoked_audit_log_id IS NULL))
);
CREATE UNIQUE INDEX admin_content_locale_grants_active_unique ON public.admin_content_locale_grants(admin_identity_id,locale) WHERE revoked_at IS NULL;

CREATE FUNCTION public.assert_admin_content_locale_grant_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE audit public.audit_logs%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at THEN RETURN NULL; END IF;
    SELECT * INTO audit FROM public.audit_logs WHERE id = NEW.revoked_audit_log_id;
    IF audit.id IS NULL OR audit.action <> 'CONTENT_LOCALE_REVOKE' OR audit.created_at <> NEW.revoked_at THEN
      RAISE EXCEPTION 'locale revocation requires exact audit' USING ERRCODE = '23514';
    END IF;
  ELSE
  SELECT * INTO audit FROM public.audit_logs WHERE id = NEW.audit_log_id;
    IF audit.id IS NULL OR audit.action <> 'CONTENT_LOCALE_GRANT' OR audit.created_at <> NEW.granted_at THEN
      RAISE EXCEPTION 'locale grant requires exact audit' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF audit.id IS NULL OR audit.actor_type <> 'ADMIN'
    OR (TG_OP = 'INSERT' AND audit.actor_id IS DISTINCT FROM NEW.granted_by)
    OR audit.subject_type <> 'ADMIN_CONTENT_LOCALE_GRANT'
    OR audit.subject_id <> NEW.admin_identity_id OR audit.outcome <> 'SUCCEEDED'
    OR audit.reason_code IS NULL OR audit.request_id IS NULL OR audit.correlation_id IS NULL
    OR audit.field_category IS DISTINCT FROM 'CONTENT_TRANSLATION'
    OR NOT EXISTS (SELECT 1 FROM public.admin_identities WHERE id = audit.actor_id AND status = 'ACTIVE')
    OR (TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM public.admin_identities WHERE id = NEW.admin_identity_id AND status = 'ACTIVE')) THEN
    RAISE EXCEPTION 'content locale grant requires exact active actor audit' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_content_locale_grant_audit AFTER INSERT OR UPDATE ON public.admin_content_locale_grants
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_content_locale_grant_audit();
CREATE FUNCTION public.guard_admin_content_locale_grant() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$ BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revoked_at IS NOT NULL OR NEW.revoked_audit_log_id IS NOT NULL OR NEW.granted_at > clock_timestamp() THEN
      RAISE EXCEPTION 'new locale grant must be current and unrevoked' USING ERRCODE = '23514';
    END IF;
  ELSIF to_jsonb(NEW) - ARRAY['revoked_at','revoked_audit_log_id'] IS DISTINCT FROM to_jsonb(OLD) - ARRAY['revoked_at','revoked_audit_log_id']
    OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_audit_log_id IS DISTINCT FROM OLD.revoked_audit_log_id))
    OR NEW.revoked_at IS NULL OR NEW.revoked_at > clock_timestamp() THEN
    RAISE EXCEPTION 'locale grant only permits one-way audited revocation' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER admin_content_locale_grant_guard BEFORE INSERT OR UPDATE ON public.admin_content_locale_grants
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_content_locale_grant();
CREATE TRIGGER admin_content_locale_grant_no_delete BEFORE DELETE ON public.admin_content_locale_grants
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER admin_content_locale_grant_no_truncate BEFORE TRUNCATE ON public.admin_content_locale_grants
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE TABLE public.content_preview_grants (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
  alias_set_id uuid REFERENCES public.idol_revision_alias_sets(id) ON DELETE RESTRICT,
  gift_detail_document_id uuid REFERENCES public.gift_detail_documents(id) ON DELETE RESTRICT,
  locale public.supported_locale NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES public.admin_sessions(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at public.finite_timestamptz NOT NULL,
  revoked_at public.finite_timestamptz,
  revoked_audit_log_id uuid UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  CHECK (num_nonnulls(alias_set_id, gift_detail_document_id) = 1),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '900 seconds'),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK ((revoked_at IS NULL) = (revoked_audit_log_id IS NULL))
);
CREATE INDEX content_preview_grants_session_active_idx ON public.content_preview_grants(session_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE FUNCTION public.guard_content_preview_grant() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE session public.admin_sessions%ROWTYPE; identity_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - ARRAY['revoked_at','revoked_audit_log_id'] IS DISTINCT FROM to_jsonb(OLD) - ARRAY['revoked_at','revoked_audit_log_id']
      OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_audit_log_id IS DISTINCT FROM OLD.revoked_audit_log_id))
      OR NEW.revoked_at IS NULL OR NEW.revoked_at > GREATEST(clock_timestamp(),transaction_timestamp(),OLD.created_at) THEN
      RAISE EXCEPTION 'preview grant only permits one-way revocation' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO session FROM public.admin_sessions WHERE id = NEW.session_id FOR SHARE;
  SELECT status INTO identity_status FROM public.admin_identities WHERE id = NEW.actor_id FOR SHARE;
  IF session.id IS NULL OR session.admin_identity_id <> NEW.actor_id OR identity_status IS DISTINCT FROM 'ACTIVE'
    OR NOT session.authenticated_with_mfa OR session.revoked_at IS NOT NULL OR session.expires_at <= clock_timestamp()
    OR NEW.created_at < session.created_at OR NEW.created_at > GREATEST(clock_timestamp(),transaction_timestamp(),session.created_at)
    OR NEW.expires_at > session.expires_at OR NEW.revoked_at IS NOT NULL OR NEW.revoked_audit_log_id IS NOT NULL THEN
    RAISE EXCEPTION 'preview grant requires its active MFA session and actor' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER content_preview_grant_guard BEFORE INSERT OR UPDATE ON public.content_preview_grants
  FOR EACH ROW EXECUTE FUNCTION public.guard_content_preview_grant();
CREATE TRIGGER content_preview_grant_no_delete BEFORE DELETE ON public.content_preview_grants
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER content_preview_grant_no_truncate BEFORE TRUNCATE ON public.content_preview_grants
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE FUNCTION public.assert_content_preview_grant_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE audit public.audit_logs%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO audit FROM public.audit_logs WHERE id = NEW.audit_log_id;
    IF audit.id IS NULL OR audit.action <> 'CONTENT_PREVIEW_ISSUE' OR audit.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'preview issuance requires exact audit' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at THEN RETURN NULL; END IF;
    SELECT * INTO audit FROM public.audit_logs WHERE id = NEW.revoked_audit_log_id;
    IF audit.id IS NULL OR audit.action <> 'CONTENT_PREVIEW_REVOKE' OR audit.created_at <> NEW.revoked_at THEN
      RAISE EXCEPTION 'preview revocation requires exact audit' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF audit.id IS NULL OR audit.actor_type <> 'ADMIN' OR audit.actor_id IS DISTINCT FROM NEW.actor_id
    OR audit.subject_type <> 'CONTENT_PREVIEW_GRANT' OR audit.subject_id <> NEW.id OR audit.outcome <> 'SUCCEEDED'
    OR audit.reason_code IS NULL OR audit.request_id IS NULL OR audit.correlation_id IS NULL THEN
    RAISE EXCEPTION 'preview grant requires exact actor and subject audit' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER content_preview_grant_audit AFTER INSERT OR UPDATE ON public.content_preview_grants
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_preview_grant_audit();

-- Keep the frozen translation rules and publication block. Structure participates
-- in the detail content hash, so its author cannot approve through another editor.
CREATE FUNCTION public.guard_gift_detail_structure_review() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE structure_editor uuid;
BEGIN
  IF NEW.status = 'APPROVED' THEN
    SELECT d.editor_id INTO structure_editor FROM public.gift_detail_translations t
      JOIN public.gift_detail_documents d ON d.id = t.document_id WHERE t.id = NEW.gift_detail_translation_id;
    IF structure_editor IS NULL OR NEW.reviewer_id = structure_editor THEN
      RAISE EXCEPTION 'gift detail structure requires independent approval' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER gift_detail_structure_review_guard BEFORE INSERT ON public.gift_detail_translation_reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_gift_detail_structure_review();
