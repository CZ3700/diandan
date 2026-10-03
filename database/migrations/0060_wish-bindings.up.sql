SET search_path = public;

CREATE TABLE wish_bindings (
 wish_id uuid PRIMARY KEY, gift_id uuid NOT NULL UNIQUE REFERENCES gifts(id),
 gift_variant_id uuid NOT NULL UNIQUE REFERENCES gift_variants(id), idol_id uuid NOT NULL REFERENCES idols(id),
 inventory_location_id uuid NOT NULL REFERENCES inventory_locations(id),
 operation_id uuid NOT NULL UNIQUE REFERENCES management_operations(id),
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE wish_purchase_links (
 order_item_id uuid PRIMARY KEY REFERENCES order_items(id), wish_id uuid NOT NULL REFERENCES wish_bindings(wish_id),
 cart_item_id uuid NOT NULL UNIQUE REFERENCES cart_items(id),
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(wish_id,order_item_id)
);
CREATE TABLE wish_supports (
 wish_id uuid PRIMARY KEY REFERENCES wish_bindings(wish_id), order_item_id uuid NOT NULL UNIQUE,
 provider_event_id uuid NOT NULL REFERENCES provider_events(id),
 supported_at finite_timestamptz NOT NULL,
 FOREIGN KEY(wish_id,order_item_id) REFERENCES wish_purchase_links(wish_id,order_item_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['wish_bindings','wish_purchase_links','wish_supports'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_append_only()',t||'_immutable',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only()',t||'_no_truncate',t);
 END LOOP;
END $$;

CREATE FUNCTION current_gift_kind(gift uuid) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(d.document->>'giftKind',p.gift_kind) FROM gifts g
 LEFT JOIN daily_publication_revisions d ON d.gift_revision_id=g.published_revision_id
 LEFT JOIN gift_revision_profiles p ON p.gift_revision_id=g.published_revision_id AND p.gift_id=g.id WHERE g.id=gift
$$;
-- This is an additional restriction; it never broadens the existing recipient proof.
CREATE FUNCTION wish_recipient_matches(variant uuid,artist uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(CASE WHEN b.wish_id IS NOT NULL THEN b.idol_id=artist AND b.gift_variant_id=v.id
   AND current_gift_kind(v.gift_id)='WISH'
  ELSE current_gift_kind(v.gift_id) IS DISTINCT FROM 'WISH' END,false)
 FROM gift_variants v LEFT JOIN wish_bindings b ON b.gift_id=v.gift_id WHERE v.id=variant
$$;
CREATE FUNCTION wish_recipient_allowed(variant uuid,artist uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(wish_recipient_matches(variant,artist),false)
 AND NOT EXISTS(SELECT 1 FROM wish_bindings b JOIN wish_supports s ON s.wish_id=b.wish_id WHERE b.gift_variant_id=variant)
$$;
CREATE FUNCTION assert_wish_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE o management_operations%ROWTYPE;
BEGIN
 SELECT * INTO o FROM management_operations WHERE id=NEW.operation_id;
 PERFORM assert_management_authority(NEW.operation_id);
 IF o.target_id IS DISTINCT FROM NEW.gift_id OR o.intent->>'kind' IS DISTINCT FROM 'SAVE_GIFT'
  OR o.intent->>'giftKind' IS DISTINCT FROM 'WISH'
  OR o.intent#>>'{eligibility,rule}' IS DISTINCT FROM 'SINGLE_ARTIST'
  OR o.intent#>>'{eligibility,idolId}' IS DISTINCT FROM NEW.idol_id::text
  OR o.intent#>>'{inventory,policy}' IS DISTINCT FROM 'TRACKED'
  OR o.intent#>>'{inventory,locationId}' IS DISTINCT FROM NEW.inventory_location_id::text
  OR (o.intent#>>'{inventory,quantity}')::bigint IS DISTINCT FROM 1
  OR NOT EXISTS(SELECT 1 FROM gift_variants v WHERE v.id=NEW.gift_variant_id AND v.gift_id=NEW.gift_id AND v.inventory_policy='TRACKED')
  OR (SELECT count(*) FROM gift_variants WHERE gift_id=NEW.gift_id)<>1
  OR NOT EXISTS(SELECT 1 FROM idols WHERE id=NEW.idol_id AND status='active' AND accepting_gifts AND published_revision_id IS NOT NULL)
  OR current_gift_kind(NEW.gift_id) IS DISTINCT FROM 'WISH'
  OR NOT EXISTS(SELECT 1 FROM inventory_items i JOIN inventory_balances bal ON bal.inventory_item_id=i.id
    WHERE i.gift_variant_id=NEW.gift_variant_id AND i.policy='TRACKED' AND i.status='ACTIVE'
      AND bal.location_id=NEW.inventory_location_id AND bal.on_hand=1 AND bal.reserved=0)
  OR EXISTS(SELECT 1 FROM inventory_items i JOIN inventory_balances bal ON bal.inventory_item_id=i.id
    WHERE i.gift_variant_id=NEW.gift_variant_id AND bal.location_id<>NEW.inventory_location_id AND (bal.on_hand<>0 OR bal.reserved<>0))
  OR EXISTS(SELECT 1 FROM order_items WHERE gift_id=NEW.gift_id)
  OR EXISTS(SELECT 1 FROM inventory_reservations WHERE gift_variant_id=NEW.gift_variant_id)
 THEN RAISE EXCEPTION 'wish binding requires its exact authorized single artist and unused tracked variant' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER wish_binding_validate AFTER INSERT ON wish_bindings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_wish_binding();

CREATE FUNCTION guard_wish_variant() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b wish_bindings%ROWTYPE;
BEGIN
 SELECT * INTO b FROM wish_bindings WHERE gift_id=NEW.gift_id OR gift_variant_id=NEW.id FOR UPDATE;
 IF b.wish_id IS NOT NULL AND (NEW.id<>b.gift_variant_id OR NEW.gift_id<>b.gift_id OR NEW.inventory_policy<>'TRACKED') THEN
  RAISE EXCEPTION 'wish gift cannot change its bound variant or stock policy' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wish_variant_guard BEFORE INSERT OR UPDATE ON gift_variants FOR EACH ROW EXECUTE FUNCTION guard_wish_variant();

CREATE FUNCTION assert_wish_gift_kind() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM wish_bindings WHERE gift_id=NEW.id) AND current_gift_kind(NEW.id) IS DISTINCT FROM 'WISH' THEN
  RAISE EXCEPTION 'a bound wish cannot change gift kind' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER wish_gift_kind_validate AFTER UPDATE OF published_revision_id ON gifts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_wish_gift_kind();

CREATE FUNCTION guard_wish_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b wish_bindings%ROWTYPE; artist uuid;
BEGIN
 SELECT b0.* INTO b FROM wish_bindings b0 JOIN gift_variants v ON v.gift_id=b0.gift_id WHERE v.id=NEW.gift_variant_id;
 IF b.wish_id IS NOT NULL THEN
  SELECT idol_id INTO artist FROM support_intents WHERE cart_item_id=NEW.cart_item_id;
  IF NEW.gift_variant_id<>b.gift_variant_id OR NEW.location_id<>b.inventory_location_id OR NEW.quantity<>1
   OR NOT wish_recipient_allowed(NEW.gift_variant_id,artist) THEN
   RAISE EXCEPTION 'wish reservation requires its sole available gift and artist' USING ERRCODE='23514'; END IF;
 ELSIF current_gift_kind((SELECT gift_id FROM gift_variants WHERE id=NEW.gift_variant_id))='WISH' THEN
  RAISE EXCEPTION 'unbound wish cannot be reserved' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wish_reservation_guard BEFORE INSERT ON inventory_reservations FOR EACH ROW EXECUTE FUNCTION guard_wish_reservation();

CREATE FUNCTION guard_wish_restock() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b wish_bindings%ROWTYPE;
BEGIN
 -- Reservation, commit, release and expiry already own inventory locks. They never replenish.
 IF NEW.delta_on_hand<=0 THEN RETURN NEW; END IF;
 SELECT w.* INTO b FROM wish_bindings w JOIN inventory_items i ON i.gift_variant_id=w.gift_variant_id WHERE i.id=NEW.inventory_item_id FOR UPDATE OF w;
 IF b.wish_id IS NOT NULL AND
  (NEW.location_id<>b.inventory_location_id OR NEW.delta_on_hand<>1
   OR EXISTS(SELECT 1 FROM inventory_ledger l WHERE l.inventory_item_id=NEW.inventory_item_id AND l.delta_on_hand>0)
   OR EXISTS(SELECT 1 FROM wish_supports s WHERE s.wish_id=b.wish_id)) THEN
  RAISE EXCEPTION 'a wish cannot be replenished or reopened' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wish_restock_guard BEFORE INSERT ON inventory_ledger FOR EACH ROW EXECUTE FUNCTION guard_wish_restock();

CREATE FUNCTION assert_wish_cart_recipient() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item cart_items%ROWTYPE; artist uuid;
BEGIN
 IF TG_TABLE_NAME='cart_items' AND TG_OP='UPDATE' THEN
  IF NEW.quantity=OLD.quantity AND NEW.gift_variant_id=OLD.gift_variant_id THEN RETURN NEW; END IF;
 END IF;
 IF TG_TABLE_NAME='cart_items' THEN SELECT * INTO item FROM cart_items WHERE id=NEW.id;
 ELSE SELECT * INTO item FROM cart_items WHERE id=NEW.cart_item_id; END IF;
 SELECT idol_id INTO artist FROM support_intents WHERE cart_item_id=item.id;
 IF (current_gift_kind((SELECT gift_id FROM gift_variants WHERE id=item.gift_variant_id))='WISH'
   OR EXISTS(SELECT 1 FROM wish_bindings WHERE gift_variant_id=item.gift_variant_id))
  AND (item.quantity<>1 OR NOT coalesce(wish_recipient_allowed(item.gift_variant_id,artist),false)) THEN
  RAISE EXCEPTION 'wish cart line must target its sole available artist' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER wish_cart_validate AFTER INSERT OR UPDATE OF quantity,gift_variant_id ON cart_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_wish_cart_recipient();
CREATE CONSTRAINT TRIGGER wish_intent_validate AFTER INSERT OR UPDATE OF idol_id ON support_intents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_wish_cart_recipient();

CREATE FUNCTION assert_wish_purchase_link() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM order_items i JOIN wish_bindings b ON b.wish_id=NEW.wish_id
   WHERE i.id=NEW.order_item_id AND i.cart_item_id=NEW.cart_item_id AND i.gift_id=b.gift_id AND i.gift_variant_id=b.gift_variant_id
    AND i.idol_id=b.idol_id AND i.quantity=1 AND i.gift_kind='WISH') THEN
  RAISE EXCEPTION 'wish purchase link must bind the exact immutable order line' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER wish_purchase_link_validate AFTER INSERT ON wish_purchase_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_wish_purchase_link();
CREATE FUNCTION assert_wish_order_line() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.gift_kind='WISH' AND NOT EXISTS(SELECT 1 FROM wish_purchase_links l WHERE l.order_item_id=NEW.id) THEN
  RAISE EXCEPTION 'new wish order lines require a purchase binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER wish_order_line_validate AFTER INSERT ON order_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_wish_order_line();

CREATE FUNCTION assert_wish_support() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM 1 FROM wish_bindings WHERE wish_id=NEW.wish_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM wish_purchase_links l JOIN wish_bindings b ON b.wish_id=l.wish_id JOIN order_items i ON i.id=l.order_item_id JOIN orders o ON o.id=i.order_id
   JOIN payment_attempts a ON a.id=o.current_payment_attempt_id AND a.order_id=o.id
   JOIN provider_events e ON e.id=NEW.provider_event_id AND e.id=a.provider_event_id
   JOIN inventory_reservations r ON r.cart_item_id=i.cart_item_id AND r.locked_order_id=o.id
   WHERE l.wish_id=NEW.wish_id AND l.order_item_id=NEW.order_item_id AND a.status='SUCCEEDED'
    AND e.normalized_status='SUCCEEDED' AND e.provider_transaction_type='CAPTURE'
    AND e.evidence_kind IN('VERIFIED_WEBHOOK','AUTHENTICATED_RECONCILE') AND r.status='COMMITTED' AND r.quantity=1 AND r.gift_variant_id=b.gift_variant_id AND r.location_id=b.inventory_location_id
    AND o.payment_status IN('PAID','PARTIALLY_REFUNDED','REFUNDED')) THEN
  RAISE EXCEPTION 'wish support requires committed stock and trusted captured payment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER wish_support_validate AFTER INSERT ON wish_supports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_wish_support();
