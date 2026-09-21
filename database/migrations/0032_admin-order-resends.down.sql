LOCK TABLE public.admin_notification_resends,public.admin_notification_resend_outbox,public.admin_notification_resend_attempts,public.admin_notification_resend_contact_access IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.admin_notification_resends) OR EXISTS(SELECT 1 FROM public.audit_logs WHERE action='RESEND_ORDER_NOTIFICATION') THEN
  RAISE EXCEPTION 'notification resend history cannot be discarded' USING ERRCODE='55000'; END IF;
END $$;
DROP TABLE public.admin_notification_resend_contact_access;
DROP FUNCTION public.guard_admin_notification_contact_access();
DROP TABLE public.admin_notification_resend_outbox;
DROP TABLE public.admin_notification_resend_attempts;
DROP TABLE public.admin_notification_resends;
DROP FUNCTION public.assert_admin_notification_resend();
DROP FUNCTION public.guard_admin_notification_resend();
DROP FUNCTION public.admin_notification_current_event(uuid);
