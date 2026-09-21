SET search_path=public;

-- Strict storage envelopes reject extra provider payload fields even for direct SQL writes.
CREATE FUNCTION public.payment_health_context_is_safe(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(CASE WHEN jsonb_typeof(value)='object' AND jsonb_typeof(value->'command')='object' AND jsonb_typeof(value->'command'->'supportedActionTypes')='array' THEN
  (value-ARRAY['schemaVersion','routeId','configVersion','ruleVersion','command'])='{}'::jsonb
  AND value->'schemaVersion'='1'::jsonb AND jsonb_typeof(value->'routeId')='string' AND (value->>'routeId')::uuid IS NOT NULL
  AND jsonb_typeof(value->'configVersion')='number' AND (value->>'configVersion')::numeric BETWEEN 1 AND 2147483647 AND (value->>'configVersion')::numeric=trunc((value->>'configVersion')::numeric)
  AND jsonb_typeof(value->'ruleVersion')='number' AND (value->>'ruleVersion')::numeric BETWEEN 1 AND 2147483647 AND (value->>'ruleVersion')::numeric=trunc((value->>'ruleVersion')::numeric)
  AND ((value->'command')-ARRAY['schemaVersion','operation','providerAccountId','environment','market','country','currency','amountMinor','requestedLocale','supportedActionTypes'])='{}'::jsonb
  AND value->'command'->'schemaVersion'='1'::jsonb AND value->'command'->>'operation'='GET_CAPABILITIES'
  AND jsonb_typeof(value->'command'->'providerAccountId')='string' AND (value->'command'->>'providerAccountId')::uuid IS NOT NULL
  AND value->'command'->>'environment' IN('TEST','LIVE')
  AND jsonb_typeof(value->'command'->'market')='string' AND (value->'command'->>'market')::public.market_code IS NOT NULL
  AND jsonb_typeof(value->'command'->'country')='string' AND (value->'command'->>'country')::public.country_code IS NOT NULL
  AND jsonb_typeof(value->'command'->'currency')='string' AND (value->'command'->>'currency')::public.currency_code IS NOT NULL
  AND jsonb_typeof(value->'command'->'requestedLocale')='string' AND (value->'command'->>'requestedLocale')::public.supported_locale IS NOT NULL
  AND jsonb_typeof(value->'command'->'amountMinor')='number' AND (value->'command'->>'amountMinor')::numeric BETWEEN 0 AND 9007199254740991 AND (value->'command'->>'amountMinor')::numeric=trunc((value->'command'->>'amountMinor')::numeric)
  AND jsonb_array_length(value->'command'->'supportedActionTypes') BETWEEN 1 AND 5
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'command'->'supportedActionTypes') action WHERE jsonb_typeof(action)<>'string' OR action#>>'{}' NOT IN('REDIRECT','PROVIDER_HOSTED_IFRAME','PROVIDER_COMPONENT','QR_CODE','WAIT'))
  AND (SELECT count(DISTINCT action) FROM jsonb_array_elements(value->'command'->'supportedActionTypes') action)=jsonb_array_length(value->'command'->'supportedActionTypes')
 ELSE false END,false)
$$;


-- Technical observations are separate from immutable route publication and from
-- the original account health/event head. No provider payload is retained.
CREATE TABLE public.payment_provider_health_policies (
 provider_account_id uuid NOT NULL,
 environment text NOT NULL CHECK(environment IN('TEST','LIVE')),
 schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 policy_version integer NOT NULL CHECK(policy_version BETWEEN 1 AND 2147483647),
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),
 policy_hash public.sha256_hex NOT NULL,
 created_at public.finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(provider_account_id,environment) REFERENCES public.payment_provider_accounts(id,environment),
 PRIMARY KEY(provider_account_id,environment,policy_version),
 CHECK(policy_hash=encode(sha256(convert_to(public.canonical_publication_json(policy),'UTF8')),'hex')),
 CHECK((policy->>'schemaVersion'='1' AND policy->>'providerAccountId'=provider_account_id::text AND policy->>'environment'=environment AND policy->>'version'=policy_version::text) IS TRUE),
 CHECK(policy->'schemaVersion'='1'::jsonb AND jsonb_typeof(policy->'version')='number' AND jsonb_typeof(policy->'failureThreshold')='number' AND jsonb_typeof(policy->'failureWindowMs')='number' AND jsonb_typeof(policy->'openDurationMs')='number' AND jsonb_typeof(policy->'probeLeaseMs')='number' AND jsonb_typeof(policy->'probeRetryMs')='number'),
 CHECK((policy-ARRAY['schemaVersion','providerAccountId','environment','version','failureThreshold','failureWindowMs','openDurationMs','probeLeaseMs','probeRetryMs'])='{}'::jsonb),
 CHECK(((policy->>'failureThreshold')::integer BETWEEN 1 AND 100 AND (policy->>'failureWindowMs')::integer BETWEEN 1000 AND 3600000 AND (policy->>'openDurationMs')::integer BETWEEN 1000 AND 86400000 AND (policy->>'probeLeaseMs')::integer BETWEEN 1000 AND 120000 AND (policy->>'probeRetryMs')::integer BETWEEN 1000 AND 86400000) IS TRUE)
);
CREATE TABLE public.payment_provider_health_state (
 provider_account_id uuid PRIMARY KEY,
 policy_version integer NOT NULL,
 environment text NOT NULL CHECK(environment IN('TEST','LIVE')),
 schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count BETWEEN 0 AND 100),
 window_started_at public.finite_timestamptz,
 generation bigint NOT NULL DEFAULT 0 CHECK(generation BETWEEN 0 AND 9007199254740991),
 probe_due_at public.finite_timestamptz,
 probe_context jsonb CHECK(probe_context IS NULL OR public.payment_health_context_is_safe(probe_context)),
 probe_id uuid,
 probe_expires_at public.finite_timestamptz,
 lease_account_version public.positive_version,
 lease_policy_version integer,
 updated_at public.finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(provider_account_id,environment,policy_version) REFERENCES public.payment_provider_health_policies(provider_account_id,environment,policy_version),
 CHECK(probe_context IS NULL OR (probe_context->'command'->>'providerAccountId'=provider_account_id::text AND probe_context->'command'->>'environment'=environment)),
 CHECK((failure_count=0 AND window_started_at IS NULL) OR (failure_count>0 AND window_started_at IS NOT NULL)),
 CHECK((probe_id IS NULL AND probe_expires_at IS NULL AND lease_account_version IS NULL AND lease_policy_version IS NULL) OR (probe_id IS NOT NULL AND probe_expires_at IS NOT NULL AND lease_account_version IS NOT NULL AND lease_policy_version IS NOT NULL AND probe_context IS NOT NULL AND probe_due_at IS NOT NULL AND generation>0))
);
CREATE INDEX payment_provider_health_due ON public.payment_provider_health_state(probe_due_at,provider_account_id) WHERE probe_due_at IS NOT NULL;
CREATE TABLE public.payment_provider_health_observations (
 observation_id uuid PRIMARY KEY,
 policy_version integer NOT NULL,
 schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 provider_account_id uuid NOT NULL,
 environment text NOT NULL CHECK(environment IN('TEST','LIVE')),
 observation jsonb NOT NULL CHECK(jsonb_typeof(observation)='object'),
 observation_hash public.sha256_hex NOT NULL,
 source text NOT NULL DEFAULT 'CALL' CHECK(source IN('CALL','PROBE')),
 probe_generation public.positive_version,
 lease_account_version public.positive_version,
 recorded_at public.finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(provider_account_id,environment,policy_version) REFERENCES public.payment_provider_health_policies(provider_account_id,environment,policy_version),
 CHECK((source='CALL' AND probe_generation IS NULL AND lease_account_version IS NULL) OR (source='PROBE' AND probe_generation IS NOT NULL AND lease_account_version IS NOT NULL AND observation->>'operation'='GET_CAPABILITIES' AND observation->'probeContext'<>'null'::jsonb)),
 CHECK(observation_hash=encode(sha256(convert_to(public.canonical_publication_json(observation),'UTF8')),'hex')),
 CHECK((observation->'schemaVersion'='1'::jsonb AND observation->>'observationId'=observation_id::text AND observation->>'providerAccountId'=provider_account_id::text AND observation->>'environment'=environment) IS TRUE),
 CHECK((observation-ARRAY['schemaVersion','observationId','providerAccountId','environment','operation','classification','code','probeContext'])='{}'::jsonb),
 CHECK((observation->>'operation' IN('GET_CAPABILITIES','CREATE_PAYMENT','GET_PAYMENT','CANCEL_PAYMENT','REFUND_PAYMENT','RECONCILE_PAYMENT','RECONCILE_REFUND') AND observation->>'classification' IN('SUCCESS','TECHNICAL_FAILURE','BUSINESS_OUTCOME','CONFIGURATION_ERROR')) IS TRUE),
 CHECK(CASE observation->>'classification'
  WHEN 'SUCCESS' THEN observation->'code'='null'::jsonb
  WHEN 'TECHNICAL_FAILURE' THEN observation->>'code' IN('RATE_LIMITED','TEMPORARY_UNAVAILABLE','TIMEOUT_OUTCOME_UNKNOWN','MALFORMED_PROVIDER_RESPONSE','UNEXPECTED_ADAPTER_FAILURE')
  WHEN 'BUSINESS_OUTCOME' THEN observation->'code'='null'::jsonb OR observation->>'code' IN('CAPABILITY_UNAVAILABLE','PAYMENT_NOT_FOUND','REFUND_NOT_FOUND','PROVIDER_DECLINED')
  WHEN 'CONFIGURATION_ERROR' THEN observation->>'code' IN('INVALID_COMMAND','IDEMPOTENCY_CONFLICT','INVALID_SIGNATURE','EVENT_OUTSIDE_TOLERANCE','UNSUPPORTED_EVENT','AUTHENTICATION_FAILED','CONFIGURATION_ERROR') ELSE false END IS TRUE),
 CHECK((observation->'probeContext'='null'::jsonb OR (observation->>'operation'='GET_CAPABILITIES' AND public.payment_health_context_is_safe(observation->'probeContext') AND observation->'probeContext'->'command'->>'providerAccountId'=provider_account_id::text AND observation->'probeContext'->'command'->>'environment'=environment)) IS TRUE)
);
CREATE TRIGGER payment_health_policies_immutable BEFORE UPDATE OR DELETE ON public.payment_provider_health_policies FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER payment_health_policies_no_truncate BEFORE TRUNCATE ON public.payment_provider_health_policies FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER payment_health_observations_immutable BEFORE UPDATE OR DELETE ON public.payment_provider_health_observations FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER payment_health_observations_no_truncate BEFORE TRUNCATE ON public.payment_provider_health_observations FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER payment_health_state_no_delete BEFORE DELETE ON public.payment_provider_health_state FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER payment_health_state_no_truncate BEFORE TRUNCATE ON public.payment_provider_health_state FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER payment_health_state_identity BEFORE UPDATE ON public.payment_provider_health_state FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_columns('provider_account_id','environment','schema_version');
