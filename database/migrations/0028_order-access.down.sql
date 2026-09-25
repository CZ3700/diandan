SET search_path = public;
LOCK TABLE public.order_access_audits, public.order_access_rate_limits IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.order_access_audits)
    OR EXISTS (SELECT 1 FROM public.order_access_rate_limits) THEN
    RAISE EXCEPTION 'order access rollback would discard audit or active rate-limit history' USING ERRCODE = '55000';
  END IF;
END $$;
DROP TABLE public.order_access_audits;
DROP FUNCTION public.validate_order_access_audit_scope();
DROP TABLE public.order_access_rate_limits;
