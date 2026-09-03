SET search_path = public;

DROP TABLE notification_delivery_attempts;
DROP TABLE notification_content_revision_refs;
DROP TABLE notification_deliveries;
DROP TABLE fulfillment_events;
DROP TABLE fulfillments;
DROP TABLE order_access_sessions;
DROP TABLE order_access_tokens;
DROP TABLE order_events;
DROP TABLE policy_acceptances;
DROP TABLE order_items;

DROP TRIGGER inventory_reservations_order_binding_trigger ON inventory_reservations;
ALTER TABLE inventory_reservations
  DROP CONSTRAINT inventory_reservations_locked_order_session_fk,
  DROP CONSTRAINT inventory_reservations_locked_order_required_check;

DROP TRIGGER carts_order_binding_trigger ON carts;
ALTER TABLE carts
  DROP CONSTRAINT carts_locked_order_owner_fk,
  DROP CONSTRAINT carts_locked_order_shape_check,
  DROP COLUMN locked_order_id;

DROP TABLE orders;

DROP FUNCTION validate_notification_delivery_attempt();
DROP FUNCTION assert_notification_attempt_consistency();
DROP FUNCTION validate_notification_content_revision_ref();
DROP FUNCTION guard_notification_delivery_transition();
DROP FUNCTION validate_notification_delivery();
DROP FUNCTION assert_fulfillment_aggregate();
DROP FUNCTION assert_fulfillment_event_head();
DROP FUNCTION validate_fulfillment_event();
DROP FUNCTION validate_fulfillment_owner();
DROP FUNCTION guard_fulfillment_transition();
DROP FUNCTION validate_order_access_session_exchange();
DROP FUNCTION guard_order_access_session_transition();
DROP FUNCTION guard_order_access_token_transition();
DROP FUNCTION assert_order_aggregate();
DROP FUNCTION assert_order_event_head();
DROP FUNCTION validate_order_event();
DROP FUNCTION validate_policy_acceptance();
DROP FUNCTION validate_order_item_snapshot();
DROP FUNCTION guard_reservation_order_binding();
DROP FUNCTION guard_cart_order_binding();
DROP FUNCTION guard_order_transition();
