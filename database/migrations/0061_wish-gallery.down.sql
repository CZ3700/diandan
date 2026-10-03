SET search_path=public;
LOCK TABLE public.cart_wish_gallery_preferences,public.wish_gallery_consents,public.wish_gallery_entries,public.wish_gallery_withdrawals IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.cart_wish_gallery_preferences) OR EXISTS(SELECT 1 FROM public.wish_gallery_consents)
 OR EXISTS(SELECT 1 FROM public.wish_gallery_entries) OR EXISTS(SELECT 1 FROM public.wish_gallery_withdrawals)
 THEN RAISE EXCEPTION 'wish gallery consent and withdrawal history cannot be downgraded' USING ERRCODE='55000'; END IF;
END $$;
DROP TABLE public.wish_gallery_withdrawals;
DROP TABLE public.wish_gallery_entries;
DROP TABLE public.wish_gallery_consents;
DROP TABLE public.cart_wish_gallery_preferences;
DROP FUNCTION public.guard_wish_gallery_withdrawal();
DROP FUNCTION public.guard_wish_gallery_entry();
DROP FUNCTION public.guard_wish_gallery_consent();
DROP FUNCTION public.guard_cart_wish_gallery_preference();
DROP FUNCTION public.wish_gallery_preference_valid(text,text);
