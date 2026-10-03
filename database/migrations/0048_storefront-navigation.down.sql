SET search_path = public;
LOCK TABLE storefront_navigation_heads,storefront_navigation_revisions,storefront_navigation_publications,storefront_navigation_receipts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storefront_navigation_revisions) OR EXISTS(SELECT 1 FROM storefront_navigation_publications) OR EXISTS(SELECT 1 FROM storefront_navigation_receipts) OR EXISTS(SELECT 1 FROM audit_logs WHERE action LIKE 'STOREFRONT_NAVIGATION_%') THEN
  RAISE EXCEPTION 'navigation history cannot be downgraded' USING ERRCODE='55000';
 END IF;
END $$;
DROP TABLE storefront_navigation_receipts,storefront_navigation_heads,storefront_navigation_publications,storefront_navigation_revisions;
DROP FUNCTION guard_storefront_navigation_head();
DROP FUNCTION valid_storefront_navigation(jsonb);
