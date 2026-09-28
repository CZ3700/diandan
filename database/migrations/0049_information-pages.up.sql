SET search_path=public;
CREATE FUNCTION information_page_hash(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$ SELECT encode(sha256(convert_to(public.canonical_publication_json(value),'UTF8')),'hex') $$;
CREATE FUNCTION information_page_text(value jsonb,max_length integer,required boolean) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t text;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 t:=value#>>'{}';
 RETURN length(t)<=max_length AND t !~ U&'[\0001-\0008\000B\000C\000E-\001F\007F-\009F]' AND t !~ '<[/]?[A-Za-z!][^>]*>' AND (NOT required OR regexp_replace(t,U&'[\0001-\0020\007F-\00A0\00AD\034F\061C\115F\1160\1680\17B4\17B5\180B-\180F\2000-\200F\2028-\202F\205F-\206F\2800\3000\3164\FE00-\FE0F\FEFF\FFA0]','','g')<>'');
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE FUNCTION valid_information_page_structure(value jsonb,key text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE ids text[]; email text;
BEGIN
 IF key NOT IN('ABOUT','FAQ','SUPPORT') OR jsonb_typeof(value) IS DISTINCT FROM 'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(value) k) IS DISTINCT FROM ARRAY['contactEmail','sectionIds'] OR jsonb_typeof(value->'sectionIds') IS DISTINCT FROM 'array' OR jsonb_array_length(value->'sectionIds') NOT BETWEEN 1 AND 12 THEN RETURN false;END IF;
 SELECT array_agg(lower(v#>>'{}')) INTO ids FROM jsonb_array_elements(value->'sectionIds') v WHERE jsonb_typeof(v)='string' AND v#>>'{}' ~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$';
 IF cardinality(ids) IS DISTINCT FROM jsonb_array_length(value->'sectionIds') OR (SELECT count(DISTINCT x) FROM unnest(ids) x)<>cardinality(ids) THEN RETURN false; END IF;
 IF value->'contactEmail'='null'::jsonb THEN RETURN true; END IF;
 email:=value->>'contactEmail';
 RETURN key='SUPPORT' AND jsonb_typeof(value->'contactEmail')='string' AND length(email)<=254 AND email !~ E'[\\r\\n?&#%]' AND email ~ '^(?!\.)(?!.*\.\.)([A-Za-z0-9_''+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$';
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE FUNCTION valid_information_page_fields(value jsonb,key text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s jsonb; ids uuid[]:=ARRAY[]::uuid[]; id uuid;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(value) k) IS DISTINCT FROM ARRAY['sections','summary','title'] OR NOT information_page_text(value->'title',120,true) OR NOT information_page_text(value->'summary',500,false) OR jsonb_typeof(value->'sections') IS DISTINCT FROM 'array' OR jsonb_array_length(value->'sections') NOT BETWEEN 1 AND 12 THEN RETURN false; END IF;
 FOR s IN SELECT jsonb_array_elements(value->'sections') LOOP
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(s) k) IS DISTINCT FROM ARRAY['body','heading','id'] OR jsonb_typeof(s->'id') IS DISTINCT FROM 'string' OR NOT(s->>'id' ~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$') OR NOT information_page_text(s->'heading',160,key='FAQ') OR NOT information_page_text(s->'body',4000,true) THEN RETURN false; END IF;
  id:=(s->>'id')::uuid; IF id=ANY(ids) THEN RETURN false;END IF;ids:=array_append(ids,id);
 END LOOP;RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE FUNCTION information_page_matches(structure jsonb,fields jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$ SELECT ARRAY(SELECT lower(v#>>'{}') FROM jsonb_array_elements(structure->'sectionIds') v) = ARRAY(SELECT lower(v->>'id') FROM jsonb_array_elements(fields->'sections') v) $$;
CREATE TABLE information_page_heads (
 page_key text PRIMARY KEY CHECK(page_key IN('ABOUT','FAQ','SUPPORT')),version bigint NOT NULL DEFAULT 0 CHECK(version BETWEEN 0 AND 9007199254740991),draft_revision_id uuid,published_publication_id uuid,updated_at finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO information_page_heads(page_key) VALUES('ABOUT'),('FAQ'),('SUPPORT');
CREATE TABLE information_page_revisions (
 id uuid PRIMARY KEY,schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),page_key text NOT NULL REFERENCES information_page_heads(page_key),revision bigint NOT NULL CHECK(revision>0),source_revision_id uuid REFERENCES information_page_revisions(id),structure jsonb NOT NULL,source_hash sha256_hex NOT NULL,actor_id uuid NOT NULL REFERENCES admin_identities(id),session_id uuid NOT NULL REFERENCES admin_sessions(id),request_id uuid NOT NULL,audit_log_id uuid NOT NULL REFERENCES audit_logs(id),created_at finite_timestamptz NOT NULL,UNIQUE(page_key,revision),CHECK(valid_information_page_structure(structure,page_key))
);
CREATE TABLE information_page_revision_translations (
 id uuid PRIMARY KEY,revision_id uuid NOT NULL REFERENCES information_page_revisions(id),locale supported_locale NOT NULL,title text NOT NULL,summary text NOT NULL,sections jsonb NOT NULL,content_hash sha256_hex NOT NULL,translated_from_source_hash sha256_hex NOT NULL,editor_id uuid NOT NULL REFERENCES admin_identities(id),edited_at finite_timestamptz NOT NULL,UNIQUE(revision_id,locale)
);
CREATE TABLE information_page_translation_reviews (
 id uuid PRIMARY KEY,translation_id uuid NOT NULL REFERENCES information_page_revision_translations(id),sequence smallint NOT NULL CHECK(sequence BETWEEN 1 AND 3),status text NOT NULL CHECK(status IN('DRAFT','IN_REVIEW','APPROVED')),actor_id uuid NOT NULL REFERENCES admin_identities(id),session_id uuid NOT NULL REFERENCES admin_sessions(id),content_hash sha256_hex NOT NULL,source_hash sha256_hex NOT NULL,audit_log_id uuid NOT NULL REFERENCES audit_logs(id),created_at finite_timestamptz NOT NULL,UNIQUE(translation_id,sequence),CHECK((sequence=1 AND status='DRAFT') OR(sequence=2 AND status='IN_REVIEW') OR(sequence=3 AND status='APPROVED'))
);
CREATE TABLE information_page_translation_copy_evidence (
 target_translation_id uuid PRIMARY KEY REFERENCES information_page_revision_translations(id),source_translation_id uuid NOT NULL REFERENCES information_page_revision_translations(id),audit_log_id uuid NOT NULL REFERENCES audit_logs(id),CHECK(target_translation_id<>source_translation_id)
);
CREATE TABLE information_page_publications (
 id uuid PRIMARY KEY,page_key text NOT NULL REFERENCES information_page_heads(page_key),revision_id uuid REFERENCES information_page_revisions(id),version positive_version NOT NULL,action text NOT NULL CHECK(action IN('PUBLISH','RESTORE','UNPUBLISH')),restored_from_publication_id uuid REFERENCES information_page_publications(id),actor_id uuid NOT NULL REFERENCES admin_identities(id),session_id uuid NOT NULL REFERENCES admin_sessions(id),request_id uuid NOT NULL,audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id),created_at finite_timestamptz NOT NULL,UNIQUE(page_key,version),CHECK((action='UNPUBLISH')=(revision_id IS NULL)),CHECK((action='RESTORE')=(restored_from_publication_id IS NOT NULL))
);
CREATE TABLE information_page_receipts (
 id uuid PRIMARY KEY,page_key text NOT NULL REFERENCES information_page_heads(page_key),actor_id uuid NOT NULL REFERENCES admin_identities(id),session_id uuid NOT NULL REFERENCES admin_sessions(id),action text NOT NULL CHECK(action IN('SAVE_DRAFT','SUBMIT_REVIEW','APPROVE_REVIEW','PUBLISH','RESTORE','UNPUBLISH')),idempotency_key idempotency_key_value NOT NULL,request_hash sha256_hex NOT NULL,response jsonb NOT NULL,audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id),request_id uuid NOT NULL,created_at finite_timestamptz NOT NULL,UNIQUE(actor_id,action,idempotency_key),CHECK(response->>'outcome'='SUCCESS' AND response->>'kind'='STATE')
);
ALTER TABLE information_page_heads ADD FOREIGN KEY(draft_revision_id) REFERENCES information_page_revisions(id),ADD FOREIGN KEY(published_publication_id) REFERENCES information_page_publications(id);
CREATE FUNCTION information_page_effective_review(target uuid) RETURNS SETOF information_page_translation_reviews LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 WITH RECURSIVE chain(id,depth,visited) AS(SELECT target,0,ARRAY[target] UNION ALL SELECT e.source_translation_id,c.depth+1,c.visited||e.source_translation_id FROM chain c JOIN information_page_translation_copy_evidence e ON e.target_translation_id=c.id WHERE NOT e.source_translation_id=ANY(c.visited)) SELECT r.* FROM chain c JOIN information_page_translation_reviews r ON r.translation_id=c.id ORDER BY c.depth,r.sequence DESC LIMIT 1
$$;
CREATE FUNCTION guard_information_page_translation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE parent information_page_revisions; fields jsonb;
BEGIN
 SELECT * INTO parent FROM information_page_revisions WHERE id=NEW.revision_id;
 IF EXISTS(SELECT 1 FROM information_page_receipts WHERE audit_log_id=parent.audit_log_id) THEN RAISE EXCEPTION 'information revision content is sealed' USING ERRCODE='55000';END IF;
 fields:=jsonb_build_object('title',NEW.title,'summary',NEW.summary,'sections',NEW.sections);
 IF NOT valid_information_page_fields(fields,parent.page_key) OR NEW.content_hash<>information_page_hash(fields) OR (NEW.translated_from_source_hash=parent.source_hash AND NOT information_page_matches(parent.structure,fields)) OR (NEW.locale='en' AND(NEW.translated_from_source_hash<>parent.source_hash OR parent.source_hash<>information_page_hash(jsonb_build_object('pageKey',parent.page_key,'structure',parent.structure,'englishFields',fields)) )) THEN RAISE EXCEPTION 'information translation requires exact bounded text source and structure' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER information_translation_validate BEFORE INSERT ON information_page_revision_translations FOR EACH ROW EXECUTE FUNCTION guard_information_page_translation();
CREATE FUNCTION guard_information_page_copy() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t information_page_revision_translations;s information_page_revision_translations;tr information_page_revisions;sr information_page_revisions;
BEGIN
 SELECT * INTO t FROM information_page_revision_translations WHERE id=NEW.target_translation_id;SELECT * INTO s FROM information_page_revision_translations WHERE id=NEW.source_translation_id;SELECT * INTO tr FROM information_page_revisions WHERE id=t.revision_id;SELECT * INTO sr FROM information_page_revisions WHERE id=s.revision_id;
 IF EXISTS(SELECT 1 FROM information_page_receipts WHERE audit_log_id=tr.audit_log_id) OR tr.page_key<>sr.page_key OR tr.revision<=sr.revision OR tr.source_revision_id<>sr.id OR (to_jsonb(t)-'id'-'revision_id') IS DISTINCT FROM(to_jsonb(s)-'id'-'revision_id') OR NEW.audit_log_id<>tr.audit_log_id THEN RAISE EXCEPTION 'information copy requires exact immutable predecessor' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER information_copy_validate BEFORE INSERT ON information_page_translation_copy_evidence FOR EACH ROW EXECUTE FUNCTION guard_information_page_copy();
CREATE FUNCTION guard_information_page_review() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t information_page_revision_translations;r information_page_revisions;prior information_page_translation_reviews;
BEGIN
 SELECT * INTO t FROM information_page_revision_translations WHERE id=NEW.translation_id;SELECT * INTO r FROM information_page_revisions WHERE id=t.revision_id;SELECT * INTO prior FROM information_page_effective_review(t.id);
 IF (NEW.sequence>1 AND NOT EXISTS(SELECT 1 FROM information_page_heads h WHERE h.page_key=r.page_key AND h.draft_revision_id=r.id)) OR (NEW.sequence=1 AND EXISTS(SELECT 1 FROM information_page_receipts WHERE audit_log_id=r.audit_log_id)) OR NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.id=NEW.audit_log_id AND a.actor_id=NEW.actor_id AND a.subject_id=r.id AND a.request_id IS NOT NULL AND a.action=CASE NEW.sequence WHEN 1 THEN 'INFORMATION_PAGE_SAVE_DRAFT' WHEN 2 THEN 'INFORMATION_PAGE_SUBMIT_REVIEW' ELSE 'INFORMATION_PAGE_APPROVE_REVIEW' END AND a.created_at=NEW.created_at) OR NEW.content_hash<>t.content_hash OR NEW.source_hash<>t.translated_from_source_hash OR NEW.created_at<t.edited_at OR(NEW.sequence>1 AND(NEW.source_hash<>r.source_hash OR prior.sequence IS DISTINCT FROM NEW.sequence-1)) OR (NEW.sequence<3 AND NEW.actor_id<>t.editor_id) OR (NEW.sequence=3 AND (NEW.actor_id=t.editor_id OR EXISTS(SELECT 1 FROM information_page_revision_translations en WHERE en.revision_id=r.id AND en.locale='en' AND en.editor_id=NEW.actor_id))) OR NOT EXISTS(SELECT 1 FROM admin_sessions s WHERE s.id=NEW.session_id AND s.admin_identity_id=NEW.actor_id) THEN RAISE EXCEPTION 'information review requires current hashes sequence and independent actor' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER information_review_validate BEFORE INSERT ON information_page_translation_reviews FOR EACH ROW EXECUTE FUNCTION guard_information_page_review();
CREATE FUNCTION information_page_publishable(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT count(*)=7 AND bool_and(review.status='APPROVED' AND review.content_hash=t.content_hash AND review.source_hash=r.source_hash AND t.translated_from_source_hash=r.source_hash AND information_page_matches(r.structure,jsonb_build_object('sections',t.sections))) FROM information_page_revisions r JOIN information_page_revision_translations t ON t.revision_id=r.id JOIN LATERAL information_page_effective_review(t.id) review ON true WHERE r.id=target
$$;
CREATE FUNCTION guard_information_page_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.action<>'UNPUBLISH' AND (NOT coalesce(information_page_publishable(NEW.revision_id),false) OR NOT EXISTS(SELECT 1 FROM information_page_revisions WHERE id=NEW.revision_id AND page_key=NEW.page_key)) OR(NEW.action='RESTORE' AND NOT EXISTS(SELECT 1 FROM information_page_publications p WHERE p.id=NEW.restored_from_publication_id AND p.page_key=NEW.page_key AND p.revision_id=NEW.revision_id AND p.action<>'UNPUBLISH')) THEN RAISE EXCEPTION 'information publication requires seven approved current translations' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER information_publication_validate BEFORE INSERT ON information_page_publications FOR EACH ROW EXECUTE FUNCTION guard_information_page_publication();
CREATE FUNCTION guard_information_page_head() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'information head cannot be removed' USING ERRCODE='55000';END IF;
 IF NEW.page_key<>OLD.page_key OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR(NEW.draft_revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM information_page_revisions r WHERE r.id=NEW.draft_revision_id AND r.page_key=NEW.page_key)) OR(NEW.published_publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM information_page_publications p WHERE p.id=NEW.published_publication_id AND p.page_key=NEW.page_key AND p.action<>'UNPUBLISH')) THEN RAISE EXCEPTION 'information head requires exact same-page references and version' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER information_head_guard BEFORE UPDATE OR DELETE ON information_page_heads FOR EACH ROW EXECUTE FUNCTION guard_information_page_head();
CREATE FUNCTION assert_information_page_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_page_receipts receipt JOIN audit_logs a ON a.id=receipt.audit_log_id WHERE receipt.audit_log_id=NEW.audit_log_id AND receipt.action='SAVE_DRAFT' AND receipt.page_key=NEW.page_key AND receipt.actor_id=NEW.actor_id AND receipt.session_id=NEW.session_id AND receipt.created_at=NEW.created_at AND a.subject_id=NEW.id AND a.action='INFORMATION_PAGE_SAVE_DRAFT' AND a.actor_id=NEW.actor_id AND a.created_at=NEW.created_at) OR (NEW.source_revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM information_page_revisions r WHERE r.id=NEW.source_revision_id AND r.page_key=NEW.page_key AND r.revision<NEW.revision)) OR NOT EXISTS(SELECT 1 FROM information_page_revision_translations WHERE revision_id=NEW.id AND locale='en') OR EXISTS(SELECT 1 FROM information_page_revision_translations t WHERE t.revision_id=NEW.id AND NOT EXISTS(SELECT 1 FROM information_page_effective_review(t.id))) THEN RAISE EXCEPTION 'information revision requires source and real author/review provenance' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER information_revision_complete AFTER INSERT ON information_page_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_information_page_revision();
DO $$DECLARE name text;BEGIN FOREACH name IN ARRAY ARRAY['information_page_revisions','information_page_revision_translations','information_page_translation_reviews','information_page_translation_copy_evidence','information_page_publications','information_page_receipts'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_append_only()',name||'_immutable',name);EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only()',name||'_no_truncate',name);END LOOP;END $$;
CREATE TRIGGER information_heads_no_truncate BEFORE TRUNCATE ON information_page_heads FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
-- Old events keep their original validators; the new family has its own exact proof.
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_event_type_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_event_type_check CHECK(event_type IN('CART_ITEM_ADDED','CONTENT_PUBLICATION_CHANGED','PAYMENT_STATUS_CHANGED','ORDER_PAYMENT_CONFIRMED','REFUND_STATUS_CHANGED','DISPUTE_STATUS_CHANGED','FULFILLMENT_STATUS_CHANGED','NOTIFICATION_REQUESTED','PAYMENT_CONFIG_PUBLISHED','PRICE_BOOK_PUBLISHED','INFORMATION_PAGE_PUBLICATION_CHANGED'));
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_aggregate_type_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_aggregate_type_check CHECK(aggregate_type IN('CART','CONTENT_PUBLICATION','ORDER','PAYMENT_ATTEMPT','REFUND','DISPUTE','FULFILLMENT','NOTIFICATION_DELIVERY','PAYMENT_CONFIG','PRICE_BOOK','INFORMATION_PAGE_PUBLICATION'));
DROP TRIGGER outbox_events_validate_trigger ON outbox_events;
CREATE TRIGGER outbox_events_validate_trigger BEFORE INSERT ON outbox_events FOR EACH ROW WHEN(NEW.event_type<>'INFORMATION_PAGE_PUBLICATION_CHANGED') EXECUTE FUNCTION validate_outbox_event_shape();
DROP TRIGGER outbox_events_authority_trigger ON outbox_events;
CREATE CONSTRAINT TRIGGER outbox_events_authority_trigger AFTER INSERT ON outbox_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.event_type<>'INFORMATION_PAGE_PUBLICATION_CHANGED') EXECUTE FUNCTION assert_outbox_event_authority();
DROP INDEX outbox_events_state_transition_unique_idx;
CREATE UNIQUE INDEX outbox_events_state_transition_unique_idx ON outbox_events(event_type,aggregate_type,aggregate_id,aggregate_version) WHERE event_type NOT IN('CONTENT_PUBLICATION_CHANGED','PAYMENT_CONFIG_PUBLISHED','PRICE_BOOK_PUBLISHED','INFORMATION_PAGE_PUBLICATION_CHANGED');
CREATE UNIQUE INDEX information_page_outbox_once ON outbox_events(aggregate_id,locale) WHERE event_type='INFORMATION_PAGE_PUBLICATION_CHANGED';
CREATE FUNCTION assert_information_page_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_page_publications p JOIN audit_logs a ON a.id=p.audit_log_id WHERE p.id=NEW.aggregate_id AND NEW.aggregate_type='INFORMATION_PAGE_PUBLICATION' AND NEW.primary_subject_id=p.id AND NEW.secondary_subject_id IS NULL AND NEW.aggregate_version=p.version AND NEW.locale IS NOT NULL AND NEW.market IS NULL AND NEW.currency IS NULL AND NEW.occurred_at=p.created_at AND NEW.available_at=p.created_at AND NEW.created_at=p.created_at AND NEW.request_id=p.request_id AND NEW.correlation_id=p.request_id AND NEW.causation_id IS NULL AND NEW.trace_id IS NULL AND a.actor_id=p.actor_id AND a.subject_id=p.id AND a.action='INFORMATION_PAGE_'||p.action) THEN RAISE EXCEPTION 'information outbox requires exact publication proof' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER information_page_outbox_proof AFTER INSERT ON outbox_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.event_type='INFORMATION_PAGE_PUBLICATION_CHANGED') EXECUTE FUNCTION assert_information_page_outbox();
CREATE FUNCTION assert_information_page_publication_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF(SELECT count(*) FROM outbox_events WHERE event_type='INFORMATION_PAGE_PUBLICATION_CHANGED' AND aggregate_id=NEW.id)<>7 OR NOT EXISTS(SELECT 1 FROM information_page_receipts WHERE audit_log_id=NEW.audit_log_id AND action=NEW.action AND actor_id=NEW.actor_id AND page_key=NEW.page_key) THEN RAISE EXCEPTION 'information publication requires seven locale events and atomic receipt' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER information_publication_complete AFTER INSERT ON information_page_publications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_information_page_publication_complete();
CREATE FUNCTION guard_information_page_dispatch_effect() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e outbox_events;
BEGIN
 SELECT * INTO e FROM outbox_events WHERE id=NEW.outbox_event_id;
 IF (NEW.consumer_key='information-page-publication') IS DISTINCT FROM (e.event_type='INFORMATION_PAGE_PUBLICATION_CHANGED') THEN RAISE EXCEPTION 'information dispatch consumer must match event family' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='outbox_effect_receipts' THEN
 IF e.event_type='INFORMATION_PAGE_PUBLICATION_CHANGED' AND (NEW.effect_key<>'INFORMATION_PAGE_PUBLICATION_OBSERVED' OR NEW.subject_id<>e.primary_subject_id) THEN RAISE EXCEPTION 'information effect requires exact publication subject' USING ERRCODE='23514';END IF; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER information_page_effect_guard BEFORE INSERT ON outbox_effect_receipts FOR EACH ROW EXECUTE FUNCTION guard_information_page_dispatch_effect();
CREATE TRIGGER information_page_attempt_guard BEFORE INSERT ON outbox_dispatch_attempts FOR EACH ROW EXECUTE FUNCTION guard_information_page_dispatch_effect();

CREATE FUNCTION assert_information_page_head_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_page_receipts r WHERE r.page_key=NEW.page_key AND (r.response#>>'{workspace,version}')::bigint=NEW.version AND r.created_at=NEW.updated_at AND (r.response#>>'{workspace,draft,revisionId}')::uuid IS NOT DISTINCT FROM NEW.draft_revision_id AND (r.response#>>'{workspace,published,publicationId}')::uuid IS NOT DISTINCT FROM NEW.published_publication_id) THEN RAISE EXCEPTION 'information head requires matching atomic receipt' USING ERRCODE='23514';END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER information_head_receipt AFTER UPDATE ON information_page_heads DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_information_page_head_receipt();
CREATE FUNCTION guard_information_page_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM audit_logs a JOIN admin_sessions s ON s.id=NEW.session_id WHERE a.id=NEW.audit_log_id AND a.actor_id=NEW.actor_id AND a.actor_type='ADMIN' AND a.action='INFORMATION_PAGE_'||NEW.action AND a.subject_type='INFORMATION_PAGE' AND a.outcome='SUCCEEDED' AND a.created_at=NEW.created_at AND a.request_id=NEW.request_id AND s.admin_identity_id=NEW.actor_id AND s.authenticated_with_mfa AND s.created_at<=NEW.created_at AND s.expires_at>NEW.created_at AND(s.revoked_at IS NULL OR s.revoked_at>NEW.created_at)) OR NEW.response#>>'{workspace,pageKey}' IS DISTINCT FROM NEW.page_key THEN RAISE EXCEPTION 'information receipt requires exact audit and session proof' USING ERRCODE='23514';END IF; RETURN NEW;
END $$;
CREATE TRIGGER information_receipt_validate BEFORE INSERT ON information_page_receipts FOR EACH ROW EXECUTE FUNCTION guard_information_page_receipt();
