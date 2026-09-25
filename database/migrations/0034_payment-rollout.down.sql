SET search_path = public;

CREATE OR REPLACE FUNCTION public.assert_payment_runtime_receipt() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.payment_attempts%ROWTYPE; o public.orders%ROWTYPE; operation public.payment_runtime_operations%ROWTYPE; valid boolean;
BEGIN
  SELECT * INTO a FROM public.payment_attempts WHERE id=NEW.attempt_id;
  SELECT * INTO o FROM public.orders WHERE id=a.order_id FOR UPDATE;
  SELECT * INTO operation FROM public.payment_runtime_operations WHERE id=NEW.operation_id;
  SELECT true INTO valid FROM public.carts c JOIN public.checkout_sessions session ON session.id=NEW.checkout_session_id AND session.cart_id=c.id
    JOIN public.payment_route_rules rule ON rule.id=a.route_rule_id AND rule.provider_account_id=a.provider_account_id AND rule.config_version_id=a.config_version_id AND rule.rule_version=a.rule_version AND rule.payment_method=a.payment_method
    JOIN public.payment_provider_configs config ON config.id=rule.provider_config_id AND config.config_version_id=a.config_version_id
    JOIN public.payment_provider_accounts account ON account.id=a.provider_account_id AND account.environment=a.environment
    JOIN public.merchant_entities merchant ON merchant.id=account.merchant_entity_id
    JOIN public.payment_config_publication_heads head ON head.publication_id=NEW.config_publication_id AND head.config_version_id=a.config_version_id AND head.config_version=a.config_version
    WHERE c.id=NEW.cart_id AND c.id=o.cart_id AND c.status='LOCKED' AND c.locked_order_id=o.id AND c.expires_at>NEW.created_at
      AND session.id=o.checkout_session_id AND session.quote_id=o.checkout_quote_id AND session.quote_expires_at>NEW.created_at
      AND session.status IN('READY','PAYMENT_PENDING') AND o.quote_expires_at>NEW.created_at AND o.order_status='PENDING_PAYMENT' AND o.payment_status='PENDING'
      AND o.current_payment_attempt_id=a.id AND o.version=NEW.original_order_version+1
      AND a.status='CREATED' AND a.version=1 AND NOT a.provider_call_started AND a.external_reference IS NULL AND a.created_at=NEW.created_at
      AND a.amount_minor=o.total_amount_minor AND a.currency=o.currency AND a.requested_locale=o.presentation_locale
      AND operation.attempt_id=a.id AND operation.phase='CREATE' AND operation.generation=1 AND operation.created_at=NEW.created_at
      AND operation.request_id=NEW.request_id AND operation.correlation_id=NEW.correlation_id
      AND account.status IN('INTERNAL','ACTIVE') AND account.health_status='HEALTHY' AND merchant.status='ACTIVE'
      AND rule.enabled AND config.enabled AND rule.rollout_basis_points=10000 AND config.rollout_basis_points=10000
      AND a.amount_minor BETWEEN rule.minimum_amount_minor AND rule.maximum_amount_minor
      AND EXISTS(SELECT 1 FROM public.payment_route_rule_countries WHERE payment_route_rule_id=rule.id AND country=NEW.country)
      AND EXISTS(SELECT 1 FROM public.payment_route_rule_markets WHERE payment_route_rule_id=rule.id AND market=o.market)
      AND EXISTS(SELECT 1 FROM public.payment_route_rule_currencies WHERE payment_route_rule_id=rule.id AND currency=o.currency)
      AND NOT EXISTS(SELECT 1 FROM public.payment_route_rule_device_capabilities d WHERE d.payment_route_rule_id=rule.id AND NOT NEW.supported_action_types ? d.capability);
  IF COALESCE(valid,false)=false OR (
    NEW.create_command->>'attemptId'=a.id::text AND NEW.create_command->>'orderId'=a.order_id::text
    AND NEW.create_command->>'merchantReference'=a.id::text AND NEW.create_command->>'providerIdempotencyKey'=a.id::text
    AND NEW.create_command->>'providerAccountId'=a.provider_account_id::text AND NEW.create_command->>'environment'=a.environment
    AND NEW.create_command->>'amountMinor'=a.amount_minor::text AND NEW.create_command->>'currency'=a.currency
    AND NEW.create_command->>'requestedLocale'=a.requested_locale AND NEW.create_command->>'paymentMethod'=a.payment_method
  ) IS NOT TRUE OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.supported_action_types) AS selected(action) WHERE action NOT IN('REDIRECT','PROVIDER_HOSTED_IFRAME','PROVIDER_COMPONENT','QR_CODE'))
    OR (SELECT count(DISTINCT action) FROM jsonb_array_elements_text(NEW.supported_action_types) AS selected(action))<>jsonb_array_length(NEW.supported_action_types) THEN
    RAISE EXCEPTION 'payment create receipt must bind its exact authorized checkout and route' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.order_items item JOIN public.gift_variants variant ON variant.id=item.gift_variant_id JOIN public.support_intents intent ON intent.id=item.support_intent_id
    WHERE item.order_id=o.id AND (intent.status<>'CHECKOUT_LOCKED' OR intent.privacy_state<>'ACTIVE' OR intent.expires_at<=NEW.created_at
      OR (variant.inventory_policy='TRACKED' AND (
        (SELECT count(*) FROM public.inventory_reservations r WHERE r.checkout_session_id=o.checkout_session_id AND r.cart_item_id=item.cart_item_id AND r.status='ACTIVE')<>1
        OR NOT EXISTS(SELECT 1 FROM public.inventory_reservations r WHERE r.checkout_session_id=o.checkout_session_id AND r.checkout_quote_id=o.checkout_quote_id AND r.cart_item_id=item.cart_item_id AND r.gift_variant_id=item.gift_variant_id AND r.locked_order_id=o.id AND r.quantity=item.quantity AND r.status='ACTIVE' AND r.expires_at>NEW.created_at)))
      OR (variant.inventory_policy<>'TRACKED' AND EXISTS(SELECT 1 FROM public.inventory_reservations r WHERE r.checkout_session_id=o.checkout_session_id AND r.cart_item_id=item.cart_item_id))
    )) THEN RAISE EXCEPTION 'new payment requires the exact valid checkout reservations and intents' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END; $$;
DROP FUNCTION public.payment_rollout_bucket_v1(text,uuid,uuid);
