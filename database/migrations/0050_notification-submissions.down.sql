SET search_path=public;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM notification_submissions) THEN RAISE EXCEPTION 'cannot discard native mail admission history; retain schema and forward-fix' USING ERRCODE='55000'; END IF;END $$;
CREATE OR REPLACE FUNCTION guard_notification_delivery_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.status <> 'REQUESTED' OR NEW.attempt_count <> 0 THEN
      RAISE EXCEPTION 'notification delivery must start REQUESTED with zero attempts'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'notification delivery version must increment exactly once'
      USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW)
        - 'status' - 'attempt_count' - 'next_attempt_at' - 'sent_at'
        - 'last_error_code' - 'version' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(OLD)
        - 'status' - 'attempt_count' - 'next_attempt_at' - 'sent_at'
        - 'last_error_code' - 'version' - 'updated_at') THEN
    RAISE EXCEPTION 'notification order, locale, template, and idempotency identity are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'REQUESTED' AND NEW.status IN ('PROCESSING', 'CANCELED'))
    OR (OLD.status = 'PROCESSING' AND NEW.status IN ('SENT', 'RETRY_SCHEDULED', 'FAILED'))
    OR (OLD.status = 'RETRY_SCHEDULED' AND NEW.status IN ('PROCESSING', 'CANCELED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'invalid notification delivery transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'PROCESSING' AND NEW.status IN ('SENT', 'RETRY_SCHEDULED', 'FAILED') THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1 THEN
      RAISE EXCEPTION 'completed notification attempt must increment attempt count once'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.attempt_count <> OLD.attempt_count THEN
    RAISE EXCEPTION 'notification attempt count may change only after processing'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION assert_notification_attempt_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_delivery_id uuid;
  delivery notification_deliveries%ROWTYPE;
  actual_count bigint;
  latest_outcome text;
BEGIN
  target_delivery_id := COALESCE(
    (to_jsonb(NEW) ->> 'notification_delivery_id')::uuid,
    (to_jsonb(OLD) ->> 'notification_delivery_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid,
    (to_jsonb(OLD) ->> 'id')::uuid
  );

  SELECT * INTO delivery FROM notification_deliveries WHERE id = target_delivery_id;
  IF delivery.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO actual_count
  FROM notification_delivery_attempts
  WHERE notification_delivery_id = target_delivery_id;
  SELECT outcome INTO latest_outcome
  FROM notification_delivery_attempts
  WHERE notification_delivery_id = target_delivery_id
  ORDER BY sequence DESC
  LIMIT 1;

  IF actual_count <> delivery.attempt_count
     OR (delivery.status = 'SENT' AND latest_outcome IS DISTINCT FROM 'SUCCEEDED')
     OR (delivery.status IN ('RETRY_SCHEDULED', 'FAILED')
       AND latest_outcome NOT IN ('FAILED', 'UNKNOWN')) THEN
    RAISE EXCEPTION 'notification delivery and append-only attempts diverge'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_admin_notification_resend() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'REQUESTED' OR NEW.version<>1 OR NEW.attempt_count<>0 OR NEW.generation<>0 OR NEW.link_token_id IS NOT NULL OR NEW.content_hash IS NOT NULL THEN
   RAISE EXCEPTION 'resend must start as a fresh dispatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.notification_deliveries d JOIN public.notification_runtime_state r ON r.notification_delivery_id=d.id
    JOIN public.orders o ON o.id=d.order_id JOIN public.admin_sessions s ON s.id=NEW.session_id
    JOIN public.admin_identities actor ON actor.id=s.admin_identity_id
    JOIN public.audit_logs a ON a.id=NEW.audit_log_id
    WHERE d.id=NEW.base_notification_id AND d.order_id=NEW.order_id AND d.customer_contact_id=NEW.customer_contact_id
    AND d.status IN('SENT','FAILED','CANCELED') AND NEW.event_type=public.admin_notification_current_event(o.id)
    AND o.version=NEW.order_version AND NEW.event_type=d.event_type AND NEW.event_rank=r.event_rank
    AND NEW.source_outbox_event_id=r.source_outbox_event_id AND NEW.base_variables=r.base_variables
    AND (NEW.requested_locale,NEW.resolved_locale,NEW.fallback_used,NEW.template_key,NEW.template_version)
      =(d.requested_locale,d.resolved_locale,d.fallback_used,d.template_key,d.template_version)
    AND NEW.public_storefront_origin=r.public_storefront_origin AND NEW.transport_key=r.transport_key
    AND NEW.contact_lookup_hmac=r.contact_lookup_hmac AND NEW.contact_lookup_key_version=r.contact_lookup_key_version
    AND NEW.link_pepper_version=r.link_pepper_version AND NEW.link_ttl_seconds=r.link_ttl_seconds
    AND NEW.fallback_reason_code IS NOT DISTINCT FROM r.fallback_reason_code
    AND NEW.dedupe_until-NEW.created_at=r.dedupe_until-r.created_at
    AND NEW.link_nonce<>r.link_nonce AND NEW.idempotency_key<>d.idempotency_key
    AND s.admin_identity_id=NEW.actor_id AND actor.status='ACTIVE' AND s.revoked_at IS NULL
    AND s.authenticated_with_mfa AND s.expires_at>clock_timestamp() AND s.created_at<=clock_timestamp()
    AND a.actor_type='ADMIN' AND a.actor_id=NEW.actor_id AND a.action='RESEND_ORDER_NOTIFICATION' AND a.subject_type='ORDER'
    AND a.subject_id=NEW.order_id AND a.reason_code=NEW.reason_code AND a.outcome='SUCCEEDED'
    AND a.request_id=NEW.request_id AND a.correlation_id=NEW.correlation_id AND a.created_at=NEW.created_at
    AND (SELECT count(DISTINCT p.permission_key) FROM public.admin_identity_roles ar JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id WHERE ar.admin_identity_id=NEW.actor_id AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp() AND p.permission_key IN('orders.read','orders.notification.resend'))=2
    AND EXISTS(SELECT 1 FROM public.notification_source_authority(r.source_outbox_event_id) authority WHERE authority.order_id=o.id AND authority.event_type=NEW.event_type)
  ) THEN RAISE EXCEPTION 'resend requires current order, canonical snapshot and authorized audit' USING ERRCODE='23514'; END IF;
  IF NEW.resend_sequence<>(SELECT coalesce(max(resend_sequence),0)+1 FROM public.admin_notification_resends WHERE order_id=NEW.order_id)
    OR EXISTS(SELECT 1 FROM public.notification_deliveries WHERE order_id=NEW.order_id AND status IN('REQUESTED','PROCESSING','RETRY_SCHEDULED'))
    OR EXISTS(SELECT 1 FROM public.admin_notification_resends WHERE order_id=NEW.order_id AND created_at>NEW.created_at-interval '60 seconds')
    OR EXISTS(SELECT 1 FROM public.notification_delivery_attempts a JOIN public.notification_deliveries d ON d.id=a.notification_delivery_id WHERE d.order_id=NEW.order_id AND d.status<>'SENT' AND a.outcome='UNKNOWN')
    OR EXISTS(SELECT 1 FROM public.admin_notification_resend_attempts a JOIN public.admin_notification_resends d ON d.id=a.resend_id WHERE d.order_id=NEW.order_id AND d.status<>'SENT' AND a.outcome='UNKNOWN')
  THEN RAISE EXCEPTION 'resend cannot bypass pending, unknown or throttled dispatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR OLD.status IN('SENT','FAILED','CANCELED')
 OR (to_jsonb(NEW)-ARRAY['status','attempt_count','next_attempt_at','sent_at','last_error_code','lease_token','lease_expires_at','lease_started_at','generation','version','updated_at','link_token_id','content_hash'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempt_count','next_attempt_at','sent_at','last_error_code','lease_token','lease_expires_at','lease_started_at','generation','version','updated_at','link_token_id','content_hash'])
 OR (OLD.link_token_id IS NOT NULL AND NEW.link_token_id IS DISTINCT FROM OLD.link_token_id)
 OR (OLD.content_hash IS NOT NULL AND NEW.content_hash IS DISTINCT FROM OLD.content_hash)
 THEN RAISE EXCEPTION 'resend snapshot and terminal history are immutable' USING ERRCODE='55000'; END IF;
 IF OLD.status IN('REQUESTED','RETRY_SCHEDULED') AND NEW.status='PROCESSING' THEN
  IF NEW.generation<>OLD.generation+1 OR NEW.attempt_count<>OLD.attempt_count THEN RAISE EXCEPTION 'resend lease must fence claims' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='PROCESSING' AND NEW.status IN('SENT','FAILED','RETRY_SCHEDULED') THEN
  IF NEW.attempt_count<>OLD.attempt_count+1 OR NEW.generation<>OLD.generation THEN RAISE EXCEPTION 'resend completion requires one attempt' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='PROCESSING' AND NEW.status='PROCESSING' THEN
  IF (NEW.lease_token,NEW.generation,NEW.attempt_count,NEW.lease_started_at,NEW.lease_expires_at) IS DISTINCT FROM (OLD.lease_token,OLD.generation,OLD.attempt_count,OLD.lease_started_at,OLD.lease_expires_at) THEN RAISE EXCEPTION 'resend metadata cannot replace lease' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status IN('REQUESTED','RETRY_SCHEDULED') AND NEW.status='CANCELED' THEN
  IF NEW.attempt_count<>OLD.attempt_count OR NEW.generation<>OLD.generation THEN RAISE EXCEPTION 'resend cancellation cannot rewrite attempts' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'invalid resend transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.assert_admin_notification_resend() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target uuid; dispatch public.admin_notification_resends%ROWTYPE; attempts bigint; last_outcome text;
BEGIN
 target:=coalesce((to_jsonb(NEW)->>'resend_id')::uuid,(to_jsonb(NEW)->>'id')::uuid);
 SELECT * INTO dispatch FROM public.admin_notification_resends WHERE id=target;
 SELECT count(*) INTO attempts FROM public.admin_notification_resend_attempts WHERE resend_id=target;
 SELECT outcome INTO last_outcome FROM public.admin_notification_resend_attempts WHERE resend_id=target ORDER BY sequence DESC LIMIT 1;
 IF dispatch.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.admin_notification_resend_outbox q WHERE q.resend_id=target AND q.created_at=dispatch.created_at)
 OR attempts<>dispatch.attempt_count
 OR (attempts>0 AND (SELECT max(sequence) FROM public.admin_notification_resend_attempts WHERE resend_id=target)<>attempts)
 OR (dispatch.status='SENT' AND last_outcome IS DISTINCT FROM 'SUCCEEDED')
 OR (dispatch.status IN('FAILED','RETRY_SCHEDULED') AND last_outcome IS DISTINCT FROM 'FAILED' AND last_outcome IS DISTINCT FROM 'UNKNOWN')
 OR (dispatch.link_token_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.order_access_tokens t WHERE t.id=dispatch.link_token_id AND t.order_id=dispatch.order_id AND t.purpose='LINK' AND t.token_pepper_version=dispatch.link_pepper_version))
 THEN RAISE EXCEPTION 'resend queue, link and attempts must agree' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
DROP FUNCTION notification_submission_recoverable(uuid);
DROP FUNCTION notification_submission_accepted(uuid);
DROP FUNCTION notification_submission_definite(uuid);
DROP TRIGGER admin_resend_native_submission_guard ON admin_notification_resends;
DROP FUNCTION guard_admin_resend_native_submission();
DROP FUNCTION notification_submission_unresolved(uuid,uuid);
DROP TABLE notification_submissions;
DROP FUNCTION guard_notification_submission();
DROP FUNCTION valid_notification_submission_result(jsonb);
