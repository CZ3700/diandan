LOCK TABLE public.admin_order_notes,public.admin_order_private_accesses,public.admin_order_private_confirmations,public.admin_order_message_reviews,public.admin_order_operation_receipts,public.admin_order_fulfillment_receipts,public.admin_order_message_locale_grants IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.admin_order_notes) OR EXISTS(SELECT 1 FROM public.admin_order_private_accesses) OR EXISTS(SELECT 1 FROM public.admin_order_message_reviews) OR EXISTS(SELECT 1 FROM public.admin_order_operation_receipts) OR EXISTS(SELECT 1 FROM public.admin_order_fulfillment_receipts) OR EXISTS(SELECT 1 FROM public.admin_order_message_locale_grants) THEN RAISE EXCEPTION 'admin order history cannot be downgraded' USING ERRCODE='55000'; END IF;
END $$;
DROP TRIGGER admin_order_human_review_required ON public.support_intents;
DROP TRIGGER admin_order_admin_event_required ON public.fulfillment_events;
DROP TABLE public.admin_order_operation_receipts,public.admin_order_fulfillment_receipts,public.admin_order_message_reviews,public.admin_order_private_confirmations,public.admin_order_private_accesses,public.admin_order_notes,public.admin_order_message_locale_grants;
DROP FUNCTION public.assert_admin_order_operation(),public.assert_admin_order_fulfillment(),public.assert_admin_order_review(),public.assert_admin_order_confirmation(),public.assert_admin_order_access(),public.guard_admin_order_message_locale();

DROP FUNCTION public.admin_order_authorized(uuid,uuid,text,timestamptz),public.assert_admin_order_receipt_authority(),public.assert_admin_order_note(),public.require_admin_order_human_review(),public.require_admin_order_fulfillment_receipt();
