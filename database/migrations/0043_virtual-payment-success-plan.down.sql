SET search_path = public;
-- Restore the 0005 text of assert_payment_success_aggregate_plan verbatim.
CREATE OR REPLACE FUNCTION assert_payment_success_aggregate_plan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  aggregate_count integer;
  tracked_item_count integer;
  current_reservation_count integer;
  invalid_reservation_count integer;
  extraneous_reservation_count integer;
  unavailable_reservation_count integer;
  fulfillment_count integer;
  invalid_fulfillment_count integer;
BEGIN
  IF NEW.status <> 'SUCCEEDED' OR (TG_OP = 'UPDATE' AND OLD.status = 'SUCCEEDED') THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO aggregate_count
    FROM orders order_row
    JOIN carts cart ON cart.id = order_row.cart_id
    JOIN order_events order_event
      ON order_event.order_id = order_row.id
      AND order_event.sequence = order_row.version
    WHERE order_row.id = NEW.order_id
      AND order_row.current_payment_attempt_id = NEW.id
      AND order_row.order_status = 'OPEN'
      AND order_row.payment_status = 'PAID'
      AND cart.locked_order_id = order_row.id
      AND cart.status = 'CONVERTED'
      AND (
        (order_event.from_order_status = 'PENDING_PAYMENT'
          AND order_event.event_type = 'PAYMENT_STATUS_CHANGED')
        OR (order_event.from_order_status = 'CANCELED'
          AND order_event.event_type = 'LATE_PAYMENT_RECOVERED')
      )
      AND order_event.authority_kind = 'PROVIDER_EVIDENCE'
      AND order_event.provider_event_id = NEW.provider_event_id
      AND order_event.to_payment_attempt_id = NEW.id
      AND order_event.to_order_status = 'OPEN'
      AND order_event.to_payment_status = 'PAID';

  SELECT
    count(*) FILTER (WHERE variant.inventory_policy = 'TRACKED'),
    count(current_reservation.id) FILTER (WHERE variant.inventory_policy = 'TRACKED'),
    count(*) FILTER (
      WHERE (variant.inventory_policy = 'TRACKED' AND (
        current_reservation.id IS NULL
        OR current_reservation.gift_variant_id <> item.gift_variant_id
        OR current_reservation.quantity <> item.quantity
        OR current_reservation.checkout_session_id <> source_order.checkout_session_id
        OR current_reservation.checkout_quote_id <> source_order.checkout_quote_id
        OR current_reservation.status = 'ACTIVE'
        OR (OLD.status = 'UNKNOWN'
          AND current_reservation.status NOT IN ('COMMITTED', 'RELEASED', 'EXPIRED'))
        OR (OLD.status <> 'UNKNOWN' AND current_reservation.status <> 'COMMITTED')
      ))
      OR (variant.inventory_policy <> 'TRACKED' AND current_reservation.id IS NOT NULL)
    ),
    count(*) FILTER (WHERE current_reservation.status IN ('RELEASED', 'EXPIRED'))
    INTO tracked_item_count, current_reservation_count,
      invalid_reservation_count, unavailable_reservation_count
    FROM public.order_items item
    JOIN public.orders source_order ON source_order.id = item.order_id
    JOIN public.gift_variants variant ON variant.id = item.gift_variant_id
    LEFT JOIN LATERAL (
      SELECT reservation.*
      FROM public.inventory_reservations reservation
      WHERE reservation.locked_order_id = item.order_id
        AND reservation.cart_item_id = item.cart_item_id
      ORDER BY reservation.created_at DESC, reservation.id DESC
      LIMIT 1
    ) current_reservation ON true
    WHERE item.order_id = NEW.order_id;

  SELECT count(*) INTO extraneous_reservation_count
  FROM public.inventory_reservations reservation
  WHERE reservation.locked_order_id = NEW.order_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.order_items item
      JOIN public.gift_variants variant ON variant.id = item.gift_variant_id
      WHERE item.order_id = NEW.order_id
        AND item.cart_item_id = reservation.cart_item_id
        AND variant.inventory_policy = 'TRACKED'
    );

  IF current_reservation_count <> tracked_item_count
     OR invalid_reservation_count <> 0
     OR extraneous_reservation_count <> 0 THEN
    RAISE EXCEPTION 'tracked order-item reservation coverage is incomplete'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*),
    count(*) FILTER (WHERE status <>
      CASE WHEN unavailable_reservation_count > 0 THEN 'ON_HOLD' ELSE 'PENDING' END)
    INTO fulfillment_count, invalid_fulfillment_count
    FROM fulfillments
    WHERE order_id = NEW.order_id;

  IF aggregate_count <> 1
     OR fulfillment_count = 0
     OR invalid_fulfillment_count <> 0
     OR EXISTS (
       SELECT 1 FROM payment_attempts competing
       WHERE competing.order_id = NEW.order_id
         AND competing.id <> NEW.id
         AND competing.status IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED')
     )
     OR (OLD.status = 'UNKNOWN' AND NOT EXISTS (
       SELECT 1
       FROM audit_logs audit
       JOIN payment_attempt_events payment_event
         ON payment_event.payment_attempt_id = NEW.id
        AND payment_event.sequence = NEW.version
        AND payment_event.from_status = 'UNKNOWN'
        AND payment_event.to_status = 'SUCCEEDED'
        AND payment_event.provider_event_id = NEW.provider_event_id
       JOIN orders audit_order ON audit_order.id = NEW.order_id
       JOIN order_events audit_order_event
         ON audit_order_event.order_id = audit_order.id
        AND audit_order_event.sequence = audit_order.version
        AND audit_order_event.provider_event_id = NEW.provider_event_id
       WHERE audit.action = 'LATE_PAYMENT_SUCCESS_APPLIED'
         AND audit.subject_type = 'PAYMENT_ATTEMPT'
         AND audit.subject_id = NEW.id
         AND audit.reason_code = CASE WHEN unavailable_reservation_count > 0
           THEN 'LATE_PAYMENT_INVENTORY_UNAVAILABLE'
           ELSE 'PAYMENT_SUCCESS_RECONCILED'
         END
         AND audit.outcome = 'SUCCEEDED'
         AND (
           (audit.actor_type = 'ADMIN' AND audit.actor_id IS NOT NULL
             AND audit.task_name IS NULL)
           OR (audit.actor_type = 'SYSTEM' AND audit.actor_id IS NULL
             AND audit.task_name IS NOT NULL)
         )
         AND audit.request_id = payment_event.request_id
         AND audit.correlation_id = payment_event.correlation_id
         AND audit.request_id = audit_order_event.request_id
         AND audit.correlation_id = audit_order_event.correlation_id
         AND audit.created_at = payment_event.occurred_at
         AND audit.created_at = audit_order_event.occurred_at
         AND audit.created_at = transaction_timestamp()
         AND payment_event.occurred_at = transaction_timestamp()
         AND audit_order_event.occurred_at = transaction_timestamp()
     )) THEN
    RAISE EXCEPTION 'payment success aggregate plan is incomplete'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
