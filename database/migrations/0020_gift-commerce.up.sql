-- Gift operations retain the existing content, price publication and inventory histories.
CREATE FUNCTION public.assert_gift_commerce_audit(audit_id uuid, actor uuid, session_id uuid, expected_action text, expected_subject text, subject uuid, request_id uuid, reason text, event_time timestamptz, required_permission text, causal_lower_bound timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.audit_logs%ROWTYPE; s public.admin_sessions%ROWTYPE; identity_status text;
BEGIN
  SELECT * INTO a FROM public.audit_logs WHERE id=audit_id;
  SELECT * INTO s FROM public.admin_sessions WHERE id=session_id FOR SHARE;
  SELECT status INTO identity_status FROM public.admin_identities WHERE id=actor FOR SHARE;
  IF a.id IS NULL OR a.actor_type IS DISTINCT FROM 'ADMIN' OR a.actor_id IS DISTINCT FROM actor
    OR a.action IS DISTINCT FROM expected_action OR a.subject_type IS DISTINCT FROM expected_subject OR a.subject_id IS DISTINCT FROM subject
    OR a.outcome IS DISTINCT FROM 'SUCCEEDED' OR a.field_category IS DISTINCT FROM 'GIFT_COMMERCE'
    OR a.request_id IS DISTINCT FROM request_id OR a.correlation_id IS DISTINCT FROM request_id
    OR a.reason_code IS DISTINCT FROM reason OR a.created_at IS DISTINCT FROM event_time THEN
    RAISE EXCEPTION 'gift commerce requires its exact audit' USING ERRCODE='23514',CONSTRAINT='gift_commerce_audit';
  END IF;
  IF s.id IS NULL OR s.admin_identity_id IS DISTINCT FROM actor OR identity_status IS DISTINCT FROM 'ACTIVE'
    OR NOT s.authenticated_with_mfa OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp()
    OR s.created_at>clock_timestamp() OR event_time<s.created_at OR event_time>=s.expires_at
    OR event_time>GREATEST(clock_timestamp(),transaction_timestamp(),s.created_at,causal_lower_bound) THEN
    RAISE EXCEPTION 'gift commerce requires current MFA authority' USING ERRCODE='23514',CONSTRAINT='gift_commerce_session';
  END IF;
  PERFORM ar.role_id FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id
    JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id
    WHERE ar.admin_identity_id=actor AND p.permission_key=required_permission
      AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()
      AND ar.granted_at<=event_time AND rp.granted_at<=event_time FOR SHARE OF ar,r,rp,p;
  IF NOT FOUND THEN RAISE EXCEPTION 'gift commerce requires current permission' USING ERRCODE='23514',CONSTRAINT='gift_commerce_permission'; END IF;
END; $$;

CREATE FUNCTION public.gift_commerce_variant_policy_locked(variant_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.checkout_quote_lines WHERE gift_variant_id=variant_id)
    OR EXISTS(SELECT 1 FROM public.order_items WHERE gift_variant_id=variant_id)
    OR EXISTS(SELECT 1 FROM public.inventory_reservations WHERE gift_variant_id=variant_id)
    OR EXISTS(SELECT 1 FROM public.inventory_items i JOIN public.inventory_ledger l ON l.inventory_item_id=i.id WHERE i.gift_variant_id=variant_id)
$$;
CREATE FUNCTION public.guard_gift_commerce_trade_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM id FROM public.gift_variants WHERE id=NEW.gift_variant_id FOR SHARE;
  RETURN NEW;
END; $$;
CREATE TRIGGER gift_commerce_quote_lock BEFORE INSERT ON public.checkout_quote_lines FOR EACH ROW EXECUTE FUNCTION public.guard_gift_commerce_trade_reference();
CREATE TRIGGER gift_commerce_order_lock BEFORE INSERT ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.guard_gift_commerce_trade_reference();
CREATE TRIGGER gift_commerce_reservation_lock BEFORE INSERT ON public.inventory_reservations FOR EACH ROW EXECUTE FUNCTION public.guard_gift_commerce_trade_reference();
-- The row being changed is itself the lock shared by new quote/order/reservation references.
CREATE FUNCTION public.guard_gift_commerce_inventory_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF (NEW.sku IS DISTINCT FROM OLD.sku OR NEW.inventory_policy IS DISTINCT FROM OLD.inventory_policy)
    AND public.gift_commerce_variant_policy_locked(OLD.id) THEN
    RAISE EXCEPTION 'traded variant inventory policy and SKU are immutable' USING ERRCODE='23514',CONSTRAINT='gift_variant_policy_locked';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER gift_commerce_variant_policy_guard BEFORE UPDATE ON public.gift_variants FOR EACH ROW EXECUTE FUNCTION public.guard_gift_commerce_inventory_identity();

ALTER TABLE public.price_books ADD COLUMN commerce_proof_version smallint NOT NULL DEFAULT 1 CHECK(commerce_proof_version IN(1,2));
ALTER TABLE public.price_books ALTER COLUMN commerce_proof_version SET DEFAULT 2;
ALTER TABLE public.price_book_publications ADD COLUMN commerce_proof_version smallint NOT NULL DEFAULT 1 CHECK(commerce_proof_version IN(1,2));
ALTER TABLE public.price_book_publications ALTER COLUMN commerce_proof_version SET DEFAULT 2;

CREATE FUNCTION public.gift_commerce_price_payload(book_id uuid,book_revision bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp SET TimeZone='UTC' AS $$
 SELECT jsonb_build_object('schemaVersion',1,'priceBookId',b.id,'revision',b.revision,'market',b.market,'currency',b.currency,
 'validFrom',to_char(b.valid_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'validUntil',CASE WHEN b.valid_until IS NULL THEN NULL ELSE to_char(b.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
 'prices',COALESCE((SELECT jsonb_agg(jsonb_build_object('priceId',p.id,'priceRevision',p.revision,'giftVariantId',p.gift_variant_id,'unitAmountMinor',p.amount_minor,
 'validFrom',to_char(p.valid_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'validUntil',CASE WHEN p.valid_to IS NULL THEN NULL ELSE to_char(p.valid_to AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END) ORDER BY p.gift_variant_id,p.id)
 FROM public.prices p WHERE p.price_book_id=b.id AND p.price_book_revision=b.revision),'[]'::jsonb))
 FROM public.price_books b WHERE b.id=book_id AND b.revision=book_revision
$$;
CREATE FUNCTION public.gift_commerce_price_hash(book_id uuid,book_revision bigint) RETURNS public.sha256_hex
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT encode(sha256(convert_to('fan-support.gift-price-book.v1'||chr(10)||public.canonical_publication_json(public.gift_commerce_price_payload(book_id,book_revision)),'UTF8')),'hex')::public.sha256_hex
$$;

CREATE TABLE public.gift_price_revision_receipts (
 id uuid PRIMARY KEY,schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 price_book_id uuid NOT NULL,revision public.positive_version NOT NULL,
 expected_book_revision bigint NOT NULL CHECK(expected_book_revision BETWEEN 0 AND 9007199254740990),
 expected_head_version bigint NOT NULL CHECK(expected_head_version BETWEEN 0 AND 9007199254740990),
 source_price_book_id uuid,source_revision public.positive_version,source_content_hash public.sha256_hex,
 content_hash public.sha256_hex NOT NULL,
 changed_variant_ids uuid[] NOT NULL CHECK(cardinality(changed_variant_ids) BETWEEN 1 AND 500 AND array_position(changed_variant_ids,NULL) IS NULL),
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id),session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),request_id uuid NOT NULL,reason_code text NOT NULL CHECK(reason_code~'^[A-Z][A-Z0-9_]{0,127}$'),
 command_hash public.sha256_hex NOT NULL,created_at public.finite_timestamptz NOT NULL,
 FOREIGN KEY(price_book_id,revision) REFERENCES public.price_books(id,revision),
 FOREIGN KEY(source_price_book_id,source_revision) REFERENCES public.price_books(id,revision),UNIQUE(price_book_id,revision),
 CHECK((expected_book_revision=0 AND num_nonnulls(source_price_book_id,source_revision,source_content_hash)=0)
 OR(expected_book_revision>0 AND num_nonnulls(source_price_book_id,source_revision,source_content_hash)=3))
);
CREATE TABLE public.gift_price_publication_receipts (
 id uuid PRIMARY KEY,schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 publication_id uuid NOT NULL UNIQUE REFERENCES public.price_book_publications(id) DEFERRABLE INITIALLY DEFERRED,
 action text NOT NULL CHECK(action IN('PUBLISH_PRICE_BOOK','ROLLBACK_PRICE_BOOK')),
 price_book_id uuid NOT NULL,revision public.positive_version NOT NULL,
 expected_head_version bigint NOT NULL CHECK(expected_head_version BETWEEN 0 AND 9007199254740990),result_head_version public.positive_version NOT NULL,
 content_hash public.sha256_hex NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id),session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),request_id uuid NOT NULL,reason_code text NOT NULL CHECK(reason_code~'^[A-Z][A-Z0-9_]{0,127}$'),
 command_hash public.sha256_hex NOT NULL,created_at public.finite_timestamptz NOT NULL,
 FOREIGN KEY(price_book_id,revision) REFERENCES public.price_books(id,revision),CHECK(result_head_version=expected_head_version+1)
);
CREATE FUNCTION public.guard_gift_commerce_price_payload() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b public.price_books%ROWTYPE; book_id uuid; book_revision bigint;
BEGIN
 IF TG_TABLE_NAME='price_books' THEN
   IF TG_OP='INSERT' THEN
     IF NEW.commerce_proof_version<>2 OR NEW.lifecycle<>'DRAFT' THEN RAISE EXCEPTION 'new price book requires managed draft' USING ERRCODE='23514'; END IF;
     RETURN NEW;
   END IF;
   IF NEW.commerce_proof_version IS DISTINCT FROM OLD.commerce_proof_version THEN RAISE EXCEPTION 'price proof version is immutable' USING ERRCODE='55000'; END IF;
   IF EXISTS(SELECT 1 FROM public.gift_price_revision_receipts WHERE (price_book_id=OLD.id AND revision=OLD.revision) OR (source_price_book_id=OLD.id AND source_revision=OLD.revision))
     AND to_jsonb(NEW)-ARRAY['lifecycle','validated_at','published_at','superseded_at','archived_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['lifecycle','validated_at','published_at','superseded_at','archived_at'] THEN
     RAISE EXCEPTION 'authored price payload is sealed' USING ERRCODE='55000';
   END IF;
   RETURN NEW;
 END IF;
 book_id:=COALESCE(NEW.price_book_id,OLD.price_book_id);book_revision:=COALESCE(NEW.price_book_revision,OLD.price_book_revision);
 SELECT * INTO b FROM public.price_books WHERE id=book_id AND revision=book_revision FOR UPDATE;
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.gift_price_revision_receipts WHERE (price_book_id=book_id AND revision=book_revision) OR (source_price_book_id=book_id AND source_revision=book_revision)) THEN
   RAISE EXCEPTION 'sealed price book membership cannot shrink' USING ERRCODE='55000',CONSTRAINT='gift_price_membership_sealed';
 END IF;
 IF TG_OP='INSERT' AND (b.lifecycle<>'DRAFT' OR EXISTS(SELECT 1 FROM public.gift_price_revision_receipts WHERE (price_book_id=book_id AND revision=book_revision) OR (source_price_book_id=book_id AND source_revision=book_revision))) THEN
   RAISE EXCEPTION 'price book membership is sealed' USING ERRCODE='55000',CONSTRAINT='gift_price_membership_sealed';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER gift_commerce_price_book_payload_guard BEFORE INSERT OR UPDATE ON public.price_books FOR EACH ROW EXECUTE FUNCTION public.guard_gift_commerce_price_payload();
CREATE TRIGGER gift_commerce_price_payload_guard BEFORE INSERT OR UPDATE OR DELETE ON public.prices FOR EACH ROW EXECUTE FUNCTION public.guard_gift_commerce_price_payload();

CREATE FUNCTION public.assert_gift_price_revision_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b public.price_books%ROWTYPE; source public.price_books%ROWTYPE; latest bigint; head_version bigint;
BEGIN
 SELECT * INTO b FROM public.price_books WHERE id=NEW.price_book_id AND revision=NEW.revision FOR UPDATE;
 SELECT COALESCE(max(revision),0) INTO latest FROM public.price_books WHERE market_id=b.market_id AND currency=b.currency AND revision<>b.revision;
 SELECT COALESCE((SELECT version FROM public.price_book_publication_heads WHERE market_id=b.market_id AND currency=b.currency),0) INTO head_version;
 IF b.id IS NULL OR b.commerce_proof_version<>2 OR b.created_by IS DISTINCT FROM NEW.actor_id OR b.created_at IS DISTINCT FROM NEW.created_at
   OR NOT EXISTS(SELECT 1 FROM public.markets m WHERE m.id=b.market_id AND (m.default_currency=b.currency OR EXISTS(SELECT 1 FROM public.price_books prior WHERE prior.market_id=b.market_id AND prior.currency=b.currency AND prior.revision<>b.revision)))
   OR b.revision<>NEW.expected_book_revision+1 OR latest<>NEW.expected_book_revision OR head_version<>NEW.expected_head_version
   OR NEW.content_hash IS DISTINCT FROM public.gift_commerce_price_hash(b.id,b.revision)
   OR NOT EXISTS(SELECT 1 FROM public.prices WHERE price_book_id=b.id AND price_book_revision=b.revision)
   OR EXISTS(SELECT 1 FROM public.prices WHERE price_book_id=b.id AND price_book_revision=b.revision AND (valid_from IS DISTINCT FROM b.valid_from OR valid_to IS DISTINCT FROM b.valid_until))
   OR EXISTS(SELECT gift_variant_id FROM public.prices WHERE price_book_id=b.id AND price_book_revision=b.revision GROUP BY gift_variant_id HAVING count(*)<>1)
   OR NEW.changed_variant_ids IS DISTINCT FROM ARRAY(SELECT DISTINCT v FROM unnest(NEW.changed_variant_ids) v ORDER BY v)
   OR EXISTS(SELECT 1 FROM unnest(NEW.changed_variant_ids) v WHERE NOT EXISTS(SELECT 1 FROM public.prices p WHERE p.price_book_id=b.id AND p.price_book_revision=b.revision AND p.gift_variant_id=v)) THEN
   RAISE EXCEPTION 'price revision receipt must bind complete canonical new book' USING ERRCODE='23514',CONSTRAINT='gift_price_revision_receipt';
 END IF;
 IF NEW.source_price_book_id IS NOT NULL THEN
   SELECT * INTO source FROM public.price_books WHERE id=NEW.source_price_book_id AND revision=NEW.source_revision FOR UPDATE;
   IF source.market_id IS DISTINCT FROM b.market_id OR source.currency IS DISTINCT FROM b.currency
     OR NEW.source_content_hash IS DISTINCT FROM public.gift_commerce_price_hash(source.id,source.revision)
     OR EXISTS(SELECT gift_variant_id FROM public.prices WHERE price_book_id=source.id AND price_book_revision=source.revision GROUP BY gift_variant_id HAVING count(*)<>1)
     OR EXISTS(SELECT 1 FROM public.prices p WHERE p.price_book_id=source.id AND p.price_book_revision=source.revision AND (p.valid_from IS DISTINCT FROM source.valid_from OR p.valid_to IS DISTINCT FROM source.valid_until))
     OR EXISTS(SELECT 1 FROM public.prices n LEFT JOIN public.prices p ON p.price_book_id=source.id AND p.price_book_revision=source.revision AND p.gift_variant_id=n.gift_variant_id WHERE n.price_book_id=b.id AND n.price_book_revision=b.revision AND NOT(n.gift_variant_id=ANY(NEW.changed_variant_ids)) AND (p.id IS NULL OR p.amount_minor IS DISTINCT FROM n.amount_minor))
     OR EXISTS(SELECT 1 FROM public.prices p WHERE p.price_book_id=source.id AND p.price_book_revision=source.revision AND NOT EXISTS(SELECT 1 FROM public.prices n WHERE n.price_book_id=b.id AND n.price_book_revision=b.revision AND n.gift_variant_id=p.gift_variant_id)) THEN
     RAISE EXCEPTION 'price revision must preserve complete explicit source' USING ERRCODE='23514',CONSTRAINT='gift_price_source';
   END IF;
 ELSIF EXISTS(SELECT 1 FROM public.prices WHERE price_book_id=b.id AND price_book_revision=b.revision AND NOT(gift_variant_id=ANY(NEW.changed_variant_ids))) THEN
   RAISE EXCEPTION 'initial price revision requires complete declared changes' USING ERRCODE='23514';
 END IF;
 PERFORM public.assert_gift_commerce_audit(NEW.audit_log_id,NEW.actor_id,NEW.session_id,'CREATE_PRICE_REVISION','PRICE_BOOK_REVISION',NEW.id,NEW.request_id,NEW.reason_code,NEW.created_at,'pricing.manage',source.created_at);
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_price_revision_receipt_validate AFTER INSERT ON public.gift_price_revision_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_price_revision_receipt();
CREATE FUNCTION public.assert_gift_price_managed_proof() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='price_books' THEN
   IF NEW.commerce_proof_version=2 AND NOT EXISTS(SELECT 1 FROM public.gift_price_revision_receipts WHERE price_book_id=NEW.id AND revision=NEW.revision) THEN
     RAISE EXCEPTION 'new price book requires receipt' USING ERRCODE='23514'; END IF;
 ELSE
   IF NEW.commerce_proof_version<>2 OR NOT EXISTS(SELECT 1 FROM public.gift_price_publication_receipts WHERE publication_id=NEW.id) THEN
     RAISE EXCEPTION 'new price publication requires managed receipt' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_price_book_managed_proof AFTER INSERT ON public.price_books DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_price_managed_proof();
CREATE CONSTRAINT TRIGGER gift_price_publication_managed_proof AFTER INSERT ON public.price_book_publications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_price_managed_proof();
CREATE FUNCTION public.assert_gift_price_publication_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p public.price_book_publications%ROWTYPE; b public.price_books%ROWTYPE; h public.price_book_publication_heads%ROWTYPE; chain_count bigint; prior_time timestamptz;
BEGIN
 SELECT * INTO p FROM public.price_book_publications WHERE id=NEW.publication_id;
 SELECT * INTO b FROM public.price_books WHERE id=NEW.price_book_id AND revision=NEW.revision FOR UPDATE;
 SELECT * INTO h FROM public.price_book_publication_heads WHERE market_id=b.market_id AND currency=b.currency FOR UPDATE;
 SELECT count(*) INTO chain_count FROM public.price_book_publications WHERE market_id=b.market_id AND currency=b.currency;
 SELECT published_at INTO prior_time FROM public.price_book_publications WHERE id=p.replaces_publication_id;
 IF p.id IS NULL OR p.commerce_proof_version<>2 OR p.action IS DISTINCT FROM (CASE NEW.action WHEN 'PUBLISH_PRICE_BOOK' THEN 'PUBLISH' ELSE 'ROLLBACK' END)
   OR p.price_book_id IS DISTINCT FROM NEW.price_book_id OR p.price_book_revision IS DISTINCT FROM NEW.revision
   OR p.published_by IS DISTINCT FROM NEW.actor_id OR p.audit_log_id IS DISTINCT FROM NEW.audit_log_id OR p.published_at IS DISTINCT FROM NEW.created_at
   OR p.manifest_hash IS DISTINCT FROM NEW.content_hash OR NEW.content_hash IS DISTINCT FROM public.gift_commerce_price_hash(b.id,b.revision)
   OR h.publication_id IS DISTINCT FROM p.id OR h.version IS DISTINCT FROM NEW.result_head_version OR chain_count<>NEW.result_head_version
   OR b.valid_from>clock_timestamp() OR (b.valid_until IS NOT NULL AND b.valid_until<=clock_timestamp())
   OR b.lifecycle IS DISTINCT FROM (CASE NEW.action WHEN 'PUBLISH_PRICE_BOOK' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END) THEN
   RAISE EXCEPTION 'price publication receipt requires exact current chain and content' USING ERRCODE='23514',CONSTRAINT='gift_price_publication_receipt';
 END IF;
 PERFORM public.assert_gift_commerce_audit(NEW.audit_log_id,NEW.actor_id,NEW.session_id,CASE NEW.action WHEN 'PUBLISH_PRICE_BOOK' THEN 'PRICE_BOOK_PUBLISH' ELSE 'PRICE_BOOK_ROLLBACK' END,'PRICE_BOOK_PUBLICATION',p.id,NEW.request_id,NEW.reason_code,NEW.created_at,'pricing.manage',GREATEST(b.created_at,prior_time+interval '1 microsecond'));
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_price_publication_receipt_validate AFTER INSERT ON public.gift_price_publication_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_price_publication_receipt();

CREATE TABLE public.gift_inventory_location_receipts (
 id uuid PRIMARY KEY,schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 inventory_location_id uuid NOT NULL UNIQUE REFERENCES public.inventory_locations(id),
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id),session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),request_id uuid NOT NULL,reason_code text NOT NULL CHECK(reason_code~'^[A-Z][A-Z0-9_]{0,127}$'),
 command_hash public.sha256_hex NOT NULL,created_at public.finite_timestamptz NOT NULL
);
CREATE TABLE public.gift_inventory_adjustment_receipts (
 id uuid PRIMARY KEY,schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 gift_variant_id uuid NOT NULL REFERENCES public.gift_variants(id),inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
 inventory_location_id uuid NOT NULL REFERENCES public.inventory_locations(id),ledger_id uuid NOT NULL UNIQUE REFERENCES public.inventory_ledger(id) DEFERRABLE INITIALLY DEFERRED,
 expected_variant_version public.positive_version NOT NULL,
 expected_balance_version bigint NOT NULL CHECK(expected_balance_version BETWEEN 0 AND 9007199254740990),result_balance_version public.positive_version NOT NULL,
 previous_balance_updated_at public.finite_timestamptz,
 previous_on_hand bigint NOT NULL CHECK(previous_on_hand BETWEEN 0 AND 9007199254740991),previous_reserved bigint NOT NULL CHECK(previous_reserved BETWEEN 0 AND previous_on_hand),
 delta_on_hand bigint NOT NULL CHECK(delta_on_hand BETWEEN -9007199254740991 AND 9007199254740991 AND delta_on_hand<>0),
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id),session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),request_id uuid NOT NULL,reason_code text NOT NULL CHECK(reason_code~'^[A-Z][A-Z0-9_]{0,127}$'),
 command_hash public.sha256_hex NOT NULL,created_at public.finite_timestamptz NOT NULL,
 CHECK((expected_balance_version=0)=(previous_balance_updated_at IS NULL)),
 CHECK(result_balance_version=expected_balance_version+1),CHECK(previous_on_hand::numeric+delta_on_hand BETWEEN previous_reserved AND 9007199254740991),
 CHECK(expected_balance_version<>0 OR(previous_on_hand=0 AND previous_reserved=0 AND delta_on_hand>0)),
 UNIQUE(inventory_item_id,inventory_location_id,result_balance_version)
);
CREATE FUNCTION public.guard_gift_inventory_adjustment_prior() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v public.gift_variants%ROWTYPE; i public.inventory_items%ROWTYPE; b public.inventory_balances%ROWTYPE; location_status text;
BEGIN
 SELECT * INTO v FROM public.gift_variants WHERE id=NEW.gift_variant_id FOR UPDATE;
 SELECT * INTO i FROM public.inventory_items WHERE id=NEW.inventory_item_id FOR UPDATE;
 SELECT status INTO location_status FROM public.inventory_locations WHERE id=NEW.inventory_location_id FOR SHARE;
 SELECT * INTO b FROM public.inventory_balances WHERE inventory_item_id=i.id AND location_id=NEW.inventory_location_id FOR UPDATE;
 IF v.id IS NULL OR v.version IS DISTINCT FROM NEW.expected_variant_version OR v.inventory_policy<>'TRACKED'
   OR i.id IS NULL OR i.gift_variant_id IS DISTINCT FROM v.id OR i.policy<>'TRACKED' OR i.status<>'ACTIVE' OR location_status IS DISTINCT FROM 'ACTIVE'
   OR b.updated_at IS DISTINCT FROM NEW.previous_balance_updated_at
   OR COALESCE(b.version,0)<>NEW.expected_balance_version OR COALESCE(b.on_hand,0)<>NEW.previous_on_hand OR COALESCE(b.reserved,0)<>NEW.previous_reserved THEN
   RAISE EXCEPTION 'inventory receipt requires locked exact previous balance' USING ERRCODE='23514',CONSTRAINT='gift_inventory_prior';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER gift_inventory_adjustment_prior BEFORE INSERT ON public.gift_inventory_adjustment_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_gift_inventory_adjustment_prior();
CREATE FUNCTION public.assert_gift_inventory_adjustment_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l public.inventory_ledger%ROWTYPE; b public.inventory_balances%ROWTYPE; lower_bound timestamptz; variant_time timestamptz;
BEGIN
 SELECT * INTO l FROM public.inventory_ledger WHERE id=NEW.ledger_id;
 SELECT * INTO b FROM public.inventory_balances WHERE inventory_item_id=NEW.inventory_item_id AND location_id=NEW.inventory_location_id FOR UPDATE;
 SELECT updated_at INTO variant_time FROM public.gift_variants WHERE id=NEW.gift_variant_id FOR SHARE;
 SELECT max(occurred_at) INTO lower_bound FROM public.inventory_ledger WHERE inventory_item_id=NEW.inventory_item_id AND location_id=NEW.inventory_location_id AND balance_version_after=NEW.expected_balance_version;
 IF l.id IS NULL OR l.inventory_item_id IS DISTINCT FROM NEW.inventory_item_id OR l.location_id IS DISTINCT FROM NEW.inventory_location_id
   OR l.balance_version_before IS DISTINCT FROM NEW.expected_balance_version OR l.balance_version_after IS DISTINCT FROM NEW.result_balance_version
   OR l.delta_on_hand IS DISTINCT FROM NEW.delta_on_hand OR l.delta_reserved<>0 OR l.reservation_id IS NOT NULL
   OR l.source_type<>'ADJUSTMENT' OR l.source_id IS DISTINCT FROM NEW.id OR l.actor_kind<>'ADMIN' OR l.admin_identity_id IS DISTINCT FROM NEW.actor_id
   OR l.reason_code IS DISTINCT FROM NEW.reason_code OR l.occurred_at IS DISTINCT FROM NEW.created_at
   OR NEW.created_at<GREATEST(lower_bound,NEW.previous_balance_updated_at,variant_time)
   OR b.version IS DISTINCT FROM NEW.result_balance_version OR b.on_hand IS DISTINCT FROM NEW.previous_on_hand+NEW.delta_on_hand OR b.reserved IS DISTINCT FROM NEW.previous_reserved THEN
   RAISE EXCEPTION 'inventory receipt requires exact ledger and final balance' USING ERRCODE='23514',CONSTRAINT='gift_inventory_result';
 END IF;
 PERFORM public.assert_gift_commerce_audit(NEW.audit_log_id,NEW.actor_id,NEW.session_id,'ADJUST_INVENTORY','INVENTORY_ADJUSTMENT',NEW.id,NEW.request_id,NEW.reason_code,NEW.created_at,'inventory.manage',GREATEST(lower_bound,NEW.previous_balance_updated_at,variant_time));
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_inventory_adjustment_validate AFTER INSERT ON public.gift_inventory_adjustment_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_inventory_adjustment_receipt();
CREATE FUNCTION public.assert_gift_inventory_managed_adjustment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.actor_kind='ADMIN' AND NEW.source_type='ADJUSTMENT' AND NOT EXISTS(SELECT 1 FROM public.gift_inventory_adjustment_receipts WHERE ledger_id=NEW.id) THEN
   RAISE EXCEPTION 'administrative adjustment requires a receipt' USING ERRCODE='23514',CONSTRAINT='gift_inventory_managed_adjustment';
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_inventory_managed_adjustment AFTER INSERT ON public.inventory_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_inventory_managed_adjustment();
CREATE FUNCTION public.assert_gift_inventory_location_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l public.inventory_locations%ROWTYPE;
BEGIN
 SELECT * INTO l FROM public.inventory_locations WHERE id=NEW.inventory_location_id;
 IF l.id IS NULL OR l.created_at IS DISTINCT FROM NEW.created_at OR l.status<>'ACTIVE' THEN RAISE EXCEPTION 'inventory location receipt requires exact new location' USING ERRCODE='23514'; END IF;
 PERFORM public.assert_gift_commerce_audit(NEW.audit_log_id,NEW.actor_id,NEW.session_id,'CREATE_INVENTORY_LOCATION','INVENTORY_LOCATION',l.id,NEW.request_id,NEW.reason_code,NEW.created_at,'inventory.manage');
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_inventory_location_validate AFTER INSERT ON public.gift_inventory_location_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_inventory_location_receipt();
CREATE FUNCTION public.assert_gift_inventory_location_managed() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.gift_inventory_location_receipts WHERE inventory_location_id=NEW.id) THEN RAISE EXCEPTION 'new inventory location requires exact receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_inventory_location_managed AFTER INSERT ON public.inventory_locations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_inventory_location_managed();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['gift_price_revision_receipts','gift_price_publication_receipts','gift_inventory_location_receipts','gift_inventory_adjustment_receipts'] LOOP
   EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_append_only()',name||'_append_only',name);
   EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only()',name||'_no_truncate',name);
 END LOOP;
END; $$;

-- Gift identity, variants and revision classification bind their immutable evidence.
ALTER TABLE public.gift_revisions ADD COLUMN profile_version smallint NOT NULL DEFAULT 1 CHECK(profile_version IN(1,2));
ALTER TABLE public.gift_revisions ALTER COLUMN profile_version SET DEFAULT 2;

CREATE TABLE public.gift_identity_receipts (
 id uuid PRIMARY KEY, gift_id uuid NOT NULL REFERENCES public.gifts(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 action text NOT NULL CHECK(action IN('CREATE_GIFT','SET_GIFT_STATUS')),
 expected_base_version bigint NOT NULL CHECK(expected_base_version BETWEEN 0 AND 9007199254740990),
 result_base_version bigint NOT NULL CHECK(result_base_version=expected_base_version+1),
 old_status text, new_status text NOT NULL CHECK(new_status IN('draft','active','paused','archived')),
 handle text NOT NULL CHECK(handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(handle)<=128),
 previous_updated_at public.finite_timestamptz,
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id), session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id), request_id uuid NOT NULL,
 reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{1,127}$'), command_hash text NOT NULL CHECK(command_hash ~ '^[a-f0-9]{64}$'),
 created_at public.finite_timestamptz NOT NULL, UNIQUE(gift_id,result_base_version),
 CHECK((action='CREATE_GIFT' AND expected_base_version=0 AND old_status IS NULL AND new_status='draft' AND previous_updated_at IS NULL)
 OR(action='SET_GIFT_STATUS' AND expected_base_version>0 AND old_status IN('draft','active','paused') AND new_status<>'draft' AND old_status<>new_status AND previous_updated_at IS NOT NULL))
);
CREATE TABLE public.gift_variant_receipts (
 id uuid PRIMARY KEY, gift_id uuid NOT NULL REFERENCES public.gifts(id), gift_variant_id uuid NOT NULL,
 expected_base_version bigint NOT NULL CHECK(expected_base_version BETWEEN 1 AND 9007199254740990),
 expected_variant_version bigint NOT NULL CHECK(expected_variant_version BETWEEN 0 AND 9007199254740990),
 result_variant_version bigint NOT NULL CHECK(result_variant_version=expected_variant_version+1),
 old_sku text, new_sku text NOT NULL CHECK(new_sku ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(new_sku)<=64),
 old_status text, new_status text NOT NULL CHECK(new_status IN('draft','active','paused','archived')),
 old_inventory_policy text, new_inventory_policy text NOT NULL CHECK(new_inventory_policy IN('TRACKED','PROCURE_ON_DEMAND','PREORDER')),
 old_eligible_idol_ids uuid[] NOT NULL, new_eligible_idol_ids uuid[] NOT NULL,
 previous_updated_at public.finite_timestamptz, previous_base_updated_at public.finite_timestamptz NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id), session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id), request_id uuid NOT NULL,
 reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{1,127}$'), command_hash text NOT NULL CHECK(command_hash ~ '^[a-f0-9]{64}$'),
 created_at public.finite_timestamptz NOT NULL, UNIQUE(gift_variant_id,result_variant_version),
 FOREIGN KEY(gift_variant_id,gift_id) REFERENCES public.gift_variants(id,gift_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 CHECK(cardinality(new_eligible_idol_ids)<=2000 AND array_position(new_eligible_idol_ids,NULL) IS NULL AND array_position(old_eligible_idol_ids,NULL) IS NULL),
 CHECK((expected_variant_version=0 AND old_sku IS NULL AND old_status IS NULL AND old_inventory_policy IS NULL AND previous_updated_at IS NULL AND cardinality(old_eligible_idol_ids)=0 AND new_status='draft')
 OR(expected_variant_version>0 AND old_sku IS NOT NULL AND old_status IN('draft','active','paused') AND old_inventory_policy IS NOT NULL AND previous_updated_at IS NOT NULL))
);
CREATE TABLE public.gift_revision_profiles (
 gift_revision_id uuid PRIMARY KEY, gift_id uuid NOT NULL, gift_kind text NOT NULL CHECK(gift_kind IN('VIRTUAL','PHYSICAL','WISH','MERCHANDISE','OTHER')),
 created_by uuid NOT NULL REFERENCES public.admin_identities(id), created_at public.finite_timestamptz NOT NULL,
 profile_hash text NOT NULL CHECK(profile_hash ~ '^[a-f0-9]{64}$'),
 FOREIGN KEY(gift_revision_id,gift_id) REFERENCES public.gift_revisions(id,gift_id) ON DELETE RESTRICT,
 UNIQUE(gift_revision_id,profile_hash)
);
CREATE TABLE public.gift_content_profile_receipts (
 id uuid PRIMARY KEY, gift_id uuid NOT NULL, gift_revision_id uuid NOT NULL UNIQUE,
 authoring_receipt_id uuid NOT NULL UNIQUE REFERENCES public.content_authoring_receipts(id) DEFERRABLE INITIALLY DEFERRED,
 expected_base_version bigint NOT NULL CHECK(expected_base_version BETWEEN 1 AND 9007199254740990),
 expected_authoring_version bigint NOT NULL CHECK(expected_authoring_version BETWEEN 0 AND 9007199254740990),
 result_authoring_version bigint NOT NULL CHECK(result_authoring_version=expected_authoring_version+1),
 profile_hash text NOT NULL, previous_base_updated_at public.finite_timestamptz NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id), session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id), request_id uuid NOT NULL,
 reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{1,127}$'), command_hash text NOT NULL CHECK(command_hash ~ '^[a-f0-9]{64}$'),
 created_at public.finite_timestamptz NOT NULL,
 FOREIGN KEY(gift_revision_id,gift_id) REFERENCES public.gift_revisions(id,gift_id) ON DELETE RESTRICT,
 FOREIGN KEY(gift_revision_id,profile_hash) REFERENCES public.gift_revision_profiles(gift_revision_id,profile_hash) ON DELETE RESTRICT
);
CREATE TABLE public.gift_publication_profiles (
 publication_id uuid PRIMARY KEY REFERENCES public.content_publications(id) ON DELETE RESTRICT,
 gift_id uuid NOT NULL, gift_revision_id uuid NOT NULL, manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[a-f0-9]{64}$'), profile_hash text NOT NULL,
 FOREIGN KEY(gift_revision_id,gift_id) REFERENCES public.gift_revisions(id,gift_id) ON DELETE RESTRICT,
 FOREIGN KEY(gift_revision_id,profile_hash) REFERENCES public.gift_revision_profiles(gift_revision_id,profile_hash) ON DELETE RESTRICT
);

CREATE FUNCTION public.gift_profile_hash(gift_id uuid,revision_id uuid,kind text,actor uuid,event_time timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp SET TimeZone='UTC' AS $$
 SELECT encode(sha256(convert_to(public.canonical_publication_json(jsonb_build_object('purpose','gift-revision-profile-v1','profile',jsonb_build_object(
 'schemaVersion',1,'giftId',gift_id::text,'giftRevisionId',revision_id::text,'giftKind',kind,'createdBy',actor::text,'createdAt',to_char(event_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))),'UTF8')),'hex')
$$;

CREATE FUNCTION public.assert_gift_identity_prior() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.gifts%ROWTYPE;
BEGIN
 SELECT * INTO prior FROM public.gifts WHERE id=NEW.gift_id FOR UPDATE;
 IF NEW.action='CREATE_GIFT' THEN
  IF prior.id IS NOT NULL THEN RAISE EXCEPTION 'gift identity creation requires an absent gift' USING ERRCODE='23514'; END IF;
 ELSE
  IF prior.id IS NULL OR prior.version IS DISTINCT FROM NEW.expected_base_version OR prior.status IS DISTINCT FROM NEW.old_status OR prior.handle IS DISTINCT FROM NEW.handle OR prior.updated_at IS DISTINCT FROM NEW.previous_updated_at THEN
   RAISE EXCEPTION 'gift identity receipt requires its exact locked prior state' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER gift_identity_receipt_prior BEFORE INSERT ON public.gift_identity_receipts FOR EACH ROW EXECUTE FUNCTION public.assert_gift_identity_prior();

CREATE FUNCTION public.guard_gift_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'gift identity is retained by archival' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.schema_version IS DISTINCT FROM OLD.schema_version OR NEW.handle IS DISTINCT FROM OLD.handle OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at THEN
   RAISE EXCEPTION 'gift identity and optimistic version must be preserved' USING ERRCODE='23514'; END IF;
  IF OLD.status='archived' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'archived gift cannot be reactivated' USING ERRCODE='23514'; END IF;
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('fan-support:gift-handle:'||NEW.handle,0));
  IF EXISTS(SELECT 1 FROM public.slug_redirects WHERE entity_type='GIFT' AND old_handle=NEW.handle) THEN RAISE EXCEPTION 'gift handle is reserved' USING ERRCODE='23505'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER gift_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.gifts FOR EACH ROW EXECUTE FUNCTION public.guard_gift_identity();
CREATE TRIGGER gift_identity_no_truncate BEFORE TRUNCATE ON public.gifts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE FUNCTION public.assert_gift_identity_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND NEW.status IN('active','paused') AND NEW.published_revision_id IS DISTINCT FROM OLD.published_revision_id AND EXISTS(
 SELECT 1 FROM public.content_publication_receipts r JOIN public.content_publications p ON p.id=r.publication_id WHERE p.gift_id=NEW.id AND p.gift_revision_id=NEW.published_revision_id AND r.created_at=NEW.updated_at AND r.action IN('PUBLISH','ROLLBACK')) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.gift_identity_receipts r WHERE r.gift_id=NEW.id AND r.result_base_version=NEW.version AND r.new_status=NEW.status AND r.handle=NEW.handle AND r.created_at=NEW.updated_at
 AND ((TG_OP='INSERT' AND r.action='CREATE_GIFT' AND r.created_at=NEW.created_at) OR (TG_OP='UPDATE' AND r.expected_base_version=OLD.version AND r.old_status=OLD.status AND r.previous_updated_at=OLD.updated_at))) THEN
 RAISE EXCEPTION 'gift identity change requires its exact receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_identity_change_receipt AFTER INSERT OR UPDATE ON public.gifts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_identity_change();
CREATE FUNCTION public.assert_gift_identity_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE gift public.gifts%ROWTYPE; proof jsonb; dependency jsonb;
BEGIN
 SELECT * INTO gift FROM public.gifts WHERE id=NEW.gift_id FOR UPDATE;
 IF gift.id IS NULL OR gift.version IS DISTINCT FROM NEW.result_base_version OR gift.handle IS DISTINCT FROM NEW.handle OR gift.status IS DISTINCT FROM NEW.new_status OR gift.updated_at IS DISTINCT FROM NEW.created_at THEN RAISE EXCEPTION 'gift receipt must match the actual identity' USING ERRCODE='23514'; END IF;
 PERFORM public.assert_gift_commerce_audit(NEW.audit_log_id,NEW.actor_id,NEW.session_id,NEW.action,'GIFT_IDENTITY',NEW.gift_id,NEW.request_id,NEW.reason_code,NEW.created_at,'gift.manage',NEW.previous_updated_at);
 IF NEW.new_status IN('active','paused') AND gift.published_revision_id IS NULL THEN RAISE EXCEPTION 'available gift requires a publication' USING ERRCODE='23514'; END IF;
 IF NEW.new_status='active' THEN
  SELECT m.manifest INTO proof FROM public.gift_publication_heads h JOIN public.content_publications p ON p.id=h.publication_id AND p.gift_id=h.gift_id AND p.gift_revision_id=h.gift_revision_id JOIN public.content_publication_manifests m ON m.publication_id=p.id JOIN public.content_publication_receipts r ON r.manifest_id=m.id AND r.publication_id=p.id AND r.result_head_version=h.version WHERE h.gift_id=NEW.gift_id AND h.gift_revision_id=gift.published_revision_id AND p.proof_version=2;
  IF proof IS NULL THEN RAISE EXCEPTION 'gift activation requires a verified current publication' USING ERRCODE='23514'; END IF;
  PERFORM public.assert_publication_manifest_revision(proof->'revision');
  FOR dependency IN SELECT * FROM jsonb_array_elements(proof->'mediaRevisions') LOOP PERFORM public.assert_publication_manifest_revision(dependency); END LOOP;
  PERFORM public.assert_publication_manifest_approvals(proof); PERFORM public.assert_publication_manifest_media(proof);
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_identity_receipt_validate AFTER INSERT ON public.gift_identity_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_identity_receipt();

CREATE FUNCTION public.assert_gift_variant_prior() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE gift public.gifts%ROWTYPE; prior public.gift_variants%ROWTYPE; old_ids uuid[]; sorted_ids uuid[];
BEGIN
 SELECT * INTO gift FROM public.gifts WHERE id=NEW.gift_id FOR UPDATE;
 IF gift.id IS NULL OR gift.status='archived' OR gift.version IS DISTINCT FROM NEW.expected_base_version OR gift.updated_at IS DISTINCT FROM NEW.previous_base_updated_at THEN RAISE EXCEPTION 'variant receipt requires the actual gift version' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM public.gift_variants WHERE id=NEW.gift_variant_id FOR UPDATE;
 SELECT coalesce(array_agg(idol_id ORDER BY idol_id),'{}'::uuid[]) INTO old_ids FROM public.gift_variant_idol_eligibility WHERE gift_variant_id=NEW.gift_variant_id;
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}'::uuid[]) INTO sorted_ids FROM unnest(NEW.new_eligible_idol_ids) id;
 IF NEW.new_eligible_idol_ids IS DISTINCT FROM sorted_ids OR NEW.old_eligible_idol_ids IS DISTINCT FROM old_ids THEN RAISE EXCEPTION 'variant eligibility receipt requires canonical exact sets' USING ERRCODE='23514'; END IF;
 IF NEW.expected_variant_version=0 THEN
  IF prior.id IS NOT NULL OR (SELECT count(*) FROM public.gift_variants WHERE gift_id=NEW.gift_id)>=64 THEN RAISE EXCEPTION 'new variant requires absence and a bounded gift variant set' USING ERRCODE='23514'; END IF;
 ELSE
  IF prior.id IS NULL OR prior.gift_id IS DISTINCT FROM NEW.gift_id OR prior.version IS DISTINCT FROM NEW.expected_variant_version OR prior.sku IS DISTINCT FROM NEW.old_sku OR prior.status IS DISTINCT FROM NEW.old_status OR prior.inventory_policy IS DISTINCT FROM NEW.old_inventory_policy OR prior.updated_at IS DISTINCT FROM NEW.previous_updated_at THEN RAISE EXCEPTION 'variant receipt requires its exact prior row' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER gift_variant_receipt_prior BEFORE INSERT ON public.gift_variant_receipts FOR EACH ROW EXECUTE FUNCTION public.assert_gift_variant_prior();
CREATE FUNCTION public.assert_gift_variant_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE variant public.gift_variants%ROWTYPE; gift public.gifts%ROWTYPE; actual_ids uuid[];
BEGIN
 SELECT * INTO gift FROM public.gifts WHERE id=NEW.gift_id FOR UPDATE;
 SELECT * INTO variant FROM public.gift_variants WHERE id=NEW.gift_variant_id FOR UPDATE;
 SELECT coalesce(array_agg(idol_id ORDER BY idol_id),'{}'::uuid[]) INTO actual_ids FROM public.gift_variant_idol_eligibility WHERE gift_variant_id=NEW.gift_variant_id;
 IF gift.version IS DISTINCT FROM NEW.expected_base_version OR variant.id IS NULL OR variant.gift_id IS DISTINCT FROM NEW.gift_id OR variant.version IS DISTINCT FROM NEW.result_variant_version OR variant.sku IS DISTINCT FROM NEW.new_sku OR variant.status IS DISTINCT FROM NEW.new_status OR variant.inventory_policy IS DISTINCT FROM NEW.new_inventory_policy OR variant.updated_at IS DISTINCT FROM NEW.created_at OR actual_ids IS DISTINCT FROM NEW.new_eligible_idol_ids THEN RAISE EXCEPTION 'variant receipt must bind actual resulting state' USING ERRCODE='23514'; END IF;
 PERFORM public.assert_gift_commerce_audit(NEW.audit_log_id,NEW.actor_id,NEW.session_id,'SAVE_VARIANT','GIFT_VARIANT',NEW.gift_variant_id,NEW.request_id,NEW.reason_code,NEW.created_at,'gift.manage',GREATEST(NEW.previous_updated_at,NEW.previous_base_updated_at));
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_variant_receipt_validate AFTER INSERT ON public.gift_variant_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_variant_receipt();
CREATE FUNCTION public.guard_gift_variant_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'variant history is retained by archival' USING ERRCODE='55000'; END IF;
 PERFORM id FROM public.gifts WHERE id=NEW.gift_id FOR UPDATE;
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.gift_id IS DISTINCT FROM OLD.gift_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.schema_version IS DISTINCT FROM OLD.schema_version OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR OLD.status='archived') THEN RAISE EXCEPTION 'variant identity and version are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER gift_variant_change_guard BEFORE INSERT OR UPDATE OR DELETE ON public.gift_variants FOR EACH ROW EXECUTE FUNCTION public.guard_gift_variant_change();
CREATE TRIGGER gift_variant_no_truncate BEFORE TRUNCATE ON public.gift_variants FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE FUNCTION public.assert_gift_variant_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE variant_id uuid; variant public.gift_variants%ROWTYPE; actual_ids uuid[];
BEGIN
 IF TG_TABLE_NAME='gift_variants' THEN variant_id:=NEW.id; ELSE variant_id:=COALESCE(NEW.gift_variant_id,OLD.gift_variant_id); END IF;
 SELECT * INTO variant FROM public.gift_variants WHERE id=variant_id;
 SELECT coalesce(array_agg(idol_id ORDER BY idol_id),'{}'::uuid[]) INTO actual_ids FROM public.gift_variant_idol_eligibility WHERE gift_variant_id=variant_id;
 IF NOT EXISTS(SELECT 1 FROM public.gift_variant_receipts r WHERE r.gift_variant_id=variant_id AND r.gift_id=variant.gift_id AND r.result_variant_version=variant.version AND r.created_at=variant.updated_at AND r.new_sku=variant.sku AND r.new_status=variant.status AND r.new_inventory_policy=variant.inventory_policy AND r.new_eligible_idol_ids=actual_ids) THEN RAISE EXCEPTION 'variant or eligibility mutation requires its exact receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_variant_change_receipt AFTER INSERT OR UPDATE ON public.gift_variants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_variant_change();
CREATE CONSTRAINT TRIGGER gift_variant_eligibility_receipt AFTER INSERT OR UPDATE OR DELETE ON public.gift_variant_idol_eligibility DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_variant_change();
CREATE TRIGGER gift_variant_eligibility_no_truncate BEFORE TRUNCATE ON public.gift_variant_idol_eligibility FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER gift_variant_eligibility_no_update BEFORE UPDATE ON public.gift_variant_idol_eligibility FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();

CREATE FUNCTION public.guard_gift_profile_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.profile_version<>2 THEN RAISE EXCEPTION 'new gift revisions require current classification evidence' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.profile_version IS DISTINCT FROM OLD.profile_version THEN RAISE EXCEPTION 'gift profile provenance is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER gift_profile_version_guard BEFORE INSERT OR UPDATE ON public.gift_revisions FOR EACH ROW EXECUTE FUNCTION public.guard_gift_profile_version();
CREATE FUNCTION public.assert_gift_revision_profile() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE revision_id uuid; parent public.gift_revisions%ROWTYPE; profile public.gift_revision_profiles%ROWTYPE; authoring public.content_authoring_receipts%ROWTYPE; source_kind text;
BEGIN
 revision_id:=COALESCE((to_jsonb(NEW)->>'gift_revision_id')::uuid,(to_jsonb(NEW)->>'id')::uuid);
 SELECT * INTO parent FROM public.gift_revisions WHERE id=revision_id;
 SELECT * INTO profile FROM public.gift_revision_profiles WHERE gift_revision_id=revision_id;
 IF parent.profile_version=1 THEN
  IF profile.gift_revision_id IS NOT NULL THEN RAISE EXCEPTION 'legacy revision classification cannot be rewritten' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO authoring FROM public.content_authoring_receipts WHERE gift_revision_id=revision_id;
 IF parent.id IS NULL OR parent.profile_version IS DISTINCT FROM 2 OR profile.gift_revision_id IS NULL OR authoring.id IS NULL OR profile.gift_id IS DISTINCT FROM parent.gift_id OR profile.created_by IS DISTINCT FROM parent.created_by OR profile.created_at IS DISTINCT FROM parent.created_at OR authoring.actor_id IS DISTINCT FROM profile.created_by OR profile.profile_hash IS DISTINCT FROM public.gift_profile_hash(profile.gift_id,profile.gift_revision_id,profile.gift_kind,profile.created_by,profile.created_at) THEN RAISE EXCEPTION 'gift classification requires exact authored revision and hash' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.gift_content_profile_receipts WHERE gift_revision_id=revision_id AND profile_hash=profile.profile_hash AND authoring_receipt_id=authoring.id) THEN
  SELECT gift_kind INTO source_kind FROM public.gift_revision_profiles WHERE gift_revision_id=authoring.source_gift_revision_id;
  IF profile.gift_kind IS DISTINCT FROM coalesce(source_kind,'OTHER') THEN RAISE EXCEPTION 'classification edits require an explicit commerce receipt' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_revision_profile_required AFTER INSERT ON public.gift_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_revision_profile();
CREATE CONSTRAINT TRIGGER gift_revision_profile_validate AFTER INSERT ON public.gift_revision_profiles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_revision_profile();
CREATE FUNCTION public.assert_gift_content_profile_prior() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.gifts%ROWTYPE;
BEGIN
 SELECT * INTO prior FROM public.gifts WHERE id=NEW.gift_id FOR UPDATE;
 IF prior.id IS NULL OR prior.status='archived' OR prior.version IS DISTINCT FROM NEW.expected_base_version OR prior.updated_at IS DISTINCT FROM NEW.previous_base_updated_at THEN
  RAISE EXCEPTION 'gift content receipt requires exact locked prior identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER gift_content_profile_receipt_prior BEFORE INSERT ON public.gift_content_profile_receipts FOR EACH ROW EXECUTE FUNCTION public.assert_gift_content_profile_prior();
CREATE FUNCTION public.assert_gift_content_profile_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE gift public.gifts%ROWTYPE; parent public.gift_revisions%ROWTYPE; authoring public.content_authoring_receipts%ROWTYPE;
BEGIN
 SELECT * INTO gift FROM public.gifts WHERE id=NEW.gift_id;
 SELECT * INTO parent FROM public.gift_revisions WHERE id=NEW.gift_revision_id;
 SELECT * INTO authoring FROM public.content_authoring_receipts WHERE id=NEW.authoring_receipt_id;
 IF gift.version IS DISTINCT FROM NEW.expected_base_version+1 OR gift.draft_revision_id IS DISTINCT FROM NEW.gift_revision_id OR parent.gift_id IS DISTINCT FROM NEW.gift_id OR parent.revision IS DISTINCT FROM NEW.result_authoring_version OR parent.created_by IS DISTINCT FROM NEW.actor_id OR parent.created_at IS DISTINCT FROM NEW.created_at OR authoring.gift_revision_id IS DISTINCT FROM NEW.gift_revision_id OR authoring.expected_version IS DISTINCT FROM NEW.expected_authoring_version OR authoring.actor_id IS DISTINCT FROM NEW.actor_id OR authoring.created_at IS DISTINCT FROM NEW.created_at THEN RAISE EXCEPTION 'gift profile receipt requires exact content authoring lineage' USING ERRCODE='23514'; END IF;
 PERFORM public.assert_gift_commerce_audit(NEW.audit_log_id,NEW.actor_id,NEW.session_id,'SAVE_GIFT_CONTENT','GIFT_REVISION_PROFILE',NEW.gift_revision_id,NEW.request_id,NEW.reason_code,NEW.created_at,'gift.manage',NEW.previous_base_updated_at);
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_content_profile_receipt_validate AFTER INSERT ON public.gift_content_profile_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_content_profile_receipt();
CREATE FUNCTION public.assert_gift_publication_profile() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pub_id uuid; pub public.content_publications%ROWTYPE; parent public.gift_revisions%ROWTYPE; proof public.gift_publication_profiles%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='content_publications' THEN IF NEW.content_type<>'GIFT' THEN RETURN NULL; END IF; pub_id:=NEW.id; ELSE pub_id:=NEW.publication_id; END IF;
 SELECT * INTO pub FROM public.content_publications WHERE id=pub_id;
 SELECT * INTO parent FROM public.gift_revisions WHERE id=pub.gift_revision_id;
 SELECT * INTO proof FROM public.gift_publication_profiles WHERE publication_id=pub_id;
 IF parent.profile_version=1 THEN
  IF proof.publication_id IS NOT NULL THEN RAISE EXCEPTION 'legacy publication cannot acquire unrecorded classification' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF pub.id IS NULL OR parent.profile_version IS DISTINCT FROM 2 OR proof.publication_id IS NULL OR proof.gift_id IS DISTINCT FROM pub.gift_id OR proof.gift_revision_id IS DISTINCT FROM pub.gift_revision_id OR NOT EXISTS(SELECT 1 FROM public.content_publication_manifests m JOIN public.content_publication_receipts r ON r.manifest_id=m.id AND r.publication_id=m.publication_id WHERE m.publication_id=pub_id AND m.gift_revision_id=proof.gift_revision_id AND m.manifest_hash=proof.manifest_hash) THEN RAISE EXCEPTION 'gift publication requires exact classification and base manifest evidence' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER gift_publication_profile_required AFTER INSERT ON public.content_publications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_publication_profile();
CREATE CONSTRAINT TRIGGER gift_publication_profile_validate AFTER INSERT ON public.gift_publication_profiles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_gift_publication_profile();

CREATE TRIGGER gift_identity_receipts_append_only BEFORE UPDATE OR DELETE ON public.gift_identity_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER gift_identity_receipts_no_truncate BEFORE TRUNCATE ON public.gift_identity_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER gift_variant_receipts_append_only BEFORE UPDATE OR DELETE ON public.gift_variant_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER gift_variant_receipts_no_truncate BEFORE TRUNCATE ON public.gift_variant_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER gift_revision_profiles_append_only BEFORE UPDATE OR DELETE ON public.gift_revision_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER gift_revision_profiles_no_truncate BEFORE TRUNCATE ON public.gift_revision_profiles FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER gift_content_profile_receipts_append_only BEFORE UPDATE OR DELETE ON public.gift_content_profile_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER gift_content_profile_receipts_no_truncate BEFORE TRUNCATE ON public.gift_content_profile_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER gift_publication_profiles_append_only BEFORE UPDATE OR DELETE ON public.gift_publication_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER gift_publication_profiles_no_truncate BEFORE TRUNCATE ON public.gift_publication_profiles FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
