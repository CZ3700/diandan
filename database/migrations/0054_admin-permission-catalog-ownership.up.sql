SET search_path=public;
-- 0052 seeded the whole permission catalog and two standard roles. Repository convention is that
-- migrations add only the keys they introduce (e.g. 0035-0037), while fixtures and deployment
-- provisioning create the rest; test fixtures insert those keys directly. Keep staff.manage and
-- hand the catalog and standard roles to the built-in account provisioning command (L3-10).
DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id=r.id AND r.role_key IN ('studio:owner','studio:operator')
  AND NOT EXISTS(SELECT 1 FROM admin_identity_roles ar WHERE ar.role_id=r.id);
DELETE FROM roles r
WHERE r.role_key IN ('studio:owner','studio:operator')
  AND NOT EXISTS(SELECT 1 FROM admin_identity_roles ar WHERE ar.role_id=r.id);
DELETE FROM permissions p
WHERE p.description='Platform permission' AND p.permission_key<>'staff.manage'
  AND NOT EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.permission_id=p.id);
