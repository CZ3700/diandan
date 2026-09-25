SET search_path = public;

DROP TRIGGER inventory_balance_consistency_trigger ON inventory_balances;

DROP TABLE inventory_ledger;
DROP TABLE inventory_reservations;
DROP TABLE checkout_quote_lines;
DROP TABLE checkout_sessions;
ALTER TABLE support_intents
  DROP CONSTRAINT support_intents_moderation_evidence_fk;
DROP TABLE moderation_evidence;
DROP TABLE idol_fulfillment_profiles;
DROP TABLE customer_contacts;
DROP TABLE support_intents;
DROP TABLE cart_items;
DROP TABLE carts;

DROP FUNCTION assert_cart_support_intent_consistency();
DROP FUNCTION assert_checkout_quote_consistency();
DROP FUNCTION assert_inventory_reservation_ledger_semantics();
DROP FUNCTION assert_inventory_consistency();
DROP FUNCTION guard_inventory_reservation_transition();
DROP FUNCTION guard_customer_contact_transition();
DROP FUNCTION guard_checkout_session_transition();
DROP FUNCTION guard_fulfillment_profile_transition();
DROP FUNCTION validate_support_intent_moderation_evidence();
DROP FUNCTION guard_support_intent_transition();
DROP FUNCTION validate_cart_item_commerce_context();
DROP FUNCTION guard_cart_item_mutation();
DROP FUNCTION guard_cart_transition();
