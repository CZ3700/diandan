SET search_path = public;
LOCK TABLE public.notification_runtime_state, public.orders IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.notification_runtime_state) THEN
    RAISE EXCEPTION 'public order number rollback would discard numbers frozen into notification variables' USING ERRCODE = '55000';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.notification_order_snapshot(target_order_id uuid,site_name text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('schemaVersion',1,'siteName',site_name,'publicOrderId',o.public_order_id,
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
ALTER TABLE public.orders DROP COLUMN public_order_no;
DROP FUNCTION public.generate_public_order_no();
