SET search_path=public;
-- Export receipts are audit history; refuse to drop them silently. Messages a broker already revealed stay
-- recorded in admin_order_private_accesses; the restored 0031 check only governs new rows.
LOCK TABLE artist_ledger_exports IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM artist_ledger_exports) THEN
  RAISE EXCEPTION 'artist ledger export history cannot be downgraded' USING ERRCODE='55000';
 END IF;
END $$;
-- Restore the exact 0031 receipt check: private message reads again require order permissions.
CREATE OR REPLACE FUNCTION public.assert_admin_order_receipt_authority() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE required_permission text; intent public.support_intents%ROWTYPE; a public.admin_order_private_accesses%ROWTYPE;
BEGIN
 required_permission:=CASE TG_TABLE_NAME WHEN 'admin_order_notes' THEN 'orders.note'
 WHEN 'admin_order_private_accesses' THEN CASE to_jsonb(NEW)->>'kind' WHEN 'MESSAGE' THEN 'orders.message.read' ELSE 'orders.note' END
 WHEN 'admin_order_message_reviews' THEN 'orders.message.review'
 WHEN 'admin_order_fulfillment_receipts' THEN CASE WHEN to_jsonb(NEW)->>'action' IN('HOLD','RESUME') THEN 'orders.manage' ELSE 'orders.fulfillment' END END;
 IF NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.read',NEW.created_at)
 OR NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,required_permission,NEW.created_at) THEN
 RAISE EXCEPTION 'order receipt requires current canonical session permission' USING ERRCODE='23514'; END IF;
 IF (TG_TABLE_NAME='admin_order_private_accesses' AND to_jsonb(NEW)->>'kind'='MESSAGE') OR TG_TABLE_NAME='admin_order_message_reviews' THEN
  SELECT * INTO intent FROM public.support_intents WHERE id=NEW.support_intent_id;
  IF NOT EXISTS(SELECT 1 FROM public.admin_order_message_locale_grants WHERE admin_identity_id=NEW.actor_id AND locale=NEW.review_locale AND revoked_at IS NULL AND granted_at<=NEW.created_at)
   OR (intent.fan_message_locale<>NEW.review_locale AND NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.message.triage',NEW.created_at)) THEN
   RAISE EXCEPTION 'order message requires explicit language and triage authority' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='admin_order_private_accesses' THEN
  IF NEW.expires_at>(SELECT expires_at FROM public.admin_sessions WHERE id=NEW.session_id) THEN
   RAISE EXCEPTION 'private read may not outlive its session' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END; $$;
DROP TABLE public.artist_ledger_exports;
DROP FUNCTION public.assert_artist_ledger_export();
DROP INDEX public.refund_items_order_item_idx;
DROP INDEX public.order_items_idol_order_idx;
DROP INDEX public.payment_attempts_succeeded_idx;
DELETE FROM role_permissions rp USING permissions p WHERE rp.permission_id=p.id AND p.permission_key IN('ledger.read','ledger.assigned','ledger.messages');
DELETE FROM permissions WHERE permission_key IN('ledger.read','ledger.assigned','ledger.messages');
