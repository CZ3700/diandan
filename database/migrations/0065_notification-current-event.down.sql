SET search_path=public;
LOCK TABLE audit_logs,admin_notification_resends IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 -- Conservatively retain all resend history, including older studio orders:
 -- aggregate-based stages cannot safely continue every dispatch accepted here.
 IF EXISTS(SELECT 1 FROM admin_notification_resends)
   OR EXISTS(SELECT 1 FROM audit_logs WHERE action='RESEND_ORDER_NOTIFICATION' OR task_name='admin-order-resend') THEN
  RAISE EXCEPTION 'notification resend history cannot be downgraded to aggregate-based stages' USING ERRCODE='55000';
 END IF;
END $$;

-- Restore the exact 0032 definition only when no resend history is retained.
CREATE OR REPLACE FUNCTION public.admin_notification_current_event(target uuid) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE fulfillment_status WHEN 'PENDING' THEN 'PAYMENT_CONFIRMED' WHEN 'PREPARING' THEN 'PREPARING' WHEN 'DELIVERED' THEN 'DELIVERED' END
 FROM public.orders WHERE id=target AND payment_status='PAID' AND dispute_status='NONE' AND order_status IN('OPEN','CLOSED')
$$;
