import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createGiftCommercePricingRepository } from "../dist/gift-commerce-pricing-repository.js";
import { createGiftCommerceInventoryRepository } from "../dist/gift-commerce-inventory-repository.js";
import { createGiftCommerceAuthorizationRepository } from "../dist/gift-commerce-authorization-repository.js";
/** Both transactions establish real snapshots before attempting the same versioned mutation. */
export async function verifyGiftCommerceConcurrency({
  config,
  credentials,
  priceCommand,
  inventoryCommand,
  check,
}) {
  async function race(command, kind) {
    let ready = 0,
      open;
    const barrier = new Promise((resolve) => {
      open = resolve;
    });
    const clients = [new Client(config), new Client(config)];
    await Promise.all(clients.map((c) => c.connect()));
    try {
      const results = await Promise.all(
        clients.map(async (client) => {
          const scope = {
            trackOperation: async (work) => work(),
            markRollbackOnly: () => undefined,
          };
          await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
          try {
            const auth = createGiftCommerceAuthorizationRepository(
              client,
              scope,
            );
            const principal = await auth.authorize({
              schemaVersion: 1,
              sessionTokenDigest: credentials.sessionTokenDigest,
              csrfTokenDigest: credentials.csrfTokenDigest,
              permission:
                kind === "pricing" ? "pricing.manage" : "inventory.manage",
              locales: [],
            });
            if (principal.outcome !== "SUCCESS")
              throw new Error("concurrency fixture authority");
            if (++ready === 2) open();
            await barrier;
            const repo =
              kind === "pricing"
                ? createGiftCommercePricingRepository(client, scope)
                : createGiftCommerceInventoryRepository(client, scope);
            const result = await repo.write({
              schemaVersion: 1,
              requestId: randomUUID(),
              principal: principal.principal,
              command: {
                schemaVersion: 1,
                reasonCode: "COMMERCE_CONCURRENCY",
                idempotencyKey: randomUUID(),
                ...command,
              },
            });
            if (result.outcome === "FAILURE") {
              await client.query("ROLLBACK");
              return result;
            }
            await client.query("SET CONSTRAINTS ALL IMMEDIATE");
            await client.query("COMMIT");
            return result;
          } catch (error) {
            await client.query("ROLLBACK");
            return {
              outcome: "FAILURE",
              code: error.code ?? error.failure?.error?.code ?? "UNEXPECTED",
            };
          }
        }),
      );
      check(
        results.filter((r) => r.outcome === "SUCCESS").length,
        1,
        `${kind}: one same-version concurrent mutation commits`,
      );
      check(
        results
          .filter((r) => r.outcome === "FAILURE")
          .every((r) =>
            [
              "40001",
              "40P01",
              "TRANSACTION_ABORTED",
              "VERSION_CONFLICT",
              "STALE_VERSION",
            ].includes(r.code),
          ),
        true,
        `${kind}: competing transaction reports an explicit version conflict`,
      );
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  }
  await race(priceCommand, "pricing");
  await race(inventoryCommand, "inventory");
}
