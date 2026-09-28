SET search_path = public;
LOCK TABLE storefront_theme_heads,storefront_theme_revisions,storefront_theme_publications,storefront_theme_receipts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storefront_theme_revisions) OR EXISTS(SELECT 1 FROM storefront_theme_publications) OR EXISTS(SELECT 1 FROM storefront_theme_receipts) OR EXISTS(SELECT 1 FROM audit_logs WHERE action LIKE 'STOREFRONT_THEME_%') THEN
  RAISE EXCEPTION 'theme history cannot be downgraded' USING ERRCODE='55000';
 END IF;
END $$;
DROP TABLE storefront_theme_receipts,storefront_theme_heads,storefront_theme_publications,storefront_theme_revisions;
DROP FUNCTION guard_storefront_theme_head();
DROP FUNCTION valid_storefront_theme(jsonb);
