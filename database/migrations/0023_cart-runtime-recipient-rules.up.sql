SET search_path = public;

-- This is durable structural ownership, not permission to add or check out.
-- Current publication, recipient status, price and stock are revalidated in the
-- same cart transaction; later recipient pauses must not block intent cleanup.
CREATE OR REPLACE FUNCTION public.assert_cart_support_intent_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  item_id uuid := COALESCE(
    (to_jsonb(NEW) ->> 'cart_item_id')::uuid,
    (to_jsonb(OLD) ->> 'cart_item_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid,
    (to_jsonb(OLD) ->> 'id')::uuid
  );
  item_mode text;
  item_has_message boolean;
  intent_mode text;
  intent_has_message boolean;
  is_eligible boolean;
  intent_privacy_state text;
BEGIN
  SELECT display_mode, has_fan_message INTO item_mode, item_has_message
    FROM cart_items WHERE id = item_id;
  SELECT display_mode, fan_message_ciphertext IS NOT NULL, privacy_state
    INTO intent_mode, intent_has_message, intent_privacy_state
    FROM support_intents WHERE cart_item_id = item_id;
  SELECT EXISTS (
    SELECT 1
    FROM cart_items ci
    JOIN support_intents si ON si.cart_item_id = ci.id
    WHERE ci.id = item_id
      AND (EXISTS (
        SELECT 1 FROM gift_variant_idol_eligibility eligibility
        WHERE eligibility.gift_variant_id = ci.gift_variant_id
          AND eligibility.idol_id = si.idol_id
      ) OR EXISTS (
        SELECT 1 FROM gift_variant_recipient_rules eligibility
        WHERE eligibility.gift_variant_id = ci.gift_variant_id
          AND eligibility.rule = 'ALL_ACTIVE_ARTISTS'
      ))
  ) INTO is_eligible;

  IF item_mode IS NULL OR intent_mode IS NULL
     OR item_mode <> intent_mode
     OR (intent_privacy_state <> 'PURGED' AND item_has_message <> intent_has_message)
     OR NOT is_eligible THEN
    RAISE EXCEPTION 'cart item and support intent privacy projection diverge'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- PENDING intentionally has no decision kind; SQL NULL must not enter automated evidence validation.
CREATE OR REPLACE FUNCTION public.validate_support_intent_moderation_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  evidence public.moderation_evidence%ROWTYPE;
  new_decision boolean := TG_OP = 'INSERT';
BEGIN
  IF NEW.moderation_decision_kind IS DISTINCT FROM 'AUTOMATED' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    new_decision :=
      OLD.moderation_status IS DISTINCT FROM NEW.moderation_status
      OR OLD.moderation_reason_code IS DISTINCT FROM NEW.moderation_reason_code
      OR OLD.moderation_decision_kind IS DISTINCT FROM NEW.moderation_decision_kind
      OR OLD.moderation_rule_version IS DISTINCT FROM NEW.moderation_rule_version
      OR OLD.moderation_evidence_id IS DISTINCT FROM NEW.moderation_evidence_id
      OR OLD.reviewed_at IS DISTINCT FROM NEW.reviewed_at;
  END IF;

  SELECT candidate.* INTO evidence
  FROM public.moderation_evidence candidate
  WHERE candidate.id = NEW.moderation_evidence_id
    AND candidate.support_intent_id = NEW.id;

  IF evidence.id IS NULL
     OR evidence.support_intent_version > NEW.version
     OR evidence.rule_version <> NEW.moderation_rule_version
     OR evidence.decision <> NEW.moderation_status
     OR evidence.reason_code IS DISTINCT FROM NEW.moderation_reason_code
     OR evidence.decided_at <> NEW.reviewed_at THEN
    RAISE EXCEPTION 'automated moderation must bind exact immutable evidence'
      USING ERRCODE = '23514';
  END IF;

  IF new_decision AND evidence.support_intent_version <> NEW.version THEN
    RAISE EXCEPTION 'automated moderation evidence must bind the decided support intent version'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW.privacy_state <> 'PURGED' OR new_decision)
     AND (
       NEW.fan_message_ciphertext IS NULL
       OR evidence.content_ciphertext_sha256 <>
          pg_catalog.encode(pg_catalog.sha256(NEW.fan_message_ciphertext), 'hex')
     ) THEN
    RAISE EXCEPTION 'automated moderation evidence must bind the current encrypted message'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;
