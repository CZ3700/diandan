SET search_path=public;
-- Restores the 0052 catalog and standard roles removed by 0054.
INSERT INTO permissions(id,permission_key,description)
SELECT gen_random_uuid(),key,'Platform permission' FROM unnest(ARRAY[
  'content.read','content.edit','content.translation.review','content.preview',
  'content.media.upload','content.media.read','content.media.process','content.media.rights',
  'content.policy.manage','content.publish',
  'orders.read','orders.message.read','orders.message.review','orders.message.triage',
  'orders.fulfillment','orders.note','orders.notification.resend','orders.manage',
  'commerce.read','gift.manage','pricing.manage','inventory.manage','management.direct',
  'finance.manage','payments.read','payments.configure','payments.review','payments.publish',
  'exceptions.read','exceptions.replay'
]) AS key
ON CONFLICT (permission_key) DO NOTHING;
INSERT INTO permissions(id,permission_key,description)
VALUES(gen_random_uuid(),'staff.manage','Create built-in staff accounts, assign roles, reset passwords and suspend access')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO roles(id,role_key,description) VALUES
  (gen_random_uuid(),'studio:owner','Studio administrator: every permission, including staff, finance and payment configuration'),
  (gen_random_uuid(),'studio:operator','Daily operations: content, gifts, orders and messages; no finance, payment configuration, exception replay or staff management')
ON CONFLICT (role_key) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.role_key='studio:owner'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key=ANY(ARRAY[
  'content.read','content.edit','content.translation.review','content.preview',
  'content.media.upload','content.media.read','content.media.process','content.media.rights',
  'content.policy.manage','content.publish',
  'orders.read','orders.message.read','orders.message.review','orders.message.triage',
  'orders.fulfillment','orders.note','orders.notification.resend',
  'commerce.read','gift.manage','pricing.manage','inventory.manage','management.direct',
  'payments.read','exceptions.read'
]) WHERE r.role_key='studio:operator'
ON CONFLICT DO NOTHING;
