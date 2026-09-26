SET search_path = public;
-- V2 plan §4-4 / SPEC §5.8: every order carries an immutable, non-sequential public number
-- (FS- plus six Crockford base32 characters) that fans and support read out; the UUID stays internal.

-- The single generator for backfill, checkout writes and direct fixtures. Each character takes the low
-- five bits of a strong random byte; a committed collision is retried here, a concurrent identical draw
-- fails the unique constraint and the whole checkout transaction is retried by the caller.
CREATE FUNCTION public.generate_public_order_no()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  entropy bytea;
  candidate text;
BEGIN
  FOR attempt IN 1..16 LOOP
    entropy := uuid_send(gen_random_uuid());
    candidate := 'FS-';
    FOR position IN 0..5 LOOP
      candidate := candidate || substr(alphabet, (get_byte(entropy, position) & 31) + 1, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE public_order_no = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'public order number space exhausted' USING ERRCODE = '23505';
END;
$$;

ALTER TABLE public.orders
  ADD COLUMN public_order_no text,
  ADD CONSTRAINT orders_public_order_no_format_check CHECK (public_order_no ~ '^FS-[0-9A-HJKMNP-TV-Z]{6}$'),
  ADD CONSTRAINT orders_public_order_no_unique UNIQUE (public_order_no);
COMMENT ON COLUMN public.orders.public_order_no IS 'Fan-facing order number (FS- + 6 Crockford base32); immutable identity, never sufficient to read an order.';

-- Backfill one row per statement so each draw sees the numbers already assigned. The order guards are
-- suspended for this single schema evolution: identity immutability would reject it, and the deferred
-- event-head and aggregate checks do not read the new column.
ALTER TABLE public.orders DISABLE TRIGGER USER;
DO $$
DECLARE
  target uuid;
BEGIN
  FOR target IN SELECT id FROM public.orders WHERE public_order_no IS NULL ORDER BY created_at, id LOOP
    UPDATE public.orders SET public_order_no = public.generate_public_order_no() WHERE id = target;
  END LOOP;
END $$;
ALTER TABLE public.orders ENABLE TRIGGER USER;

-- From here guard_order_transition treats the column as immutable identity (it diffs every other column).
ALTER TABLE public.orders
  ALTER COLUMN public_order_no SET DEFAULT public.generate_public_order_no(),
  ALTER COLUMN public_order_no SET NOT NULL;

-- Notification variables carry the public number the e-mail shows.
CREATE OR REPLACE FUNCTION public.notification_order_snapshot(target_order_id uuid,site_name text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('schemaVersion',1,'siteName',site_name,'publicOrderId',o.public_order_id,
    'publicOrderNo',o.public_order_no,
    'orderedAt',to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'currency',o.currency,'totalMinor',o.total_amount_minor,'items',(
      SELECT jsonb_agg(jsonb_build_object('idolName',i.idol_display_name,'idolLocale',i.idol_translation_resolved_locale,
        'giftName',i.gift_title,'giftLocale',i.gift_translation_resolved_locale,
        'variantName',CASE WHEN i.schema_version=1 THEN NULL ELSE original.line->>'giftVariantLabel' END,
        'variantLocale',CASE WHEN i.schema_version=1 THEN NULL ELSE i.gift_translation_resolved_locale END,
        'quantity',i.quantity,'lineTotalMinor',i.line_total_minor,'giftKind',i.gift_kind) ORDER BY i.created_at,i.id)
      FROM public.order_items i LEFT JOIN public.checkout_preflight_observations observation ON observation.id=i.checkout_preflight_id
      LEFT JOIN LATERAL(SELECT line FROM jsonb_array_elements(observation.observation#>'{consent,lines}') line
        WHERE (line->>'cartItemId')::uuid=i.cart_item_id) original ON true WHERE i.order_id=o.id))
  FROM public.orders o WHERE o.id=target_order_id
$$;

-- Frozen rendering variables must equal the snapshot function byte for byte; pre-production rows are re-frozen once.
ALTER TABLE public.notification_runtime_state DISABLE TRIGGER notification_runtime_immutable;
UPDATE public.notification_runtime_state r SET base_variables = public.notification_order_snapshot(d.order_id, r.base_variables->>'siteName')
  FROM public.notification_deliveries d WHERE d.id = r.notification_delivery_id;
ALTER TABLE public.notification_runtime_state ENABLE TRIGGER notification_runtime_immutable;
