SET search_path=public;
INSERT INTO public.permissions(id,permission_key,description) VALUES
 (gen_random_uuid(),'payments.read','Read payment configuration'),
 (gen_random_uuid(),'payments.configure','Create and validate payment configuration'),
 (gen_random_uuid(),'payments.review','Independently review payment translations'),
 (gen_random_uuid(),'payments.publish','Publish and roll back payment configuration') ON CONFLICT(permission_key) DO NOTHING;
INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.role_key='manager' AND p.permission_key IN('payments.read','payments.configure','payments.review','payments.publish') ON CONFLICT DO NOTHING;

CREATE FUNCTION public.managed_payment_document_is_safe(doc jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c jsonb;t jsonb;r jsonb;h jsonb;value text; field text;
BEGIN
 IF NOT coalesce(jsonb_typeof(doc)='object' AND doc->'schemaVersion'='1'::jsonb AND jsonb_typeof(doc->'channels')='array' AND jsonb_typeof(doc->'routes')='array' AND doc-ARRAY['schemaVersion','channels','routes']='{}'::jsonb,false) THEN RETURN false;END IF;
 IF jsonb_array_length(doc->'channels')>100 OR jsonb_array_length(doc->'routes')>200 THEN RETURN false;END IF;
 FOR c IN SELECT x FROM jsonb_array_elements(doc->'channels') x LOOP
  h:=c->'healthPolicy';
  IF EXISTS(SELECT 1 FROM jsonb_each(h) e WHERE jsonb_typeof(e.value)<>'number' OR (e.value::text)::numeric<>trunc((e.value::text)::numeric)) THEN RETURN false;END IF;
  IF NOT coalesce(c-ARRAY['providerAccountId','enabled','displayOrder','rolloutBasisPoints','healthPolicy','translations']='{}'::jsonb AND (c->>'providerAccountId')::uuid IS NOT NULL AND jsonb_typeof(c->'enabled')='boolean' AND jsonb_typeof(c->'displayOrder')='number' AND (c->>'displayOrder')::numeric BETWEEN 0 AND 2147483647 AND (c->>'displayOrder')::numeric=trunc((c->>'displayOrder')::numeric) AND jsonb_typeof(c->'rolloutBasisPoints')='number' AND (c->>'rolloutBasisPoints')::numeric BETWEEN 0 AND 10000 AND (c->>'rolloutBasisPoints')::numeric=trunc((c->>'rolloutBasisPoints')::numeric) AND jsonb_typeof(c->'translations')='array' AND jsonb_array_length(c->'translations')<=7 AND jsonb_typeof(h)='object' AND h-ARRAY['failureThreshold','failureWindowMs','openDurationMs','probeLeaseMs','probeRetryMs']='{}'::jsonb AND (h->>'failureThreshold')::integer BETWEEN 1 AND 100 AND (h->>'failureWindowMs')::integer BETWEEN 1000 AND 3600000 AND (h->>'openDurationMs')::integer BETWEEN 1000 AND 86400000 AND (h->>'probeLeaseMs')::integer BETWEEN 1000 AND 120000 AND (h->>'probeRetryMs')::integer BETWEEN 1000 AND 86400000,false) THEN RETURN false;END IF;
  FOR t IN SELECT x FROM jsonb_array_elements(c->'translations') x LOOP
   IF jsonb_typeof(t->'locale') IS DISTINCT FROM 'string' OR NOT coalesce(t->'translatedFromSourceHash'='null'::jsonb OR jsonb_typeof(t->'translatedFromSourceHash')='string',false) THEN RETURN false;END IF;
   IF NOT coalesce(t-ARRAY['locale','displayName','customerHint','translatedFromSourceHash']='{}'::jsonb AND (t->>'locale')::public.supported_locale IS NOT NULL AND jsonb_typeof(t->'displayName')='string' AND length(t->>'displayName') BETWEEN 1 AND 80 AND jsonb_typeof(t->'customerHint')='string' AND length(t->>'customerHint') BETWEEN 1 AND 280 AND (t->'translatedFromSourceHash'='null'::jsonb OR t->>'translatedFromSourceHash' ~ '^[a-f0-9]{64}$'),false) THEN RETURN false;END IF;
  END LOOP;
  IF (SELECT count(DISTINCT x->>'locale') FROM jsonb_array_elements(c->'translations') x)<>jsonb_array_length(c->'translations') THEN RETURN false;END IF;
 END LOOP;
 IF (SELECT count(DISTINCT (x->>'providerAccountId')::uuid) FROM jsonb_array_elements(doc->'channels') x)<>jsonb_array_length(doc->'channels') THEN RETURN false;END IF;
 FOR r IN SELECT x FROM jsonb_array_elements(doc->'routes') x LOOP
  IF jsonb_typeof(r->'ruleKey') IS DISTINCT FROM 'string' OR jsonb_typeof(r->'paymentMethod') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
  FOREACH field IN ARRAY ARRAY['minimumAmountMinor','maximumAmountMinor','priority','rolloutBasisPoints'] LOOP
   IF jsonb_typeof(r->field) IS DISTINCT FROM 'number' OR (r->>field)::numeric<>trunc((r->>field)::numeric) THEN RETURN false;END IF;
  END LOOP;
  IF NOT coalesce(r-ARRAY['ruleKey','providerAccountId','paymentMethod','enabled','countries','markets','currencies','minimumAmountMinor','maximumAmountMinor','requiredDeviceCapabilities','priority','rolloutBasisPoints']='{}'::jsonb AND r->>'ruleKey' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' AND (r->>'providerAccountId')::uuid IS NOT NULL AND r->>'paymentMethod' ~ '^[a-z0-9][a-z0-9_-]{0,63}$' AND jsonb_typeof(r->'enabled')='boolean' AND (r->>'minimumAmountMinor')::public.minor_amount IS NOT NULL AND (r->>'maximumAmountMinor')::public.minor_amount IS NOT NULL AND (r->>'priority')::integer IS NOT NULL AND (r->>'rolloutBasisPoints')::integer BETWEEN 0 AND 10000 AND jsonb_typeof(r->'countries')='array' AND jsonb_typeof(r->'markets')='array' AND jsonb_typeof(r->'currencies')='array' AND jsonb_typeof(r->'requiredDeviceCapabilities')='array',false) THEN RETURN false;END IF;
  FOR value IN SELECT jsonb_array_elements_text(r->'countries') LOOP PERFORM value::public.country_code;END LOOP;
  FOR value IN SELECT jsonb_array_elements_text(r->'markets') LOOP PERFORM value::public.market_code;END LOOP;
  FOR value IN SELECT jsonb_array_elements_text(r->'currencies') LOOP PERFORM value::public.currency_code;END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(r->'requiredDeviceCapabilities') capability(element) WHERE capability.element NOT IN('REDIRECT','QR_CODE','PROVIDER_HOSTED_IFRAME','PROVIDER_COMPONENT')) THEN RETURN false;END IF;
  FOREACH field IN ARRAY ARRAY['countries','markets','currencies','requiredDeviceCapabilities'] LOOP
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->field) e WHERE jsonb_typeof(e)<>'string') OR (SELECT count(DISTINCT e) FROM jsonb_array_elements(r->field) e)<>jsonb_array_length(r->field) OR jsonb_array_length(r->field)>(CASE field WHEN 'countries' THEN 250 WHEN 'requiredDeviceCapabilities' THEN 4 ELSE 100 END) THEN RETURN false;END IF;
  END LOOP;
 END LOOP;
 RETURN (SELECT count(DISTINCT x->>'ruleKey') FROM jsonb_array_elements(doc->'routes') x)=jsonb_array_length(doc->'routes');
EXCEPTION WHEN OTHERS THEN RETURN false;
END;$$;

CREATE TABLE public.admin_payment_configuration_revisions (
 config_version_id uuid PRIMARY KEY REFERENCES public.config_versions(id),
 schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 source_revision_id uuid REFERENCES public.admin_payment_configuration_revisions(config_version_id),
 document jsonb NOT NULL CHECK((jsonb_typeof(document)='object' AND document->'schemaVersion'='1'::jsonb AND jsonb_typeof(document->'channels')='array' AND jsonb_typeof(document->'routes')='array' AND document-ARRAY['schemaVersion','channels','routes']='{}'::jsonb) IS TRUE),
 document_hash public.sha256_hex NOT NULL CHECK(document_hash=encode(sha256(convert_to(public.canonical_publication_json(document),'UTF8')),'hex')),
 CHECK(public.managed_payment_document_is_safe(document)),
 created_at public.finite_timestamptz NOT NULL
);
CREATE TABLE public.admin_payment_configuration_validations (
 id uuid PRIMARY KEY,schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 config_version_id uuid NOT NULL REFERENCES public.admin_payment_configuration_revisions(config_version_id),
 mode text NOT NULL CHECK(mode IN('PUBLISH','ROLLBACK')),
 expected_publication_id uuid REFERENCES public.payment_config_publications(id),
 validation_hash public.sha256_hex NOT NULL,facts jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id),session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),request_id uuid NOT NULL,correlation_id uuid NOT NULL,
 created_at public.finite_timestamptz NOT NULL,
 CHECK(validation_hash=encode(sha256(convert_to(public.canonical_publication_json(facts),'UTF8')),'hex')),
 CHECK((facts->>'revisionId'=config_version_id::text AND facts->>'mode'=mode AND (facts->>'expectedPublicationId')::uuid IS NOT DISTINCT FROM expected_publication_id) IS TRUE)
);
CREATE TABLE public.admin_payment_configuration_receipts (
 id uuid PRIMARY KEY,schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id),session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 action text NOT NULL CHECK(action IN('SAVE','SUBMIT','APPROVE','PUBLISH','ROLLBACK')),
 idempotency_key public.idempotency_key_value NOT NULL,request_hash public.sha256_hex NOT NULL,
 config_version_id uuid NOT NULL REFERENCES public.admin_payment_configuration_revisions(config_version_id),
 review_id uuid UNIQUE REFERENCES public.payment_provider_config_translation_reviews(id),
 publication_id uuid UNIQUE REFERENCES public.payment_config_publications(id),generation integer NOT NULL CHECK(generation>=0),
 expected_publication_id uuid REFERENCES public.payment_config_publications(id),reason_code text,confirmed boolean NOT NULL,
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),request_id uuid NOT NULL,correlation_id uuid NOT NULL,
 created_at public.finite_timestamptz NOT NULL,
 UNIQUE(actor_id,action,idempotency_key),
 CHECK((action IN('SUBMIT','APPROVE'))=(review_id IS NOT NULL)),
 CHECK((action IN('PUBLISH','ROLLBACK'))=(publication_id IS NOT NULL)),
 CHECK((action IN('PUBLISH','ROLLBACK') AND confirmed AND reason_code ~ '^[A-Z][A-Z0-9_]{1,127}$') OR (action NOT IN('PUBLISH','ROLLBACK') AND NOT confirmed AND reason_code IS NULL))
);
CREATE TABLE public.admin_payment_configuration_activations (
 publication_id uuid NOT NULL REFERENCES public.payment_config_publications(id),
 provider_account_id uuid NOT NULL REFERENCES public.payment_provider_accounts(id),environment text NOT NULL,
 policy_version integer NOT NULL,created_at public.finite_timestamptz NOT NULL,
 PRIMARY KEY(publication_id,provider_account_id),UNIQUE(provider_account_id,environment,policy_version),
 FOREIGN KEY(provider_account_id,environment,policy_version) REFERENCES public.payment_provider_health_policies(provider_account_id,environment,policy_version)
);
CREATE TABLE public.admin_payment_configuration_translation_copies (
 target_translation_id uuid PRIMARY KEY REFERENCES public.payment_provider_config_translations(id),
 source_translation_id uuid NOT NULL REFERENCES public.payment_provider_config_translations(id),
 source_approval_review_id uuid NOT NULL REFERENCES public.payment_provider_config_translation_reviews(id),
 save_receipt_id uuid NOT NULL REFERENCES public.admin_payment_configuration_receipts(id) DEFERRABLE INITIALLY DEFERRED,
 created_at public.finite_timestamptz NOT NULL,
 CHECK(target_translation_id<>source_translation_id)
);

CREATE FUNCTION public.assert_managed_payment_configuration_authority() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.audit_logs%ROWTYPE; required text; expected_action text; command_action text:=to_jsonb(NEW)->>'action'; t public.payment_provider_config_translations%ROWTYPE; r public.payment_provider_config_translation_reviews%ROWTYPE; p public.payment_config_publications%ROWTYPE; v public.config_versions%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.audit_logs WHERE id=NEW.audit_log_id;
 required:=CASE WHEN TG_TABLE_NAME='admin_payment_configuration_validations' THEN 'payments.configure' WHEN command_action='APPROVE' THEN 'payments.review' WHEN command_action IN('PUBLISH','ROLLBACK') THEN 'payments.publish' ELSE 'payments.configure' END;
 IF NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,required,NEW.created_at) OR a.actor_type IS DISTINCT FROM 'ADMIN' OR a.actor_id IS DISTINCT FROM NEW.actor_id OR a.outcome IS DISTINCT FROM 'SUCCEEDED' OR a.request_id IS DISTINCT FROM NEW.request_id OR a.correlation_id IS DISTINCT FROM NEW.correlation_id OR a.created_at IS DISTINCT FROM NEW.created_at THEN
 RAISE EXCEPTION 'managed payment configuration requires exact live authority and audit' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='admin_payment_configuration_validations' THEN
  IF a.action IS DISTINCT FROM 'PAYMENT_CONFIGURATION_VALIDATE' OR a.subject_type IS DISTINCT FROM 'PAYMENT_CONFIGURATION' OR a.subject_id IS DISTINCT FROM NEW.config_version_id OR NEW.facts->>'documentHash' IS DISTINCT FROM (SELECT document_hash FROM public.admin_payment_configuration_revisions WHERE config_version_id=NEW.config_version_id) THEN RAISE EXCEPTION 'validation must bind exact managed revision and audit' USING ERRCODE='23514';END IF;
  IF NEW.expected_publication_id IS DISTINCT FROM (SELECT publication_id FROM public.payment_config_publication_heads WHERE singleton_key) THEN RAISE EXCEPTION 'validation requires current publication head' USING ERRCODE='23514';END IF;
  IF NOT coalesce(NEW.facts->'schemaVersion'='1'::jsonb AND NEW.facts-ARRAY['schemaVersion','revisionId','mode','expectedPublicationId','documentHash','accounts','reviews']='{}'::jsonb AND jsonb_typeof(NEW.facts->'accounts')='array' AND jsonb_typeof(NEW.facts->'reviews')='array',false) THEN RAISE EXCEPTION 'validation evidence has an invalid envelope' USING ERRCODE='23514';END IF;
  IF jsonb_array_length(NEW.facts->'accounts')<>(SELECT count(*) FROM public.payment_provider_configs WHERE config_version_id=NEW.config_version_id) OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(NEW.facts->'accounts') fact WHERE NOT EXISTS(
    SELECT 1 FROM public.payment_provider_accounts account JOIN public.merchant_entities merchant ON merchant.id=account.merchant_entity_id JOIN public.payment_provider_configs config ON config.provider_account_id=account.id AND config.config_version_id=NEW.config_version_id
    WHERE account.id=(fact->>'providerAccountId')::uuid AND account.environment=fact->>'environment' AND account.adapter_key=fact->>'adapterKey' AND account.status=fact->>'accountStatus' AND account.health_status=fact->>'healthStatus' AND merchant.status=fact->>'merchantStatus' AND fact->'deployed'='true'::jsonb AND fact->>'adapterVersion' ~ '^[0-9]+\.[0-9]+\.[0-9]+$' AND jsonb_typeof(fact->'paymentMethods')='array' AND fact-ARRAY['providerAccountId','environment','displayLabel','adapterKey','adapterVersion','paymentMethods','deployed','accountStatus','merchantStatus','healthStatus']='{}'::jsonb
   )) OR (SELECT count(DISTINCT fact->>'providerAccountId') FROM jsonb_array_elements(NEW.facts->'accounts') fact)<>jsonb_array_length(NEW.facts->'accounts') THEN RAISE EXCEPTION 'validation account facts must match current canonical accounts' USING ERRCODE='23514';END IF;
  IF jsonb_array_length(NEW.facts->'reviews')<>(SELECT count(*) FROM public.payment_provider_config_translations WHERE config_version_id=NEW.config_version_id) OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(NEW.facts->'reviews') fact WHERE NOT EXISTS(
    SELECT 1 FROM public.payment_provider_config_translations stored_translation JOIN LATERAL(SELECT * FROM public.payment_provider_config_translation_reviews stored_review WHERE stored_review.provider_config_translation_id=stored_translation.id ORDER BY stored_review.sequence DESC LIMIT 1) stored_review ON true LEFT JOIN public.payment_provider_config_translations en ON en.provider_config_id=stored_translation.provider_config_id AND en.locale='en'
    WHERE stored_translation.config_version_id=NEW.config_version_id AND stored_translation.provider_account_id=(fact->>'providerAccountId')::uuid AND stored_translation.locale=fact->>'locale' AND stored_translation.source_hash=fact->>'sourceHash' AND stored_translation.editor_id=(fact->>'editorId')::uuid AND stored_review.reviewer_id IS NOT DISTINCT FROM (fact->>'reviewerId')::uuid AND fact->>'status'=(CASE WHEN en.source_hash IS DISTINCT FROM stored_translation.translated_from_source_hash THEN 'STALE' ELSE stored_review.status END) AND fact->'canApprove'='false'::jsonb AND fact-ARRAY['providerAccountId','locale','status','sourceHash','editorId','reviewerId','canApprove']='{}'::jsonb
   )) OR (SELECT count(DISTINCT (fact->>'providerAccountId',fact->>'locale')) FROM jsonb_array_elements(NEW.facts->'reviews') fact)<>jsonb_array_length(NEW.facts->'reviews') THEN RAISE EXCEPTION 'validation review facts must match exact current approval evidence' USING ERRCODE='23514';END IF;
  RETURN NULL;
 END IF;
 expected_action:=CASE WHEN NEW.action IN('PUBLISH','ROLLBACK') THEN 'PAYMENT_CONFIG_'||NEW.action ELSE 'PAYMENT_CONFIGURATION_'||NEW.action END;
 IF a.action IS DISTINCT FROM expected_action OR a.subject_type IS DISTINCT FROM (CASE WHEN NEW.action IN('PUBLISH','ROLLBACK') THEN 'PAYMENT_CONFIG_PUBLICATION' ELSE 'PAYMENT_CONFIGURATION' END) OR a.subject_id IS DISTINCT FROM coalesce(NEW.publication_id,NEW.config_version_id) OR a.reason_code IS DISTINCT FROM NEW.reason_code THEN RAISE EXCEPTION 'configuration receipt requires its exact audit action and subject' USING ERRCODE='23514';END IF;
 IF NEW.action='SAVE' THEN
  SELECT * INTO v FROM public.config_versions WHERE id=NEW.config_version_id;
  IF v.created_by IS DISTINCT FROM NEW.actor_id OR v.created_at IS DISTINCT FROM NEW.created_at OR v.lifecycle<>'DRAFT' THEN RAISE EXCEPTION 'save receipt must identify immutable new author draft' USING ERRCODE='23514';END IF;
 ELSIF NEW.action IN('SUBMIT','APPROVE') THEN
  SELECT * INTO r FROM public.payment_provider_config_translation_reviews WHERE id=NEW.review_id;
  SELECT * INTO t FROM public.payment_provider_config_translations WHERE id=r.provider_config_translation_id;
  IF t.config_version_id IS DISTINCT FROM NEW.config_version_id OR r.created_at IS DISTINCT FROM NEW.created_at OR r.status IS DISTINCT FROM (CASE WHEN NEW.action='SUBMIT' THEN 'IN_REVIEW' ELSE 'APPROVED' END) THEN RAISE EXCEPTION 'review receipt requires exact translation event' USING ERRCODE='23514';END IF;
  IF NEW.action='APPROVE' AND (r.reviewer_id IS DISTINCT FROM NEW.actor_id OR NOT EXISTS(SELECT 1 FROM public.admin_content_locale_grants g WHERE g.admin_identity_id=NEW.actor_id AND g.locale=t.locale AND g.revoked_at IS NULL AND g.granted_at<=NEW.created_at)) THEN RAISE EXCEPTION 'payment translation approval requires current scoped independent reviewer' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO p FROM public.payment_config_publications WHERE id=NEW.publication_id;
  IF p.config_version_id IS DISTINCT FROM NEW.config_version_id OR p.action IS DISTINCT FROM NEW.action OR p.replaces_publication_id IS DISTINCT FROM NEW.expected_publication_id OR p.audit_log_id IS DISTINCT FROM NEW.audit_log_id OR p.published_by IS DISTINCT FROM NEW.actor_id OR p.created_at IS DISTINCT FROM NEW.created_at OR NOT EXISTS(SELECT 1 FROM public.admin_payment_configuration_validations proof WHERE proof.config_version_id=NEW.config_version_id AND proof.mode=NEW.action AND proof.expected_publication_id IS NOT DISTINCT FROM NEW.expected_publication_id AND proof.validation_hash=p.manifest_hash) OR NOT EXISTS(SELECT 1 FROM public.payment_config_publication_heads h WHERE h.publication_id=NEW.publication_id AND h.version=NEW.generation) THEN RAISE EXCEPTION 'publication receipt requires exact validation, immutable publication and active head' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER managed_payment_configuration_receipt_authority AFTER INSERT ON public.admin_payment_configuration_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_managed_payment_configuration_authority();
CREATE CONSTRAINT TRIGGER managed_payment_configuration_validation_authority AFTER INSERT ON public.admin_payment_configuration_validations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_managed_payment_configuration_authority();

CREATE FUNCTION public.assert_managed_payment_configuration_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE revision uuid; receipt_action text;
BEGIN
 IF TG_TABLE_NAME='admin_payment_configuration_revisions' THEN revision:=NEW.config_version_id;receipt_action:='SAVE';
 ELSIF TG_TABLE_NAME='payment_config_publications' THEN revision:=NEW.config_version_id;receipt_action:=NEW.action;
 ELSE SELECT config_version_id INTO revision FROM public.payment_provider_config_translations WHERE id=NEW.provider_config_translation_id;receipt_action:=CASE NEW.status WHEN 'IN_REVIEW' THEN 'SUBMIT' WHEN 'APPROVED' THEN 'APPROVE' ELSE NULL END;END IF;
 IF receipt_action IS NULL OR NOT EXISTS(SELECT 1 FROM public.admin_payment_configuration_revisions WHERE config_version_id=revision) THEN RETURN NULL;END IF;
 IF TG_TABLE_NAME='payment_provider_config_translation_reviews' AND EXISTS(SELECT 1 FROM public.admin_payment_configuration_translation_copies WHERE target_translation_id=(to_jsonb(NEW)->>'provider_config_translation_id')::uuid) THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.admin_payment_configuration_receipts r WHERE r.config_version_id=revision AND r.action=receipt_action AND (TG_TABLE_NAME='admin_payment_configuration_revisions' OR (TG_TABLE_NAME='payment_config_publications' AND r.publication_id=(to_jsonb(NEW)->>'id')::uuid) OR (TG_TABLE_NAME='payment_provider_config_translation_reviews' AND r.review_id=(to_jsonb(NEW)->>'id')::uuid))) THEN RAISE EXCEPTION 'managed configuration change requires permanent receipt' USING ERRCODE='23514';END IF;RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER managed_payment_configuration_save_receipt AFTER INSERT ON public.admin_payment_configuration_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_managed_payment_configuration_receipt();
CREATE CONSTRAINT TRIGGER managed_payment_configuration_review_receipt AFTER INSERT ON public.payment_provider_config_translation_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_managed_payment_configuration_receipt();
CREATE CONSTRAINT TRIGGER managed_payment_configuration_publication_receipt AFTER INSERT ON public.payment_config_publications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_managed_payment_configuration_receipt();

CREATE FUNCTION public.guard_managed_payment_configuration_payload() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE revision uuid; data jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
 revision:=(data->>'config_version_id')::uuid;
 IF revision IS NULL THEN SELECT config_version_id INTO revision FROM public.payment_route_rules WHERE id=(data->>'payment_route_rule_id')::uuid;END IF;
 IF EXISTS(SELECT 1 FROM public.admin_payment_configuration_revisions WHERE config_version_id=revision) THEN RAISE EXCEPTION 'managed configuration payload is immutable; save a new revision' USING ERRCODE='55000';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;$$;
CREATE TRIGGER payment_provider_configs_managed_no_append BEFORE INSERT ON public.payment_provider_configs FOR EACH ROW EXECUTE FUNCTION public.guard_managed_payment_configuration_payload();
CREATE TRIGGER payment_provider_config_translations_managed_no_append BEFORE INSERT ON public.payment_provider_config_translations FOR EACH ROW EXECUTE FUNCTION public.guard_managed_payment_configuration_payload();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['payment_provider_configs','payment_provider_config_translations','payment_route_rules','payment_route_rule_countries','payment_route_rule_markets','payment_route_rule_currencies','payment_route_rule_device_capabilities'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_managed_payment_configuration_payload()',name||'_managed_immutable',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['admin_payment_configuration_revisions','admin_payment_configuration_validations','admin_payment_configuration_receipts','admin_payment_configuration_activations','admin_payment_configuration_translation_copies'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_append_only()',name||'_immutable',name);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only()',name||'_no_truncate',name);
 END LOOP;
END;$$;

CREATE FUNCTION public.assert_managed_payment_health_activation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p public.payment_config_publications%ROWTYPE; configured jsonb; policy jsonb;
BEGIN
 SELECT * INTO p FROM public.payment_config_publications WHERE id=NEW.publication_id;
 SELECT channel->'healthPolicy' INTO configured FROM public.admin_payment_configuration_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.document->'channels') channel WHERE r.config_version_id=p.config_version_id AND (channel->>'providerAccountId')::uuid=NEW.provider_account_id;
 SELECT x.policy INTO policy FROM public.payment_provider_health_policies x WHERE x.provider_account_id=NEW.provider_account_id AND x.environment=NEW.environment AND x.policy_version=NEW.policy_version;
 IF configured IS NULL OR configured IS DISTINCT FROM policy-ARRAY['schemaVersion','providerAccountId','environment','version'] OR NEW.created_at IS DISTINCT FROM p.created_at OR NOT EXISTS(SELECT 1 FROM public.admin_payment_configuration_receipts r WHERE r.publication_id=NEW.publication_id) OR NOT EXISTS(SELECT 1 FROM public.payment_provider_health_state s WHERE s.provider_account_id=NEW.provider_account_id AND s.environment=NEW.environment AND s.policy_version=NEW.policy_version) THEN RAISE EXCEPTION 'health activation requires exact published configuration and active policy' USING ERRCODE='23514';END IF;RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER managed_payment_health_activation_guard AFTER INSERT ON public.admin_payment_configuration_activations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_managed_payment_health_activation();
CREATE FUNCTION public.guard_managed_payment_health_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.policy_version<>OLD.policy_version AND NOT EXISTS(SELECT 1 FROM public.admin_payment_configuration_activations x JOIN public.payment_config_publication_heads h ON h.publication_id=x.publication_id WHERE x.provider_account_id=NEW.provider_account_id AND x.environment=NEW.environment AND x.policy_version=NEW.policy_version) THEN RAISE EXCEPTION 'active health policy changes require current publication activation' USING ERRCODE='23514';END IF;
 IF NEW.policy_version<>OLD.policy_version AND (NEW.policy_version<=OLD.policy_version OR NEW.generation<>OLD.generation+1 OR NEW.probe_id IS NOT NULL OR NEW.probe_context IS NOT NULL OR NEW.probe_expires_at IS NOT NULL OR NEW.lease_account_version IS NOT NULL OR NEW.lease_policy_version IS NOT NULL) THEN RAISE EXCEPTION 'policy activation must invalidate old probe lease and advance version' USING ERRCODE='23514';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER managed_payment_health_policy_guard BEFORE UPDATE ON public.payment_provider_health_state FOR EACH ROW EXECUTE FUNCTION public.guard_managed_payment_health_policy();

CREATE FUNCTION public.assert_managed_payment_translation_copy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source public.payment_provider_config_translations%ROWTYPE; target public.payment_provider_config_translations%ROWTYPE; approval public.payment_provider_config_translation_reviews%ROWTYPE; receipt public.admin_payment_configuration_receipts%ROWTYPE; revision public.admin_payment_configuration_revisions%ROWTYPE;
BEGIN
 SELECT * INTO source FROM public.payment_provider_config_translations WHERE id=NEW.source_translation_id;
 SELECT * INTO target FROM public.payment_provider_config_translations WHERE id=NEW.target_translation_id;
 SELECT * INTO approval FROM public.payment_provider_config_translation_reviews WHERE id=NEW.source_approval_review_id;
 SELECT * INTO receipt FROM public.admin_payment_configuration_receipts WHERE id=NEW.save_receipt_id;
 SELECT * INTO revision FROM public.admin_payment_configuration_revisions WHERE config_version_id=target.config_version_id;
 IF source.id IS NULL OR target.id IS NULL OR revision.source_revision_id IS DISTINCT FROM source.config_version_id OR NOT EXISTS(SELECT 1 FROM public.admin_payment_configuration_revisions WHERE config_version_id=source.config_version_id) OR NOT EXISTS(SELECT 1 FROM public.payment_config_publications WHERE config_version_id=source.config_version_id AND created_at<=NEW.created_at) OR receipt.action IS DISTINCT FROM 'SAVE' OR receipt.config_version_id IS DISTINCT FROM target.config_version_id OR receipt.created_at IS DISTINCT FROM NEW.created_at OR approval.provider_config_translation_id IS DISTINCT FROM source.id OR approval.status IS DISTINCT FROM 'APPROVED' OR approval.id IS DISTINCT FROM (SELECT id FROM public.payment_provider_config_translation_reviews WHERE provider_config_translation_id=source.id ORDER BY sequence DESC LIMIT 1) THEN RAISE EXCEPTION 'translation copy requires an exact published source approval and target save receipt' USING ERRCODE='23514';END IF;
 IF (to_jsonb(source)-ARRAY['id','config_version_id','provider_config_id','created_at']) IS DISTINCT FROM (to_jsonb(target)-ARRAY['id','config_version_id','provider_config_id','created_at']) OR NOT EXISTS(SELECT 1 FROM public.payment_provider_config_translations s JOIN public.payment_provider_config_translations t ON t.source_hash=s.source_hash WHERE s.provider_config_id=source.provider_config_id AND s.locale='en' AND t.provider_config_id=target.provider_config_id AND t.locale='en' AND t.source_hash=target.translated_from_source_hash) THEN RAISE EXCEPTION 'translation copy must retain exact text, source lineage, original editor and edit time' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM public.payment_provider_config_translation_reviews WHERE provider_config_translation_id=target.id)<>3 OR EXISTS(SELECT 1 FROM public.payment_provider_config_translation_reviews t LEFT JOIN public.payment_provider_config_translation_reviews s ON s.provider_config_translation_id=source.id AND s.sequence=t.sequence WHERE t.provider_config_translation_id=target.id AND (s.id IS NULL OR (to_jsonb(t)-ARRAY['id','provider_config_translation_id','created_at']) IS DISTINCT FROM (to_jsonb(s)-ARRAY['id','provider_config_translation_id','created_at']))) THEN RAISE EXCEPTION 'translation copy must retain the full historical independent review chain' USING ERRCODE='23514';END IF;
 RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER managed_payment_translation_copy_guard AFTER INSERT ON public.admin_payment_configuration_translation_copies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_managed_payment_translation_copy();

-- A managed document and the routing tables may never describe different behavior.
-- Draft routes are materialized together when validation succeeds. Every later
-- insert still rechecks the entire set at commit, including all explicit scopes.
CREATE FUNCTION public.assert_managed_payment_configuration_canonical() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE revision uuid; doc jsonb; channel jsonb; translation jsonb; route jsonb; stored public.payment_route_rules%ROWTYPE; provider public.payment_provider_configs%ROWTYPE; version bigint; payload jsonb:=to_jsonb(NEW);
BEGIN
 revision:=(payload->>'config_version_id')::uuid;
 IF revision IS NULL THEN SELECT config_version_id INTO revision FROM public.payment_route_rules WHERE id=(payload->>'payment_route_rule_id')::uuid;END IF;
 SELECT r.document,v.version INTO doc,version FROM public.admin_payment_configuration_revisions r JOIN public.config_versions v ON v.id=r.config_version_id WHERE r.config_version_id=revision;
 IF doc IS NULL THEN RETURN NULL;END IF;
 IF (SELECT count(*) FROM public.payment_provider_configs WHERE config_version_id=revision)<>jsonb_array_length(doc->'channels') THEN RAISE EXCEPTION 'managed channel set differs from immutable document' USING ERRCODE='23514';END IF;
 FOR channel IN SELECT value FROM jsonb_array_elements(doc->'channels') LOOP
  SELECT * INTO provider FROM public.payment_provider_configs p WHERE p.config_version_id=revision AND p.provider_account_id=(channel->>'providerAccountId')::uuid;
  IF provider.id IS NULL OR provider.enabled IS DISTINCT FROM (channel->>'enabled')::boolean OR provider.display_order IS DISTINCT FROM (channel->>'displayOrder')::integer OR provider.rollout_basis_points IS DISTINCT FROM (channel->>'rolloutBasisPoints')::integer OR (SELECT count(*) FROM public.payment_provider_config_translations WHERE provider_config_id=provider.id)<>jsonb_array_length(channel->'translations') THEN RAISE EXCEPTION 'managed channel payload differs from immutable document' USING ERRCODE='23514';END IF;
  FOR translation IN SELECT value FROM jsonb_array_elements(channel->'translations') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.payment_provider_config_translations t WHERE t.provider_config_id=provider.id AND t.locale=translation->>'locale' AND t.display_name=translation->>'displayName' AND t.customer_hint=translation->>'customerHint' AND t.source_hash=encode(sha256(convert_to(public.canonical_publication_json(jsonb_build_object('displayName',t.display_name,'customerHint',t.customer_hint)),'UTF8')),'hex') AND (translation->>'translatedFromSourceHash' IS NULL OR t.translated_from_source_hash=translation->>'translatedFromSourceHash')) THEN RAISE EXCEPTION 'managed translation differs from immutable document' USING ERRCODE='23514';END IF;
  END LOOP;
 END LOOP;
 IF TG_TABLE_NAME='admin_payment_configuration_revisions' THEN RETURN NULL;END IF;
 IF (SELECT count(*) FROM public.payment_route_rules WHERE config_version_id=revision)<>jsonb_array_length(doc->'routes') THEN RAISE EXCEPTION 'managed route set differs from immutable document' USING ERRCODE='23514';END IF;
 FOR route IN SELECT value FROM jsonb_array_elements(doc->'routes') LOOP
  SELECT * INTO stored FROM public.payment_route_rules r WHERE r.config_version_id=revision AND r.rule_key=route->>'ruleKey';
  IF stored.id IS NULL OR stored.provider_account_id IS DISTINCT FROM (route->>'providerAccountId')::uuid OR stored.rule_version<>version OR stored.payment_method IS DISTINCT FROM route->>'paymentMethod' OR stored.enabled IS DISTINCT FROM (route->>'enabled')::boolean OR stored.minimum_amount_minor IS DISTINCT FROM (route->>'minimumAmountMinor')::bigint OR stored.maximum_amount_minor IS DISTINCT FROM (route->>'maximumAmountMinor')::bigint OR stored.priority IS DISTINCT FROM (route->>'priority')::integer OR stored.rollout_basis_points IS DISTINCT FROM (route->>'rolloutBasisPoints')::integer THEN RAISE EXCEPTION 'managed route payload differs from immutable document' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM public.payment_route_rule_countries WHERE payment_route_rule_id=stored.id)<>jsonb_array_length(route->'countries') OR EXISTS(SELECT 1 FROM public.payment_route_rule_countries WHERE payment_route_rule_id=stored.id AND NOT(route->'countries' ? country)) OR (SELECT count(*) FROM public.payment_route_rule_markets WHERE payment_route_rule_id=stored.id)<>jsonb_array_length(route->'markets') OR EXISTS(SELECT 1 FROM public.payment_route_rule_markets WHERE payment_route_rule_id=stored.id AND NOT(route->'markets' ? market)) OR (SELECT count(*) FROM public.payment_route_rule_currencies WHERE payment_route_rule_id=stored.id)<>jsonb_array_length(route->'currencies') OR EXISTS(SELECT 1 FROM public.payment_route_rule_currencies WHERE payment_route_rule_id=stored.id AND NOT(route->'currencies' ? currency)) OR (SELECT count(*) FROM public.payment_route_rule_device_capabilities WHERE payment_route_rule_id=stored.id)<>jsonb_array_length(route->'requiredDeviceCapabilities') OR EXISTS(SELECT 1 FROM public.payment_route_rule_device_capabilities WHERE payment_route_rule_id=stored.id AND NOT(route->'requiredDeviceCapabilities' ? capability)) THEN RAISE EXCEPTION 'managed route scopes differ from immutable document' USING ERRCODE='23514';END IF;
 END LOOP;
 IF TG_TABLE_NAME IN('admin_payment_configuration_validations','payment_config_publications') THEN
  IF NOT EXISTS(SELECT 1 FROM public.payment_route_rules r JOIN public.payment_provider_configs c ON c.id=r.provider_config_id WHERE r.config_version_id=revision AND r.enabled AND c.enabled) THEN RAISE EXCEPTION 'managed publication requires enabled route definitions' USING ERRCODE='23514';END IF;
  FOR provider IN SELECT * FROM public.payment_provider_configs WHERE config_version_id=revision AND enabled LOOP
   PERFORM public.assert_payment_provider_translation_package(provider.id);
   IF NOT EXISTS(SELECT 1 FROM public.payment_provider_accounts a JOIN public.merchant_entities m ON m.id=a.merchant_entity_id WHERE a.id=provider.provider_account_id AND a.status IN('ACTIVE','INTERNAL') AND NOT(a.status='INTERNAL' AND a.environment='LIVE') AND a.health_status='HEALTHY' AND m.status='ACTIVE') THEN RAISE EXCEPTION 'managed publication requires currently eligible healthy accounts' USING ERRCODE='23514';END IF;
  END LOOP;
 END IF;
 IF TG_TABLE_NAME='payment_config_publications' AND (SELECT count(*) FROM public.admin_payment_configuration_activations WHERE publication_id=(payload->>'id')::uuid)<>jsonb_array_length(doc->'channels') THEN RAISE EXCEPTION 'managed publication requires every configured health activation' USING ERRCODE='23514';END IF;
 RETURN NULL;
END;$$;
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['admin_payment_configuration_revisions','admin_payment_configuration_validations','payment_config_publications','payment_route_rules','payment_route_rule_countries','payment_route_rule_markets','payment_route_rule_currencies','payment_route_rule_device_capabilities'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_managed_payment_configuration_canonical()',name||'_managed_canonical',name);
 END LOOP;
END;$$;
