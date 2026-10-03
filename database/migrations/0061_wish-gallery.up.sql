SET search_path=public;
-- Explicit public consent is never inferred from encrypted support-intent personalization.
CREATE FUNCTION public.wish_gallery_preference_valid(visibility text,alias text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN visibility IN('PRIVATE','PUBLIC_ANONYMOUS') THEN alias IS NULL
 WHEN visibility='PUBLIC_NAMED' THEN alias IS NOT NULL AND char_length(alias) BETWEEN 1 AND 40
   AND alias=btrim(alias) AND alias !~ '[[:cntrl:]]' AND alias !~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]'
 ELSE false END
$$;
CREATE TABLE public.cart_wish_gallery_preferences (
 cart_item_id uuid PRIMARY KEY REFERENCES public.cart_items(id) ON DELETE RESTRICT,
 visibility text NOT NULL,
 public_alias text,
 updated_at public.finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(public.wish_gallery_preference_valid(visibility,public_alias))
);
CREATE TABLE public.wish_gallery_consents (
 order_item_id uuid PRIMARY KEY REFERENCES public.wish_purchase_links(order_item_id) ON DELETE RESTRICT,
 visibility text NOT NULL,
 public_alias text,
 created_at public.finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(public.wish_gallery_preference_valid(visibility,public_alias))
);
CREATE TABLE public.wish_gallery_entries (
 entry_id uuid PRIMARY KEY,
 order_item_id uuid NOT NULL UNIQUE REFERENCES public.wish_supports(order_item_id) ON DELETE RESTRICT,
 created_at public.finite_timestamptz NOT NULL,
 FOREIGN KEY(order_item_id) REFERENCES public.wish_gallery_consents(order_item_id) ON DELETE RESTRICT
);
CREATE INDEX wish_gallery_entries_page ON public.wish_gallery_entries(created_at DESC,entry_id DESC);
CREATE TABLE public.wish_gallery_withdrawals (
 entry_id uuid PRIMARY KEY REFERENCES public.wish_gallery_entries(entry_id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.order_access_sessions(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 correlation_id uuid NOT NULL,
 task_name text NOT NULL CHECK(task_name~'^[a-z][a-z0-9]*([-_:][a-z0-9]+)*$' AND char_length(task_name)<=128),
 withdrawn_at public.finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION public.guard_cart_wish_gallery_preference() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.cart_item_id<>OLD.cart_item_id THEN RAISE EXCEPTION 'wish gallery preference identity is immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cart_items i JOIN public.carts c ON c.id=i.cart_id
  JOIN public.wish_bindings w ON w.gift_variant_id=i.gift_variant_id
  JOIN public.support_intents s ON s.cart_item_id=i.id AND s.idol_id=w.idol_id
  WHERE i.id=NEW.cart_item_id AND i.quantity=1 AND c.status='ACTIVE' AND s.status='ACTIVE' AND c.expires_at>clock_timestamp())
 THEN RAISE EXCEPTION 'gallery preference belongs only to an active bound wish cart line' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cart_wish_gallery_preference_guard BEFORE INSERT OR UPDATE ON public.cart_wish_gallery_preferences FOR EACH ROW EXECUTE FUNCTION public.guard_cart_wish_gallery_preference();
CREATE FUNCTION public.guard_wish_gallery_consent() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE link public.wish_purchase_links%ROWTYPE; preference public.cart_wish_gallery_preferences%ROWTYPE;
BEGIN
 SELECT * INTO link FROM public.wish_purchase_links WHERE order_item_id=NEW.order_item_id;
 SELECT * INTO preference FROM public.cart_wish_gallery_preferences WHERE cart_item_id=link.cart_item_id;
 IF link.order_item_id IS NULL OR NEW.visibility<>coalesce(preference.visibility,'PRIVATE') OR NEW.public_alias IS DISTINCT FROM preference.public_alias
 OR NOT EXISTS(SELECT 1 FROM public.order_items i JOIN public.orders o ON o.id=i.order_id
  WHERE i.id=NEW.order_item_id AND i.gift_kind='WISH' AND i.quantity=1 AND o.order_status='PENDING_PAYMENT' AND o.payment_status='UNPAID')
 THEN RAISE EXCEPTION 'wish consent must freeze the exact checkout preference before payment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- Checkout assembles order lines while DRAFT, then transitions the same transaction to PENDING_PAYMENT.
-- Validate the final aggregate at commit, while the cart lock still protects the frozen preference.
CREATE CONSTRAINT TRIGGER wish_gallery_consent_guard AFTER INSERT ON public.wish_gallery_consents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_wish_gallery_consent();
CREATE FUNCTION public.guard_wish_gallery_entry() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.wish_supports s WHERE s.order_item_id=NEW.order_item_id AND s.supported_at=NEW.created_at)
 THEN RAISE EXCEPTION 'gallery history requires the exact unique paid wish support' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wish_gallery_entry_guard BEFORE INSERT ON public.wish_gallery_entries FOR EACH ROW EXECUTE FUNCTION public.guard_wish_gallery_entry();
CREATE FUNCTION public.guard_wish_gallery_withdrawal() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.wish_gallery_entries e JOIN public.order_items i ON i.id=e.order_item_id
  JOIN public.order_access_sessions s ON s.id=NEW.session_id AND s.order_id=i.order_id
  WHERE e.entry_id=NEW.entry_id AND s.status='ACTIVE' AND s.created_at<=clock_timestamp() AND s.expires_at>clock_timestamp()
   AND NEW.withdrawn_at>=e.created_at AND NEW.withdrawn_at<=clock_timestamp())
 THEN RAISE EXCEPTION 'gallery withdrawal requires an active session of the same order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wish_gallery_withdrawal_guard BEFORE INSERT ON public.wish_gallery_withdrawals FOR EACH ROW EXECUTE FUNCTION public.guard_wish_gallery_withdrawal();
CREATE TRIGGER wish_gallery_consents_immutable BEFORE UPDATE OR DELETE ON public.wish_gallery_consents FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER wish_gallery_consents_no_truncate BEFORE TRUNCATE ON public.wish_gallery_consents FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER wish_gallery_entries_immutable BEFORE UPDATE OR DELETE ON public.wish_gallery_entries FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER wish_gallery_entries_no_truncate BEFORE TRUNCATE ON public.wish_gallery_entries FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER wish_gallery_withdrawals_immutable BEFORE UPDATE OR DELETE ON public.wish_gallery_withdrawals FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER wish_gallery_withdrawals_no_truncate BEFORE TRUNCATE ON public.wish_gallery_withdrawals FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
