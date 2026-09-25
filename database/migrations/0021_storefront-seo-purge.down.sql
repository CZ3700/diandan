-- Stop creating expanded root jobs after rollback. Existing expanded jobs retain
-- their unchanged transitions and exact failed-predecessor retry capability.
CREATE OR REPLACE FUNCTION public.guard_content_purge_job() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE publication public.content_publications%ROWTYPE; event public.outbox_events%ROWTYPE;
  parent public.content_purge_jobs%ROWTYPE; root text; expected_paths text[]; expanded_paths text[]; actual_now timestamptz:=clock_timestamp();
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO publication FROM public.content_publications WHERE id=NEW.publication_id;
    SELECT * INTO event FROM public.outbox_events WHERE id=NEW.outbox_event_id;
    root:='/'||NEW.locale::text;
    expected_paths:=CASE publication.content_type
      WHEN 'HOMEPAGE' THEN ARRAY[root,root||'/sitemap.xml']
      WHEN 'POLICY' THEN ARRAY[root||'/policies/'||publication.policy_key||'*',root||'/sitemap.xml']
      WHEN 'MEDIA_METADATA' THEN ARRAY[root,root||'/gifts*',root||'/idols*',root||'/media/'||publication.media_asset_id::text||'*',root||'/sitemap.xml']
      ELSE ARRAY[root,root||'/gifts*',root||'/idols*',root||'/sitemap.xml'] END;
    SELECT array_agg(path ORDER BY path COLLATE "C") INTO expanded_paths
      FROM unnest(expected_paths||ARRAY['/sitemap.xml*',root||'/sitemap.xml*','/api/v1/storefront-seo/*']) AS paths(path);
    IF publication.id IS NULL OR publication.proof_version<>2 OR event.id IS NULL
      OR event.event_type IS DISTINCT FROM 'CONTENT_PUBLICATION_CHANGED'
      OR event.aggregate_type IS DISTINCT FROM 'CONTENT_PUBLICATION'
      OR event.aggregate_id IS DISTINCT FROM NEW.publication_id
      OR event.primary_subject_id IS DISTINCT FROM NEW.publication_id OR event.locale IS DISTINCT FROM NEW.locale
      OR (NEW.paths IS DISTINCT FROM expected_paths AND NEW.paths IS DISTINCT FROM expanded_paths) OR NEW.status<>'PENDING' OR NEW.version<>1 OR NEW.attempt_count<>0 OR NEW.failure_count<>0
      OR NEW.lease_token IS NOT NULL OR NEW.purge_reference IS NOT NULL OR NEW.error_code IS NOT NULL
      OR NEW.completed_at IS NOT NULL OR NEW.updated_at<>NEW.created_at OR NEW.next_attempt_at IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION 'purge jobs require exact publication locale paths and initial state' USING ERRCODE='23514';
    END IF;
    IF NEW.generation=1 THEN
      IF NEW.paths IS DISTINCT FROM expected_paths THEN RAISE EXCEPTION 'root purge jobs require legacy paths after rollback' USING ERRCODE='23514'; END IF;
      IF NEW.created_at<>publication.published_at THEN RAISE EXCEPTION 'root purge job must share publication time' USING ERRCODE='23514'; END IF;
    ELSE
      SELECT * INTO parent FROM public.content_purge_jobs WHERE id=NEW.retry_of FOR UPDATE;
      IF parent.id IS NULL OR parent.status<>'FAILED' OR NEW.generation<>parent.generation+1
        OR NEW.publication_id<>parent.publication_id OR NEW.outbox_event_id<>parent.outbox_event_id
        OR NEW.locale<>parent.locale OR NEW.paths IS DISTINCT FROM parent.paths OR NEW.created_at<parent.updated_at THEN
        RAISE EXCEPTION 'purge retries require an exact failed predecessor' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','version','attempt_count','failure_count','lease_token','lease_expires_at','purge_reference','error_code','updated_at','next_attempt_at','completed_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','attempt_count','failure_count','lease_token','lease_expires_at','purge_reference','error_code','updated_at','next_attempt_at','completed_at'])
    OR OLD.status IN ('COMPLETED','FAILED') OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at
    OR NEW.updated_at>GREATEST(actual_now,transaction_timestamp(),OLD.updated_at) THEN
    RAISE EXCEPTION 'purge identity is immutable and transitions require one causal version' USING ERRCODE='23514';
  END IF;
  IF NEW.lease_token IS NOT NULL THEN
    IF (OLD.lease_expires_at IS NOT NULL AND OLD.lease_expires_at>actual_now) OR OLD.next_attempt_at>actual_now
      OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token OR NEW.lease_expires_at<=actual_now
      OR NEW.lease_expires_at>actual_now+interval '300 seconds' OR NEW.lease_expires_at>OLD.created_at+interval '10 minutes'
      OR NEW.attempt_count<>OLD.attempt_count+1 OR NEW.failure_count<>OLD.failure_count OR NEW.status<>OLD.status
      OR NEW.next_attempt_at IS DISTINCT FROM OLD.next_attempt_at OR NEW.purge_reference IS DISTINCT FROM OLD.purge_reference
      OR NEW.error_code IS DISTINCT FROM OLD.error_code OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'purge claims require a due job and bounded fresh lease' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.attempt_count<>OLD.attempt_count OR NEW.lease_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'purge results cannot change claim count' USING ERRCODE='23514';
    END IF;
    IF NEW.status='FAILED' AND NEW.error_code IS NULL THEN
      RAISE EXCEPTION 'failed purge jobs require a safe failure code' USING ERRCODE='23514';
    END IF;
    IF NEW.error_code='PURGE_TIMEOUT' AND NEW.status<>'FAILED' THEN
      RAISE EXCEPTION 'absolute purge timeout must be terminal' USING ERRCODE='23514';
    END IF;
    IF NEW.status='FAILED' AND NEW.error_code='PURGE_TIMEOUT' THEN
      IF actual_now<OLD.created_at+interval '10 minutes' OR NEW.failure_count<>OLD.failure_count
        OR NEW.purge_reference IS DISTINCT FROM OLD.purge_reference THEN
        RAISE EXCEPTION 'purge timeout requires the absolute deadline' USING ERRCODE='23514';
      END IF;
    ELSIF OLD.lease_token IS NULL OR OLD.lease_expires_at<=actual_now THEN
      RAISE EXCEPTION 'purge results require a current unexpired claim' USING ERRCODE='23514';
    END IF;
    IF NEW.status='COMPLETED' THEN
      IF NEW.completed_at IS DISTINCT FROM NEW.updated_at OR NEW.purge_reference IS NULL OR NEW.error_code IS NOT NULL
        OR NEW.failure_count<>OLD.failure_count OR (OLD.purge_reference IS NOT NULL AND NEW.purge_reference<>OLD.purge_reference) THEN
        RAISE EXCEPTION 'purge completion requires the same provider reference' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.error_code IS NOT NULL AND NEW.error_code<>'PURGE_TIMEOUT' THEN
      IF NEW.failure_count<>OLD.failure_count+1 OR NEW.purge_reference IS DISTINCT FROM OLD.purge_reference
        OR NEW.status NOT IN (OLD.status,'FAILED') OR (NEW.failure_count>=6 AND NEW.status<>'FAILED') THEN
        RAISE EXCEPTION 'purge failure must preserve provider identity and bounded retries' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.status<>'FAILED' THEN
      IF NEW.status<>'SUBMITTED' OR NEW.purge_reference IS NULL OR NEW.failure_count<>OLD.failure_count
        OR (OLD.purge_reference IS NOT NULL AND NEW.purge_reference<>OLD.purge_reference) THEN
        RAISE EXCEPTION 'pending provider work must remain submitted' USING ERRCODE='23514';
      END IF;
    END IF;
    IF NEW.next_attempt_at IS NOT NULL AND NEW.next_attempt_at>OLD.created_at+interval '10 minutes' THEN
      RAISE EXCEPTION 'purge retry schedule cannot extend the absolute deadline' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
