LOCK TABLE public.payment_provider_health_policies,public.payment_provider_health_state,public.payment_provider_health_observations IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.payment_provider_health_policies) OR EXISTS(SELECT 1 FROM public.payment_provider_health_observations) THEN
  RAISE EXCEPTION 'payment health policy and observation history cannot be discarded' USING ERRCODE='55000';
 END IF;
END $$;
DROP TABLE public.payment_provider_health_observations;
DROP TABLE public.payment_provider_health_state;
DROP TABLE public.payment_provider_health_policies;
DROP FUNCTION public.payment_health_context_is_safe(jsonb);
