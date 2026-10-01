SET search_path=public;
-- ADR-022 / L3-13: private notes about an artist (real name, contact, identity details, other), readable and
-- writable only with idols.private on a sign-in that actually used a second factor. The key may already
-- exist where `admin-account.mjs sync-roles` ran after L3-11.
INSERT INTO public.permissions(id,permission_key,description) VALUES
 (gen_random_uuid(),'idols.private','Read and edit the private notes of every artist')
ON CONFLICT(permission_key) DO NOTHING;

-- Built-in sessions always carry authenticated_with_mfa (ADR-021 addendum 1), so the second-factor rule reads
-- the sign-in that issued this session, and the account must still have TOTP now: switching TOTP off keeps
-- the current session alive. OIDC sessions have no built-in sign-in and never qualify.
CREATE FUNCTION public.artist_private_note_authorized(p_session uuid, p_actor uuid, p_at timestamptz)
RETURNS boolean LANGUAGE sql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.admin_order_authorized(p_session,p_actor,'idols.private',p_at)
  AND EXISTS(SELECT 1 FROM public.admin_local_logins l JOIN public.admin_local_accounts a ON a.id=l.account_id
   WHERE l.session_id=p_session AND a.admin_identity_id=p_actor AND l.state='CONSUMED'
    AND l.second_factor IN('TOTP','RECOVERY_CODE') AND a.totp_ciphertext IS NOT NULL);
$$;

-- Every save is a new version; nothing is ever updated, so the history is the table.
CREATE TABLE public.artist_private_notes (
 id uuid PRIMARY KEY,
 idol_id uuid NOT NULL REFERENCES public.idols(id),
 version public.positive_version NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id),
 session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 ciphertext public.ciphertext_bytes NOT NULL,
 encrypted_data_key public.ciphertext_bytes NOT NULL,
 key_version text NOT NULL CHECK(key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),
 request_id uuid NOT NULL,
 created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(idol_id,version),
 UNIQUE(id,idol_id)
);
CREATE FUNCTION public.guard_artist_private_note() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE latest public.artist_private_notes%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('fan-support:artist-private-note:'||NEW.idol_id::text,0));
 SELECT * INTO latest FROM public.artist_private_notes WHERE idol_id=NEW.idol_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>coalesce(latest.version,0)+1 OR NEW.created_at<latest.created_at THEN
  RAISE EXCEPTION 'private note versions continue the artist history' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER artist_private_note_guard BEFORE INSERT ON public.artist_private_notes FOR EACH ROW EXECUTE FUNCTION public.guard_artist_private_note();
CREATE FUNCTION public.assert_artist_private_note() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs a JOIN public.admin_sessions s ON s.id=NEW.session_id WHERE a.id=NEW.audit_log_id AND a.actor_type='ADMIN' AND a.actor_id=NEW.actor_id
  AND a.action='ARTIST_PRIVATE_NOTE_SAVED' AND a.subject_type='IDOL' AND a.subject_id=NEW.idol_id AND a.field_category='ARTIST_PRIVATE' AND a.outcome='SUCCEEDED'
  AND a.request_id=NEW.request_id AND a.created_at=NEW.created_at AND s.admin_identity_id=NEW.actor_id) THEN
  RAISE EXCEPTION 'private note requires its exact audit record' USING ERRCODE='23514'; END IF;
 IF NOT public.artist_private_note_authorized(NEW.session_id,NEW.actor_id,NEW.created_at) THEN
  RAISE EXCEPTION 'private note requires idols.private on a second-factor sign-in' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER artist_private_note_complete AFTER INSERT ON public.artist_private_notes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_artist_private_note();

-- Reading one version: the audit and this receipt commit before the caller decrypts; the confirmation after
-- decryption proves the same session still holds the same authority.
CREATE TABLE public.artist_private_note_accesses (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id),
 session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 idol_id uuid NOT NULL,
 note_id uuid NOT NULL,
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),
 request_id uuid NOT NULL,
 correlation_id uuid NOT NULL,
 created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
 expires_at public.finite_timestamptz NOT NULL,
 FOREIGN KEY(note_id,idol_id) REFERENCES public.artist_private_notes(id,idol_id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '300 seconds')
);
CREATE INDEX artist_private_note_accesses_idol_idx ON public.artist_private_note_accesses(idol_id,created_at DESC);
CREATE FUNCTION public.assert_artist_private_note_access() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.admin_sessions%ROWTYPE;
BEGIN
 SELECT * INTO s FROM public.admin_sessions WHERE id=NEW.session_id;
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.id=NEW.audit_log_id AND a.actor_type='ADMIN' AND a.actor_id=NEW.actor_id
  AND a.action='ARTIST_PRIVATE_READ' AND a.subject_type='IDOL' AND a.subject_id=NEW.idol_id AND a.field_category='ARTIST_PRIVATE' AND a.outcome='SUCCEEDED'
  AND a.created_at=NEW.created_at AND a.request_id=NEW.request_id AND a.correlation_id=NEW.correlation_id) OR s.admin_identity_id IS DISTINCT FROM NEW.actor_id THEN
  RAISE EXCEPTION 'private note read requires exact session and audit' USING ERRCODE='23514'; END IF;
 IF NOT public.artist_private_note_authorized(NEW.session_id,NEW.actor_id,NEW.created_at) THEN
  RAISE EXCEPTION 'private note read requires idols.private on a second-factor sign-in' USING ERRCODE='23514'; END IF;
 IF NEW.expires_at>s.expires_at THEN
  RAISE EXCEPTION 'private read may not outlive its session' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER artist_private_note_access_complete AFTER INSERT ON public.artist_private_note_accesses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_artist_private_note_access();
CREATE TABLE public.artist_private_note_confirmations (
 access_id uuid PRIMARY KEY REFERENCES public.artist_private_note_accesses(id),
 confirmed_at public.finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION public.assert_artist_private_note_confirmation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.artist_private_note_accesses a JOIN public.admin_sessions s ON s.id=a.session_id
  WHERE a.id=NEW.access_id AND a.created_at<=NEW.confirmed_at AND a.expires_at>NEW.confirmed_at AND NEW.confirmed_at<=clock_timestamp()
   AND s.admin_identity_id=a.actor_id AND public.artist_private_note_authorized(a.session_id,a.actor_id,NEW.confirmed_at)) THEN
  RAISE EXCEPTION 'private note confirmation requires live same-session authority' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER artist_private_note_confirmation_complete AFTER INSERT ON public.artist_private_note_confirmations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_artist_private_note_confirmation();

DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['artist_private_notes','artist_private_note_accesses','artist_private_note_confirmations'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_append_only()',name||'_append_only',name);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only()',name||'_no_truncate',name);
 END LOOP;
END $$;
