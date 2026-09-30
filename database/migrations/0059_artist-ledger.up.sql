SET search_path=public;
-- ADR-022 / L3-12: the artist ledger is a read-only summary of orders, payments and refunds; no business
-- table is added. These keys may already exist where `admin-account.mjs sync-roles` ran after L3-11.
INSERT INTO public.permissions(id,permission_key,description) VALUES
 (gen_random_uuid(),'ledger.read','Read and export the received-gift ledger of every artist'),
 (gen_random_uuid(),'ledger.assigned','Read and export the received-gift ledger of the artists assigned to the account'),
 (gen_random_uuid(),'ledger.messages','Reveal fan messages on the paid lines of the artists assigned to the account')
ON CONFLICT(permission_key) DO NOTHING;

-- The ledger reads by payment time, by artist and by refunded line; none of these had an index.
CREATE INDEX payment_attempts_succeeded_idx ON public.payment_attempts(succeeded_at,order_id) WHERE status='SUCCEEDED';
CREATE INDEX order_items_idol_order_idx ON public.order_items(idol_id,order_id);
CREATE INDEX refund_items_order_item_idx ON public.refund_items(order_item_id);

-- Every export leaves a receipt with its scope and period; its audit row points back at it.
CREATE TABLE public.artist_ledger_exports (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id),
 session_id uuid NOT NULL REFERENCES public.admin_sessions(id),
 scope text NOT NULL CHECK(scope IN('ALL','UNASSIGNED','BROKER','ARTIST')),
 broker_identity_id uuid REFERENCES public.admin_identities(id),
 idol_id uuid REFERENCES public.idols(id),
 period_from date NOT NULL,
 period_to date NOT NULL,
 time_zone text NOT NULL CHECK(length(time_zone)<=64 AND time_zone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'),
 line_count integer NOT NULL CHECK(line_count BETWEEN 0 AND 10000),
 truncated boolean NOT NULL,
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),
 request_id uuid NOT NULL,
 created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CHECK(period_to>=period_from AND period_to-period_from<366),
 CHECK((scope='BROKER')=(broker_identity_id IS NOT NULL) AND (scope='ARTIST')=(idol_id IS NOT NULL))
);
CREATE INDEX artist_ledger_exports_actor_idx ON public.artist_ledger_exports(actor_id,created_at DESC);
CREATE FUNCTION public.assert_artist_ledger_export() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs a JOIN public.admin_sessions s ON s.id=NEW.session_id WHERE a.id=NEW.audit_log_id AND a.actor_type='ADMIN' AND a.actor_id=NEW.actor_id
  AND a.action='ARTIST_LEDGER_EXPORT' AND a.subject_type='ARTIST_LEDGER_EXPORT' AND a.subject_id=NEW.id AND a.outcome='SUCCEEDED' AND a.field_category='ARTIST_LEDGER'
  AND a.request_id=NEW.request_id AND a.created_at=NEW.created_at AND s.admin_identity_id=NEW.actor_id) THEN
  RAISE EXCEPTION 'ledger export requires its exact audit record' USING ERRCODE='23514'; END IF;
 -- A broker exports only itself or one of its current artists; everything else needs ledger.read.
 IF NOT(public.admin_order_authorized(NEW.session_id,NEW.actor_id,'ledger.read',NEW.created_at)
  OR (public.admin_order_authorized(NEW.session_id,NEW.actor_id,'ledger.assigned',NEW.created_at)
   AND ((NEW.scope='BROKER' AND NEW.broker_identity_id=NEW.actor_id) OR (NEW.scope='ARTIST' AND public.idol_current_broker(NEW.idol_id)=NEW.actor_id)))) THEN
  RAISE EXCEPTION 'ledger export requires ledger authority over its whole scope' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER artist_ledger_export_complete AFTER INSERT ON public.artist_ledger_exports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_artist_ledger_export();
CREATE TRIGGER artist_ledger_exports_append_only BEFORE UPDATE OR DELETE ON public.artist_ledger_exports FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER artist_ledger_exports_no_truncate BEFORE TRUNCATE ON public.artist_ledger_exports FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

-- 0031's receipt check, plus one branch: with ledger.messages a broker may reveal the message on a paid line
-- of an artist currently assigned to it, unless the studio rejected or redacted that message. Every other
-- receipt, and every reader without that branch, keeps the exact 0031 rules.
CREATE OR REPLACE FUNCTION public.assert_admin_order_receipt_authority() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE required_permission text; intent public.support_intents%ROWTYPE; a public.admin_order_private_accesses%ROWTYPE; broker_read boolean:=false;
BEGIN
 IF TG_TABLE_NAME='admin_order_private_accesses' AND to_jsonb(NEW)->>'kind'='MESSAGE' THEN
  broker_read:=public.admin_order_authorized(NEW.session_id,NEW.actor_id,'ledger.messages',NEW.created_at)
   AND EXISTS(SELECT 1 FROM public.order_items i JOIN public.support_intents s ON s.id=i.support_intent_id
    JOIN public.payment_attempts pa ON pa.order_id=i.order_id AND pa.status='SUCCEEDED'
    WHERE i.id=NEW.item_id AND i.order_id=NEW.order_id AND s.id=NEW.support_intent_id
     AND public.idol_current_broker(i.idol_id)=NEW.actor_id AND s.moderation_status NOT IN('REJECTED','REDACTED'));
 END IF;
 IF NOT broker_read THEN
  required_permission:=CASE TG_TABLE_NAME WHEN 'admin_order_notes' THEN 'orders.note'
  WHEN 'admin_order_private_accesses' THEN CASE to_jsonb(NEW)->>'kind' WHEN 'MESSAGE' THEN 'orders.message.read' ELSE 'orders.note' END
  WHEN 'admin_order_message_reviews' THEN 'orders.message.review'
  WHEN 'admin_order_fulfillment_receipts' THEN CASE WHEN to_jsonb(NEW)->>'action' IN('HOLD','RESUME') THEN 'orders.manage' ELSE 'orders.fulfillment' END END;
  IF NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.read',NEW.created_at)
  OR NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,required_permission,NEW.created_at) THEN
  RAISE EXCEPTION 'order receipt requires current canonical session permission' USING ERRCODE='23514'; END IF;
  IF (TG_TABLE_NAME='admin_order_private_accesses' AND to_jsonb(NEW)->>'kind'='MESSAGE') OR TG_TABLE_NAME='admin_order_message_reviews' THEN
   SELECT * INTO intent FROM public.support_intents WHERE id=NEW.support_intent_id;
   IF NOT EXISTS(SELECT 1 FROM public.admin_order_message_locale_grants WHERE admin_identity_id=NEW.actor_id AND locale=NEW.review_locale AND revoked_at IS NULL AND granted_at<=NEW.created_at)
    OR (intent.fan_message_locale<>NEW.review_locale AND NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'orders.message.triage',NEW.created_at)) THEN
    RAISE EXCEPTION 'order message requires explicit language and triage authority' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='admin_order_private_accesses' THEN
  IF NEW.expires_at>(SELECT expires_at FROM public.admin_sessions WHERE id=NEW.session_id) THEN
   RAISE EXCEPTION 'private read may not outlive its session' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END; $$;
