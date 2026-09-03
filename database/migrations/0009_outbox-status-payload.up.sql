-- State-change envelopes cannot be reconstructed from a mutable aggregate head.
-- Persist only the bounded status discriminator; all other payload fields remain
-- derivable from normalized outbox columns and authoritative identifiers.
LOCK TABLE public.outbox_events, public.payment_attempt_events, public.refund_events, public.dispute_events, public.fulfillment_events IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.outbox_events
  ADD COLUMN payload_status text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.outbox_events outbox
    WHERE (outbox.event_type = 'PAYMENT_STATUS_CHANGED' AND NOT EXISTS (
      SELECT 1
      FROM public.payment_attempt_events event
      WHERE event.payment_attempt_id = outbox.aggregate_id
        AND event.sequence = outbox.aggregate_version
    )) OR (outbox.event_type = 'REFUND_STATUS_CHANGED' AND NOT EXISTS (
      SELECT 1
      FROM public.refund_events event
      WHERE event.refund_id = outbox.aggregate_id
        AND event.sequence = outbox.aggregate_version
    )) OR (outbox.event_type = 'DISPUTE_STATUS_CHANGED' AND NOT EXISTS (
      SELECT 1
      FROM public.dispute_events event
      WHERE event.dispute_id = outbox.aggregate_id
        AND event.sequence = outbox.aggregate_version
    )) OR (outbox.event_type = 'FULFILLMENT_STATUS_CHANGED' AND NOT EXISTS (
      SELECT 1
      FROM public.fulfillment_events event
      WHERE event.fulfillment_id = outbox.aggregate_id
        AND event.sequence = outbox.aggregate_version
    ))
  ) THEN
    RAISE EXCEPTION 'migration 0009 cannot backfill an outbox status without authoritative event history'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public.outbox_events
  DISABLE TRIGGER outbox_events_append_only_trigger;

UPDATE public.outbox_events outbox
SET payload_status = CASE outbox.event_type
  WHEN 'PAYMENT_STATUS_CHANGED' THEN (
    SELECT event.to_status
    FROM public.payment_attempt_events event
    WHERE event.payment_attempt_id = outbox.aggregate_id
      AND event.sequence = outbox.aggregate_version
  )
  WHEN 'REFUND_STATUS_CHANGED' THEN (
    SELECT event.to_status
    FROM public.refund_events event
    WHERE event.refund_id = outbox.aggregate_id
      AND event.sequence = outbox.aggregate_version
  )
  WHEN 'DISPUTE_STATUS_CHANGED' THEN (
    SELECT event.to_status
    FROM public.dispute_events event
    WHERE event.dispute_id = outbox.aggregate_id
      AND event.sequence = outbox.aggregate_version
  )
  WHEN 'FULFILLMENT_STATUS_CHANGED' THEN (
    SELECT event.to_status
    FROM public.fulfillment_events event
    WHERE event.fulfillment_id = outbox.aggregate_id
      AND event.sequence = outbox.aggregate_version
  )
END
WHERE outbox.event_type IN (
  'PAYMENT_STATUS_CHANGED',
  'REFUND_STATUS_CHANGED',
  'DISPUTE_STATUS_CHANGED',
  'FULFILLMENT_STATUS_CHANGED'
);

ALTER TABLE public.outbox_events
  ENABLE TRIGGER outbox_events_append_only_trigger;

ALTER TABLE public.outbox_events
  ADD CONSTRAINT outbox_events_payload_status_check CHECK (
    (event_type = 'PAYMENT_STATUS_CHANGED'
      AND payload_status IS NOT NULL
      AND payload_status IN (
        'CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED',
        'CANCELED', 'EXPIRED', 'UNKNOWN'
      ))
    OR (event_type = 'REFUND_STATUS_CHANGED'
      AND payload_status IS NOT NULL
      AND payload_status IN (
        'REQUESTED', 'SUBMITTING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'
      ))
    OR (event_type = 'DISPUTE_STATUS_CHANGED'
      AND payload_status IS NOT NULL
      AND payload_status IN ('NONE', 'OPEN', 'WON', 'LOST'))
    OR (event_type = 'FULFILLMENT_STATUS_CHANGED'
      AND payload_status IS NOT NULL
      AND payload_status IN ('PENDING', 'PREPARING', 'DELIVERED', 'ON_HOLD', 'CANCELED'))
    OR (event_type NOT IN (
      'PAYMENT_STATUS_CHANGED',
      'REFUND_STATUS_CHANGED',
      'DISPUTE_STATUS_CHANGED',
      'FULFILLMENT_STATUS_CHANGED'
    ) AND payload_status IS NULL)
  );

-- During a rolling deploy, the pre-0009 writer does not know this projection
-- column. Derive it from immutable event history before constraints run. The
-- new writer also omits the column, so the same path remains authoritative.
CREATE FUNCTION public.derive_outbox_payload_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.payload_status IS NULL THEN
    CASE NEW.event_type
      WHEN 'PAYMENT_STATUS_CHANGED' THEN
        SELECT event.to_status INTO NEW.payload_status
        FROM public.payment_attempt_events event
        WHERE event.payment_attempt_id = NEW.aggregate_id
          AND event.sequence = NEW.aggregate_version;
      WHEN 'REFUND_STATUS_CHANGED' THEN
        SELECT event.to_status INTO NEW.payload_status
        FROM public.refund_events event
        WHERE event.refund_id = NEW.aggregate_id
          AND event.sequence = NEW.aggregate_version;
      WHEN 'DISPUTE_STATUS_CHANGED' THEN
        SELECT event.to_status INTO NEW.payload_status
        FROM public.dispute_events event
        WHERE event.dispute_id = NEW.aggregate_id
          AND event.sequence = NEW.aggregate_version;
      WHEN 'FULFILLMENT_STATUS_CHANGED' THEN
        SELECT event.to_status INTO NEW.payload_status
        FROM public.fulfillment_events event
        WHERE event.fulfillment_id = NEW.aggregate_id
          AND event.sequence = NEW.aggregate_version;
      ELSE
        NULL;
    END CASE;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_payload_status_derivation_trigger
  BEFORE INSERT ON public.outbox_events
  FOR EACH ROW EXECUTE FUNCTION public.derive_outbox_payload_status();

CREATE FUNCTION public.assert_outbox_payload_status_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  source_count integer;
BEGIN
  CASE NEW.event_type
    WHEN 'PAYMENT_STATUS_CHANGED' THEN
      SELECT count(*) INTO source_count
      FROM public.payment_attempt_events event
      WHERE event.payment_attempt_id = NEW.aggregate_id
        AND event.sequence = NEW.aggregate_version
        AND event.to_status = NEW.payload_status;
    WHEN 'REFUND_STATUS_CHANGED' THEN
      SELECT count(*) INTO source_count
      FROM public.refund_events event
      WHERE event.refund_id = NEW.aggregate_id
        AND event.sequence = NEW.aggregate_version
        AND event.to_status = NEW.payload_status;
    WHEN 'DISPUTE_STATUS_CHANGED' THEN
      SELECT count(*) INTO source_count
      FROM public.dispute_events event
      WHERE event.dispute_id = NEW.aggregate_id
        AND event.sequence = NEW.aggregate_version
        AND event.to_status = NEW.payload_status;
    WHEN 'FULFILLMENT_STATUS_CHANGED' THEN
      SELECT count(*) INTO source_count
      FROM public.fulfillment_events event
      WHERE event.fulfillment_id = NEW.aggregate_id
        AND event.sequence = NEW.aggregate_version
        AND event.to_status = NEW.payload_status;
    ELSE
      RETURN NULL;
  END CASE;

  IF source_count <> 1 THEN
    RAISE EXCEPTION 'outbox payload status has no exact authoritative event'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER outbox_payload_status_authority_trigger
  AFTER INSERT ON public.outbox_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_outbox_payload_status_authority();
