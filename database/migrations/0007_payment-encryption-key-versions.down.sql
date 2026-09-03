-- Downgrading is lossless only while every key version still has the exact
-- canonical decimal representation accepted by positive_version. Refuse the
-- entire transactional migration before changing either table otherwise.
LOCK TABLE public.payment_attempts, public.webhook_payloads IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.payment_attempts
    WHERE action_key_version IS NOT NULL
      AND NOT CASE
        WHEN action_key_version ~ '^[1-9][0-9]{0,15}$'
          THEN action_key_version::numeric BETWEEN 1 AND 9007199254740991
        ELSE false
      END
  ) OR EXISTS (
    SELECT 1
    FROM public.webhook_payloads
    WHERE encryption_key_version IS NOT NULL
      AND NOT CASE
        WHEN encryption_key_version ~ '^[1-9][0-9]{0,15}$'
          THEN encryption_key_version::numeric BETWEEN 1 AND 9007199254740991
        ELSE false
      END
  ) THEN
    RAISE EXCEPTION 'migration 0007 cannot be reverted while non-numeric payment encryption key versions exist'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public.payment_attempts
  DROP CONSTRAINT payment_attempts_action_key_version_check,
  ALTER COLUMN action_key_version TYPE public.positive_version
    USING action_key_version::bigint::public.positive_version;

ALTER TABLE public.webhook_payloads
  DROP CONSTRAINT webhook_payloads_encryption_key_version_check,
  ALTER COLUMN encryption_key_version TYPE public.positive_version
    USING encryption_key_version::bigint::public.positive_version;
