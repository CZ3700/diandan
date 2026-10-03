SET search_path = public;
LOCK TABLE homepage_layout_heads,homepage_layout_revisions,homepage_layout_publications,homepage_layout_receipts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM homepage_layout_revisions) OR EXISTS(SELECT 1 FROM homepage_layout_publications) OR EXISTS(SELECT 1 FROM homepage_layout_receipts) OR EXISTS(SELECT 1 FROM audit_logs WHERE action LIKE 'HOME_LAYOUT_%') THEN
  RAISE EXCEPTION 'layout history cannot be downgraded' USING ERRCODE='55000';
 END IF;
END $$;
DROP TABLE homepage_layout_receipts,homepage_layout_heads,homepage_layout_publications,homepage_layout_revisions;
DROP FUNCTION guard_homepage_layout_head();
DROP FUNCTION valid_homepage_layout(jsonb);
