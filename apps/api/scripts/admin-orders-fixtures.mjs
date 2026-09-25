import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  adminOrdersPermissionSchema,
  adminSessionPermissionSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { digestAdminIdentitySubject } from "@fan-support/application";

/** Platform-only test grants; identity provider roles are deliberately ignored. */
export async function seedAdminOrdersRoles(client, options) {
  const actors = Object.fromEntries(
      ["order", "manager", "reviewer", "editor"].map((name) => [
        name,
        { id: randomUUID(), subject: randomUUID(), roleId: randomUUID() },
      ]),
    ),
    permissions = new Map();
  const seeded = { actors, permissions };
  const orderPermissions = adminOrdersPermissionSchema.options;
  const definitions = {
    order: orderPermissions.filter(
      (p) => p !== "orders.manage" && p !== "orders.message.triage",
    ),
    manager: orderPermissions,
    reviewer: ["orders.read", "orders.message.read", "orders.message.review"],
  };
  await client.query("BEGIN");
  try {
    for (const actor of Object.values(actors))
      await client.query(
        "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,$2,$3,'ACTIVE')",
        [
          actor.id,
          options.issuer,
          Buffer.from(
            digestAdminIdentitySubject({ ...options, subject: actor.subject }),
            "hex",
          ),
        ],
      );
    const all = [
      ...adminSessionPermissionSchema.options,
      "management.direct",
      ...orderPermissions,
    ];
    for (const key of all) {
      await client.query(
        "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Order acceptance permission') ON CONFLICT(permission_key) DO NOTHING",
        [randomUUID(), key],
      );
      permissions.set(
        key,
        (
          await client.query(
            "SELECT id FROM permissions WHERE permission_key=$1",
            [key],
          )
        ).rows[0].id,
      );
    }
    for (const [name, actor] of Object.entries(actors)) {
      await client.query(
        "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'Order acceptance role')",
        [actor.roleId, `order-test:${name}:${actor.id}`],
      );
      await client.query(
        "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) VALUES($1,$2,$3)",
        [actor.id, actor.roleId, actors.manager.id],
      );
      actor.permissions =
        name === "manager"
          ? [...adminSessionPermissionSchema.options, "management.direct"]
          : name === "editor"
            ? ["content.read", "content.edit"]
            : [];
      for (const key of actor.permissions)
        await client.query(
          "INSERT INTO role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
          [actor.roleId, permissions.get(key), actors.manager.id],
        );
      if (actor.permissions.length)
        for (const locale of SUPPORTED_LOCALES) {
          const audit = randomUUID(),
            request = randomUUID();
          await client.query(
            "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$3,'LOCAL_ACCEPTANCE',$4,$4,'SUCCEEDED','CONTENT_TRANSLATION')",
            [audit, actors.manager.id, actor.id, request],
          );
          await client.query(
            "INSERT INTO admin_content_locale_grants(admin_identity_id,locale,granted_by,audit_log_id) VALUES($1,$2,$3,$4)",
            [actor.id, locale, actors.manager.id, audit],
          );
        }
    }
    for (const [name, list] of Object.entries(definitions)) {
      const actor = actors[name];
      actor.orderPermissions = list;
      actor.reviewLocales = name === "manager" ? SUPPORTED_LOCALES : ["ja"];
      for (const key of list)
        await client.query(
          "INSERT INTO role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
          [actor.roleId, permissions.get(key), actors.manager.id],
        );
      for (const locale of actor.reviewLocales) {
        const audit = randomUUID(),
          request = randomUUID();
        await client.query(
          "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'ORDER_MESSAGE_LOCALE_GRANT','ADMIN_ORDER_MESSAGE_LOCALE_GRANT',$3,'LOCAL_ACCEPTANCE',$4,$4,'SUCCEEDED','SUPPORT_INTENT_PRIVATE')",
          [audit, actors.manager.id, actor.id, request],
        );
        await client.query(
          "INSERT INTO admin_order_message_locale_grants(admin_identity_id,locale,granted_by,audit_log_id) VALUES($1,$2,$3,$4)",
          [actor.id, locale, actors.manager.id, audit],
        );
      }
    }
    await client.query("COMMIT");
    return seeded;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Normal cart + checkout + hosted TEST PSP + verified webhook, never direct paid-row writes. */
export async function createPaidAdminOrder(
  context,
  payment,
  { locale = "en", messageLocale = "ja", lines = [{}], noMessage = false } = {},
) {
  const originalAdd = payment.checkout.add;
  payment.checkout.add = async (session, line) => {
    const added = await originalAdd(session, line),
      item = session.cart.items.find((v) => v.id === added.cartItemId);
    if (noMessage || messageLocale !== "ja")
      await payment.checkout.request(
        "ADMIN_FIXTURE_PERSONALIZATION",
        `/api/v1/cart/items/${item.id}`,
        {
          target: context.base,
          method: "PATCH",
          cart: true,
          session,
          key: randomUUID(),
          body: {
            schemaVersion: 1,
            expectedCartVersion: session.cart.version,
            expectedItemVersion: item.version,
            presentationLocale: locale,
            change: {
              kind: "PERSONALIZATION",
              displayMode: noMessage ? "anonymous" : "nickname",
              fanMessageLocale: noMessage ? "und" : messageLocale,
              ...(noMessage
                ? {}
                : {
                    fanMessage: payment.canaries[0],
                    displayName: payment.canaries[1],
                  }),
            },
          },
        },
      );
    return added;
  };
  let value;
  try {
    value = await payment.fresh({ locale, lines });
  } finally {
    payment.checkout.add = originalAdd;
  }
  await payment.settle(value);
  const signed = await context.signWebhook(value.attempt.id);
  context.check(
    (await context.sendWebhook(signed)).accepted,
    "admin fixture receives actual signed TEST payment",
  );
  const event = (
    await context.client.query(
      "SELECT id FROM provider_events WHERE provider_account_id=$1 AND environment='TEST' AND provider_event_id=$2",
      [context.endpoint.providerAccountId, JSON.parse(signed.rawBody).event_id],
    )
  ).rows[0];
  await payment.apply(event.id);
  const state = await payment.assertPaid(value);
  return { ...value, state, orderId: state.order_id };
}
