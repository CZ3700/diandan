SET search_path = public;
LOCK TABLE public.fulfillment_proof_withdrawals, public.fulfillment_proofs, public.fulfillment_proof_uploads, public.admin_order_operation_receipts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.fulfillment_proof_uploads) OR EXISTS(SELECT 1 FROM public.fulfillment_proofs)
   OR EXISTS(SELECT 1 FROM public.fulfillment_proof_withdrawals) THEN
    RAISE EXCEPTION 'delivery proof rollback would discard delivery evidence' USING ERRCODE = '55000';
  END IF;
END $$;
DROP TABLE public.fulfillment_proof_withdrawals;
DROP TABLE public.fulfillment_proofs;
DROP TABLE public.fulfillment_proof_uploads;
DROP FUNCTION public.assert_fulfillment_proof_withdrawal();
DROP FUNCTION public.assert_fulfillment_proof();
DROP FUNCTION public.assert_fulfillment_proof_upload();
DROP FUNCTION public.guard_fulfillment_proof_upload();
CREATE OR REPLACE FUNCTION public.assert_admin_order_operation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.audit_logs%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.audit_logs WHERE id=NEW.audit_log_id;
 IF a.actor_type IS DISTINCT FROM 'ADMIN' OR a.actor_id IS DISTINCT FROM NEW.actor_id OR a.outcome IS DISTINCT FROM 'SUCCEEDED' OR a.created_at IS DISTINCT FROM NEW.created_at OR a.request_id IS DISTINCT FROM NEW.request_id OR a.correlation_id IS DISTINCT FROM NEW.correlation_id OR NOT EXISTS(SELECT 1 FROM public.admin_sessions WHERE id=NEW.session_id AND admin_identity_id=NEW.actor_id) THEN RAISE EXCEPTION 'order operation receipt requires exact authority' USING ERRCODE='23514'; END IF;
 IF NOT(CASE NEW.action WHEN 'ADD_NOTE' THEN EXISTS(SELECT 1 FROM public.admin_order_notes r WHERE r.id=NEW.result_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.audit_log_id=NEW.audit_log_id AND r.created_at=NEW.created_at)
 WHEN 'REVIEW_MESSAGE' THEN EXISTS(SELECT 1 FROM public.admin_order_message_reviews r WHERE r.id=NEW.result_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.audit_log_id=NEW.audit_log_id AND r.created_at=NEW.created_at)
 ELSE EXISTS(SELECT 1 FROM public.admin_order_fulfillment_receipts r WHERE r.id=NEW.result_id AND r.order_id=NEW.order_id AND r.actor_id=NEW.actor_id AND r.session_id=NEW.session_id AND r.action=NEW.action AND r.audit_log_id=NEW.audit_log_id AND r.created_at=NEW.created_at) END) THEN RAISE EXCEPTION 'order operation receipt result must be exact' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
ALTER TABLE public.admin_order_operation_receipts
  DROP CONSTRAINT admin_order_operation_receipts_action_check,
  ADD CONSTRAINT admin_order_operation_receipts_action_check
    CHECK (action IN ('REVIEW_MESSAGE','PREPARE','DELIVER','HOLD','RESUME','ADD_NOTE'));
