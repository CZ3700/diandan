-- Drafts and their review records are editorial history, not disposable projections.
LOCK TABLE public.idol_revision_alias_sets, public.idol_revision_aliases, public.idol_revision_alias_reviews,
  public.gift_detail_documents, public.gift_detail_blocks, public.gift_detail_block_items,
  public.gift_detail_translations, public.gift_detail_translation_blocks, public.gift_detail_translation_items,
  public.gift_detail_translation_reviews IN ACCESS EXCLUSIVE MODE;
DO $$ DECLARE table_name text; occupied boolean; BEGIN
  FOREACH table_name IN ARRAY ARRAY['idol_revision_alias_sets','idol_revision_aliases','idol_revision_alias_reviews','gift_detail_documents','gift_detail_blocks','gift_detail_block_items','gift_detail_translations','gift_detail_translation_blocks','gift_detail_translation_items','gift_detail_translation_reviews'] LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I)',table_name) INTO occupied;
    IF occupied THEN RAISE EXCEPTION 'content draft history prevents rollback' USING ERRCODE = '55000'; END IF;
  END LOOP;
END; $$;
DROP TRIGGER idol_extension_publication_block ON public.idol_revisions;
DROP TRIGGER gift_extension_publication_block ON public.gift_revisions;
DROP TRIGGER content_extension_publication_block ON public.content_publications;
DROP TABLE public.gift_detail_translation_reviews;
DROP TABLE public.gift_detail_translation_items;
DROP TABLE public.gift_detail_translation_blocks;
DROP TABLE public.gift_detail_translations;
DROP TABLE public.gift_detail_block_items;
DROP TABLE public.gift_detail_blocks;
DROP TABLE public.gift_detail_documents;
DROP TABLE public.idol_revision_alias_reviews;
DROP TABLE public.idol_revision_aliases;
DROP TABLE public.idol_revision_alias_sets;
DROP FUNCTION public.guard_content_draft_insert();
DROP FUNCTION public.assert_content_draft_audit(uuid,uuid,uuid,text,text,uuid,timestamptz);
DROP FUNCTION public.assert_idol_alias_draft();
DROP FUNCTION public.assert_gift_detail_draft();
DROP FUNCTION public.validate_idol_alias_review();
DROP FUNCTION public.assert_content_extension_review_audit();
DROP FUNCTION public.block_content_extension_publication();
