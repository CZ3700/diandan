SET search_path=public;
LOCK TABLE catalog_display_orders IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM catalog_display_orders) OR EXISTS(SELECT 1 FROM audit_logs WHERE action='CATALOG_DISPLAY_ORDER_SAVE') THEN
    RAISE EXCEPTION 'display order history cannot be downgraded' USING ERRCODE='55000';
  END IF;
END $$;
DROP TABLE catalog_display_orders;
DROP FUNCTION assert_catalog_display_order_audit(),guard_catalog_display_order(),catalog_display_order_distinct(uuid[]);
