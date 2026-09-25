-- KMS key versions are opaque, provider-neutral identifiers rather than
-- numeric schema revisions. Existing positive_version values have a lossless
-- decimal text representation that already satisfies the canonical contract.
LOCK TABLE public.payment_attempts, public.webhook_payloads IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.payment_attempts
  ALTER COLUMN action_key_version TYPE text USING action_key_version::text,
  ADD CONSTRAINT payment_attempts_action_key_version_check CHECK (
    action_key_version IS NULL
    OR action_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  );

ALTER TABLE public.webhook_payloads
  ALTER COLUMN encryption_key_version TYPE text USING encryption_key_version::text,
  ADD CONSTRAINT webhook_payloads_encryption_key_version_check CHECK (
    encryption_key_version IS NULL
    OR encryption_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  );
