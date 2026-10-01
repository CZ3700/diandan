SET search_path=public;
LOCK TABLE storefront_brand_heads,storefront_brand_revisions,storefront_brand_publications,storefront_brand_receipts,storefront_brand_logo_assets IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storefront_brand_revisions) OR EXISTS(SELECT 1 FROM storefront_brand_publications) OR EXISTS(SELECT 1 FROM storefront_brand_receipts) OR EXISTS(SELECT 1 FROM storefront_brand_logo_assets) THEN RAISE EXCEPTION 'brand publication and uploaded logo history cannot be downgraded' USING ERRCODE='55000'; END IF;
END $$;
DROP TABLE storefront_brand_receipts,storefront_brand_heads,storefront_brand_publications,storefront_brand_revisions,storefront_brand_logo_assets;
DROP FUNCTION assert_storefront_brand_authority();
DROP FUNCTION guard_storefront_brand_head();
DROP FUNCTION valid_storefront_brand(jsonb);
