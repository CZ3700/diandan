-- The status is reconstructable from immutable aggregate event history, so the
-- rollback only removes the typed replay projection introduced by 0009.
LOCK TABLE public.outbox_events IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER outbox_payload_status_derivation_trigger
  ON public.outbox_events;
DROP TRIGGER outbox_payload_status_authority_trigger
  ON public.outbox_events;
DROP FUNCTION public.derive_outbox_payload_status();
DROP FUNCTION public.assert_outbox_payload_status_authority();

ALTER TABLE public.outbox_events
  DROP CONSTRAINT outbox_events_payload_status_check,
  DROP COLUMN payload_status;
