SET search_path = public;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.price_book_publications)
     OR EXISTS (
       SELECT 1 FROM public.outbox_events
       WHERE event_type = 'PRICE_BOOK_PUBLISHED'
     ) THEN
    RAISE EXCEPTION 'migration 0006 cannot be reverted after price-book publication history exists'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DROP TRIGGER publication_outbox_source_consistency_trigger ON public.outbox_events;

DROP TRIGGER config_versions_publication_head_consistency_trigger ON public.config_versions;
DROP TRIGGER payment_config_publications_head_consistency_trigger
  ON public.payment_config_publications;

DROP TRIGGER price_books_publication_head_consistency_trigger ON public.price_books;
DROP TRIGGER price_book_publications_head_consistency_trigger
  ON public.price_book_publications;

DROP TRIGGER site_locale_revisions_publication_head_consistency_trigger
  ON public.site_locale_config_revisions;
DROP TRIGGER media_metadata_revisions_publication_head_consistency_trigger
  ON public.media_metadata_revisions;
DROP TRIGGER policy_revisions_publication_head_consistency_trigger
  ON public.policy_revisions;
DROP TRIGGER homepage_revisions_publication_head_consistency_trigger
  ON public.homepage_revisions;
DROP TRIGGER gift_revisions_publication_head_consistency_trigger
  ON public.gift_revisions;
DROP TRIGGER idol_revisions_publication_head_consistency_trigger
  ON public.idol_revisions;
DROP TRIGGER gifts_publication_head_consistency_trigger ON public.gifts;
DROP TRIGGER idols_publication_head_consistency_trigger ON public.idols;
DROP TRIGGER content_publications_head_consistency_trigger
  ON public.content_publications;

DROP TABLE public.payment_config_publication_heads;
DROP TABLE public.price_book_publication_heads;
DROP TABLE public.price_book_publications;
DROP TABLE public.site_locale_config_publication_heads;
DROP TABLE public.media_metadata_publication_heads;
DROP TABLE public.policy_publication_heads;
DROP TABLE public.homepage_publication_heads;
DROP TABLE public.gift_publication_heads;
DROP TABLE public.idol_publication_heads;

DROP FUNCTION public.assert_publication_outbox_source();
DROP FUNCTION public.assert_payment_config_publication_heads();
DROP FUNCTION public.assert_price_book_publication_heads();
DROP FUNCTION public.assert_content_publication_heads();
DROP FUNCTION public.guard_publication_head_transition();

DROP INDEX public.payment_config_publications_root_unique;
DROP INDEX public.content_publications_site_locale_root_unique;
DROP INDEX public.content_publications_media_root_unique;
DROP INDEX public.content_publications_policy_root_unique;
DROP INDEX public.content_publications_homepage_root_unique;
DROP INDEX public.content_publications_gift_root_unique;
DROP INDEX public.content_publications_idol_root_unique;
DROP INDEX public.outbox_noncontent_publication_source_unique;
DROP INDEX public.outbox_content_publication_locale_unique;

ALTER TABLE public.content_publications
  DROP CONSTRAINT content_publications_audit_log_unique,
  DROP CONSTRAINT content_publications_audit_log_fk;
ALTER TABLE public.content_publications DROP COLUMN audit_log_id;

ALTER TABLE public.outbox_events
  DROP CONSTRAINT outbox_events_event_type_check,
  ADD CONSTRAINT outbox_events_event_type_check CHECK (
    event_type IN (
      'CART_ITEM_ADDED', 'CONTENT_PUBLICATION_CHANGED', 'PAYMENT_STATUS_CHANGED',
      'ORDER_PAYMENT_CONFIRMED', 'REFUND_STATUS_CHANGED', 'DISPUTE_STATUS_CHANGED',
      'FULFILLMENT_STATUS_CHANGED', 'NOTIFICATION_REQUESTED',
      'PAYMENT_CONFIG_PUBLISHED'
    )
  ),
  DROP CONSTRAINT outbox_events_aggregate_type_check,
  ADD CONSTRAINT outbox_events_aggregate_type_check CHECK (
    aggregate_type IN (
      'CART', 'CONTENT_PUBLICATION', 'ORDER', 'PAYMENT_ATTEMPT', 'REFUND',
      'DISPUTE', 'FULFILLMENT', 'NOTIFICATION_DELIVERY', 'PAYMENT_CONFIG'
    )
  );
