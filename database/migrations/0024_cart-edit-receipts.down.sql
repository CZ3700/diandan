SET search_path = public;
LOCK TABLE public.cart_item_mutation_receipts, public.cart_edit_outbox_events, public.cart_private_access_receipts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.cart_item_mutation_receipts)
    OR EXISTS (SELECT 1 FROM public.cart_private_access_receipts)
    OR EXISTS (SELECT 1 FROM public.cart_edit_outbox_events) THEN
    RAISE EXCEPTION 'cart edit rollback would discard mutation or private access evidence' USING ERRCODE = '55000';
  END IF;
END $$;
DROP TABLE public.cart_private_access_receipts;
DROP TABLE public.cart_edit_outbox_events;
DROP TABLE public.cart_item_mutation_receipts;
DROP FUNCTION public.assert_cart_private_access();
DROP FUNCTION public.assert_cart_edit_event();
DROP FUNCTION public.assert_cart_mutation_head();
DROP FUNCTION public.assert_cart_mutation_prior();
DROP FUNCTION public.cart_private_material_hash(bytea,text,bytea,bytea,text,text);
