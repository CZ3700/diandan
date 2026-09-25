SET search_path = public;

-- Editing preserves the original cart item and encrypted support intent. These
-- receipts bind each new head to an immutable operation, without changing v1 events.
CREATE FUNCTION public.cart_private_material_hash(message bytea, display_mode text, display_name bytea, data_key bytea, key_version text, message_locale text)
RETURNS public.sha256_hex LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT encode(sha256(convert_to(jsonb_build_array(encode(message,'hex'),display_mode,encode(display_name,'hex'),encode(data_key,'hex'),key_version,message_locale)::text,'UTF8')),'hex')::public.sha256_hex $$;

CREATE TABLE public.cart_item_mutation_receipts (
  receipt_id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  event_id uuid NOT NULL UNIQUE,
  cart_id uuid NOT NULL REFERENCES public.carts(id) ON DELETE RESTRICT,
  cart_item_id uuid NOT NULL REFERENCES public.cart_items(id) ON DELETE RESTRICT,
  support_intent_id uuid NOT NULL REFERENCES public.support_intents(id) ON DELETE RESTRICT,
  mutation_kind text NOT NULL CHECK (mutation_kind IN ('QUANTITY','PERSONALIZATION','REMOVE')),
  expected_cart_version public.positive_version NOT NULL,
  expected_item_version public.positive_version NOT NULL,
  expected_intent_version public.positive_version NOT NULL,
  cart_version public.positive_version NOT NULL,
  item_version public.positive_version NOT NULL,
  intent_version public.positive_version NOT NULL,
  quantity integer NOT NULL CHECK (quantity>0),
  observed_price_id uuid NOT NULL REFERENCES public.prices(id) ON DELETE RESTRICT,
  display_mode text NOT NULL CHECK (display_mode IN ('anonymous','nickname')),
  has_fan_message boolean NOT NULL,
  fan_message_locale text NOT NULL,
  private_material_hash public.sha256_hex NOT NULL,
  presentation_locale public.supported_locale NOT NULL,
  market public.market_code NOT NULL,
  currency public.currency_code NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at public.finite_timestamptz NOT NULL,
  UNIQUE (receipt_id,event_id),
  UNIQUE (cart_id,cart_version),
  UNIQUE (cart_item_id,item_version),
  CHECK (cart_version=expected_cart_version+1 AND item_version=expected_item_version+1),
  CHECK (intent_version=expected_intent_version+CASE WHEN mutation_kind='QUANTITY' THEN 0 ELSE 1 END)
);

CREATE TABLE public.cart_edit_outbox_events (
  event_id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  receipt_id uuid NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type IN ('CART_ITEM_UPDATED','CART_ITEM_REMOVED')),
  aggregate_id uuid NOT NULL REFERENCES public.carts(id) ON DELETE RESTRICT,
  cart_item_id uuid NOT NULL REFERENCES public.cart_items(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at public.finite_timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status = 'PENDING'),
  FOREIGN KEY (receipt_id,event_id) REFERENCES public.cart_item_mutation_receipts(receipt_id,event_id) ON DELETE RESTRICT
);
-- No dispatch success is invented. A future explicit consumer owns delivery
-- receipts; the existing DomainEvent v1 dispatcher does not scan this namespace.
CREATE INDEX cart_edit_outbox_events_pending_idx ON public.cart_edit_outbox_events(occurred_at,event_id);

CREATE TABLE public.cart_private_access_receipts (
  access_audit_id uuid PRIMARY KEY REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  cart_id uuid NOT NULL REFERENCES public.carts(id) ON DELETE RESTRICT,
  cart_item_id uuid NOT NULL REFERENCES public.cart_items(id) ON DELETE RESTRICT,
  support_intent_id uuid NOT NULL REFERENCES public.support_intents(id) ON DELETE RESTRICT,
  cart_version public.positive_version NOT NULL,
  item_version public.positive_version NOT NULL,
  intent_version public.positive_version NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at public.finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION public.assert_cart_mutation_prior() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE c public.carts%ROWTYPE; i public.cart_items%ROWTYPE; s public.support_intents%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.carts WHERE id=NEW.cart_id FOR UPDATE;
  SELECT * INTO i FROM public.cart_items WHERE id=NEW.cart_item_id FOR UPDATE;
  SELECT * INTO s FROM public.support_intents WHERE id=NEW.support_intent_id FOR UPDATE;
  IF c.id IS NULL OR i.id IS NULL OR s.id IS NULL OR i.cart_id<>c.id OR s.cart_item_id<>i.id
    OR c.status<>'ACTIVE' OR s.status<>'ACTIVE' OR s.privacy_state<>'ACTIVE'
    OR c.expires_at<=clock_timestamp() OR s.expires_at<=clock_timestamp()
    OR c.version<>NEW.expected_cart_version OR i.version<>NEW.expected_item_version OR s.version<>NEW.expected_intent_version
    OR c.market<>NEW.market OR c.currency<>NEW.currency
    OR NEW.occurred_at<GREATEST(c.updated_at,i.updated_at,s.updated_at) THEN
    RAISE EXCEPTION 'cart mutation must bind the current editable head' USING ERRCODE='23514';
  END IF;
  IF NEW.mutation_kind<>'QUANTITY' AND (NEW.quantity<>i.quantity OR NEW.observed_price_id<>i.observed_price_id) THEN
    RAISE EXCEPTION 'private or removal mutation cannot change the item price or quantity' USING ERRCODE='23514';
  END IF;
  IF NEW.mutation_kind<>'PERSONALIZATION' AND (
    NEW.display_mode<>i.display_mode OR NEW.has_fan_message<>i.has_fan_message OR NEW.fan_message_locale<>s.fan_message_locale
    OR NEW.private_material_hash<>public.cart_private_material_hash(s.fan_message_ciphertext,s.display_mode,s.display_name_ciphertext,s.encrypted_data_key,s.encryption_key_version,s.fan_message_locale)) THEN
    RAISE EXCEPTION 'quantity or removal mutation cannot replace private material' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prices price JOIN public.price_books book ON book.id=price.price_book_id AND book.revision=price.price_book_revision
    WHERE price.id=NEW.observed_price_id AND price.gift_variant_id=i.gift_variant_id AND book.market=c.market AND book.currency=c.currency) THEN
    RAISE EXCEPTION 'cart mutation price must belong to its variant and scope' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER cart_mutation_receipt_prior BEFORE INSERT ON public.cart_item_mutation_receipts FOR EACH ROW EXECUTE FUNCTION public.assert_cart_mutation_prior();

CREATE FUNCTION public.assert_cart_mutation_head() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.carts c JOIN public.cart_items i ON i.cart_id=c.id
    JOIN public.support_intents s ON s.cart_item_id=i.id
    JOIN public.cart_edit_outbox_events event ON event.receipt_id=NEW.receipt_id AND event.event_id=NEW.event_id
    WHERE c.id=NEW.cart_id AND i.id=NEW.cart_item_id AND s.id=NEW.support_intent_id
      AND c.version=NEW.cart_version AND i.version=NEW.item_version AND s.version=NEW.intent_version
      AND c.status='ACTIVE' AND s.status=CASE WHEN NEW.mutation_kind='REMOVE' THEN 'CANCELED' ELSE 'ACTIVE' END AND s.privacy_state='ACTIVE'
      AND c.presentation_locale=NEW.presentation_locale AND c.market=NEW.market AND c.currency=NEW.currency
      AND c.updated_at=NEW.occurred_at AND i.updated_at=NEW.occurred_at
      AND (NEW.mutation_kind='QUANTITY' OR s.updated_at=NEW.occurred_at)
      AND i.quantity=NEW.quantity AND i.observed_price_id=NEW.observed_price_id
      AND i.display_mode=NEW.display_mode AND i.has_fan_message=NEW.has_fan_message AND s.fan_message_locale=NEW.fan_message_locale
      AND public.cart_private_material_hash(s.fan_message_ciphertext,s.display_mode,s.display_name_ciphertext,s.encrypted_data_key,s.encryption_key_version,s.fan_message_locale)=NEW.private_material_hash
      AND (NEW.mutation_kind<>'PERSONALIZATION' OR s.moderation_status='PENDING')
  ) THEN
    RAISE EXCEPTION 'cart mutation receipt must match its final head and event' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER cart_mutation_receipt_head AFTER INSERT ON public.cart_item_mutation_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_cart_mutation_head();

CREATE FUNCTION public.assert_cart_edit_event() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cart_item_mutation_receipts receipt
    WHERE receipt.receipt_id=NEW.receipt_id AND receipt.event_id=NEW.event_id
      AND receipt.cart_id=NEW.aggregate_id AND receipt.cart_item_id=NEW.cart_item_id
      AND receipt.request_id=NEW.request_id AND receipt.correlation_id=NEW.correlation_id AND receipt.occurred_at=NEW.occurred_at
      AND NEW.event_type=CASE WHEN receipt.mutation_kind='REMOVE' THEN 'CART_ITEM_REMOVED' ELSE 'CART_ITEM_UPDATED' END) THEN
    RAISE EXCEPTION 'cart edit event must match its immutable receipt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER cart_edit_event_authority BEFORE INSERT ON public.cart_edit_outbox_events FOR EACH ROW EXECUTE FUNCTION public.assert_cart_edit_event();

CREATE FUNCTION public.assert_cart_private_access() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.carts c JOIN public.cart_items i ON i.cart_id=c.id JOIN public.support_intents s ON s.cart_item_id=i.id
    JOIN public.audit_logs audit ON audit.id=NEW.access_audit_id
    WHERE c.id=NEW.cart_id AND i.id=NEW.cart_item_id AND s.id=NEW.support_intent_id
      AND c.version=NEW.cart_version AND i.version=NEW.item_version AND s.version=NEW.intent_version
      AND c.status='ACTIVE' AND s.status='ACTIVE' AND s.privacy_state='ACTIVE'
      AND c.expires_at>clock_timestamp() AND s.expires_at>clock_timestamp()
      AND audit.actor_type='SYSTEM' AND audit.task_name='cart-private-editor' AND audit.action='AUTHORIZE_PRIVATE_EDIT_READ'
      AND audit.subject_type='SUPPORT_INTENT' AND audit.subject_id=s.id AND audit.field_category='SUPPORT_INTENT_PRIVATE'
      AND audit.outcome='SUCCEEDED' AND audit.request_id=NEW.request_id AND audit.correlation_id=NEW.correlation_id) THEN
    RAISE EXCEPTION 'cart private access must bind an authorized current intent and audit' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER cart_private_access_authority BEFORE INSERT ON public.cart_private_access_receipts FOR EACH ROW EXECUTE FUNCTION public.assert_cart_private_access();

CREATE TRIGGER cart_item_mutation_receipts_append_only BEFORE UPDATE OR DELETE ON public.cart_item_mutation_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER cart_item_mutation_receipts_no_truncate BEFORE TRUNCATE ON public.cart_item_mutation_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER cart_edit_outbox_events_append_only BEFORE UPDATE OR DELETE ON public.cart_edit_outbox_events FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER cart_edit_outbox_events_no_truncate BEFORE TRUNCATE ON public.cart_edit_outbox_events FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER cart_private_access_receipts_append_only BEFORE UPDATE OR DELETE ON public.cart_private_access_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER cart_private_access_receipts_no_truncate BEFORE TRUNCATE ON public.cart_private_access_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
