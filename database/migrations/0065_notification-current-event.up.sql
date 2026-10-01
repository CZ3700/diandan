SET search_path=public;

-- Order fulfillment includes SYSTEM digital delivery. Only canonical notification
-- facts establish a mail stage, even before its delivery row is materialized.
CREATE OR REPLACE FUNCTION public.admin_notification_current_event(target uuid) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 WITH eligible_order AS (
  SELECT id FROM public.orders
  WHERE id=target AND payment_status='PAID' AND dispute_status='NONE'
    AND order_status IN('OPEN','CLOSED')
    AND fulfillment_status IN('PENDING','PREPARING','DELIVERED')
 ), candidates AS (
  SELECT x.id,o.id AS order_id
  FROM eligible_order o JOIN public.outbox_events x
    ON x.event_type='ORDER_PAYMENT_CONFIRMED' AND x.aggregate_type='ORDER' AND x.aggregate_id=o.id
  UNION ALL
  SELECT x.id,o.id AS order_id
  FROM eligible_order o JOIN public.order_items i ON i.order_id=o.id
  JOIN public.fulfillments f ON f.order_item_id=i.id AND f.order_id=o.id
  JOIN public.outbox_events x
    ON x.event_type='FULFILLMENT_STATUS_CHANGED' AND x.aggregate_type='FULFILLMENT' AND x.aggregate_id=f.id
    AND x.secondary_subject_id=o.id AND x.payload_status IN('PREPARING','DELIVERED')
 )
 SELECT authority.event_type
 FROM candidates c CROSS JOIN LATERAL public.notification_source_authority(c.id) authority
 WHERE authority.order_id=c.order_id
 ORDER BY authority.event_rank DESC
 LIMIT 1
$$;
