SET search_path = public;

DROP TABLE inventory_balances;
DROP TABLE inventory_items;
DROP TABLE inventory_locations;

DROP TABLE prices;
DROP TABLE price_books;
DROP TABLE markets;

DROP TABLE slug_redirects;
DROP TABLE content_publications;

DROP TABLE site_locale_config_entries;
DROP TABLE site_locale_config_revisions;

DROP TABLE policy_translation_reviews;
DROP TABLE policy_revision_translations;
DROP TABLE policy_revisions;

DROP TABLE homepage_slot_translations;
DROP TABLE homepage_slots;
DROP TABLE homepage_translation_reviews;
DROP TABLE homepage_revision_translations;
DROP TABLE homepage_revisions;

ALTER TABLE gifts DROP CONSTRAINT gifts_published_revision_owner_fk;
ALTER TABLE gifts DROP CONSTRAINT gifts_draft_revision_owner_fk;
DROP TABLE gift_revision_media;
DROP TABLE gift_variant_labels;
DROP TABLE gift_translation_reviews;
DROP TABLE gift_revision_translations;
DROP TABLE gift_variant_idol_eligibility;
DROP TABLE gift_variants;
DROP TABLE gift_revision_contents;
DROP TABLE gift_revisions;
DROP TABLE gifts;
DROP TABLE policies;

ALTER TABLE idols DROP CONSTRAINT idols_published_revision_owner_fk;
ALTER TABLE idols DROP CONSTRAINT idols_draft_revision_owner_fk;
DROP TABLE idol_revision_media;
DROP TABLE idol_translation_reviews;
DROP TABLE idol_revision_translations;
DROP TABLE idol_revisions;
DROP TABLE idols;

DROP TABLE media_metadata_translation_reviews;
DROP TABLE media_metadata_revision_translations;
DROP TABLE media_metadata_revisions;
DROP TABLE media_variants;
DROP TABLE media_assets;

DROP FUNCTION assert_inventory_item_variant_consistency();
DROP FUNCTION assert_price_book_publication();
DROP FUNCTION validate_content_publication();
DROP FUNCTION validate_price_parent_window();
DROP FUNCTION validate_homepage_slot_translation_ownership();
DROP FUNCTION validate_gift_variant_label_ownership();
DROP FUNCTION guard_translation_payload_mutation();
DROP FUNCTION guard_revision_payload_mutation();
DROP FUNCTION guard_published_price_mutation();
DROP FUNCTION guard_site_locale_config_publication();
DROP FUNCTION guard_revision_publication();
DROP FUNCTION assert_translation_package(regclass, text, uuid, regclass, text);
DROP FUNCTION assert_translation_initial_review();
DROP FUNCTION validate_translation_review_event();
DROP FUNCTION validate_translation_row();
DROP FUNCTION validate_revision_lifecycle_times();
DROP FUNCTION guard_revision_mutation();
