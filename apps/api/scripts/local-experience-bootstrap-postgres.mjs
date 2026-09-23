import strictAssert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { Client } from "pg";
import { withNativeFinancePostgres } from "./admin-finance-native-postgres.mjs";
import { loadLocalState } from "../../../scripts/local-experience-state.mjs";
import {
  bootstrapLocalBusiness,
  bootstrapLocalPolicies,
} from "./local-experience-bootstrap.mjs";
import { startLocalExperienceRuntime } from "./local-experience-runtime.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const binDirectory =
  process.env.FAN_SUPPORT_LOCAL_POSTGRES_BIN ??
  path.join(
    workspaceRoot,
    "output/checks/p5-03-refund-operations/native-runtime/dist/postgresql@18/18.6/bin",
  );
const state = await loadLocalState(
  workspaceRoot,
  `bootstrap-${randomBytes(6).toString("hex")}`,
);
let assertions = 0;
const assert = new Proxy(strictAssert, {
  get(target, key) {
    const value = target[key];
    return typeof value === "function"
      ? (...args) => {
          assertions++;
          return value(...args);
        }
      : value;
  },
});
let stage = "initialization";
try {
  await withNativeFinancePostgres(
    async (database) => {
      const options = { workspaceRoot, database, ...state };
      const original = Client.prototype.query;
      let injected = false;
      Client.prototype.query = function (...args) {
        if (
          !injected &&
          typeof args[0] === "string" &&
          /INSERT INTO payment_webhook_endpoints/u.test(args[0])
        ) {
          injected = true;
          return Promise.reject(
            new Error("TEST crash after committed payment seed"),
          );
        }
        return original.apply(this, args);
      };
      stage = "interrupt after the payment configuration committed";
      try {
        await assert.rejects(bootstrapLocalBusiness(options), /TEST crash/u);
      } finally {
        Client.prototype.query = original;
      }
      assert.ok(injected);
      const client = new Client(database);
      await client.connect();
      const own = [];
      try {
        const head = (
          await client.query(
            "SELECT publication_id FROM payment_config_publication_heads",
          )
        ).rows;
        assert.equal(head.length, 1);
        stage = "reopen a partially initialized database";
        const business = await bootstrapLocalBusiness(options);
        assert.equal(
          business.stage,
          "PAYMENTS_READY",
          "existing bootstrap stage must resume missing prerequisites",
        );
        assert.equal(
          business.endpoint.endpointId,
          state.config.services.psp.webhookEndpointId,
        );
        assert.deepEqual(
          (
            await client.query(
              "SELECT publication_id FROM payment_config_publication_heads",
            )
          ).rows,
          head,
          "recovery preserves the originally committed payment configuration",
        );
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM payment_provider_accounts",
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM payment_webhook_endpoints",
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await client.query(
              "SELECT to_regclass('pgboss.version') IS NOT NULL ready",
            )
          ).rows[0].ready,
          true,
        );
        stage = "start canonical policy APIs";
        const config = state.config;
        const noNetwork = async () => {
          throw new Error("No external TEST request expected");
        };
        const runtime = await startLocalExperienceRuntime({
          ...options,
          business,
          s3: {
            endpoint: `https://localhost:${config.ports.s3}`,
            ...config.s3,
          },
          services: {
            oidc: { issuer: config.origins.oidc, fetch: noNetwork },
            psp: {
              origin: config.origins.psp,
              binding: config.services.psp.binding,
              fetcher: noNetwork,
            },
          },
          own: (_name, close) => own.push(close),
          startWorker: false,
        });
        stage = "interrupt after policy registration";
        const originalFetch = globalThis.fetch;
        let policyInterrupted = false;
        globalThis.fetch = async (input, init) => {
          if (
            !policyInterrupted &&
            String(input).endsWith("/api/v1/admin/content-authoring/create")
          ) {
            policyInterrupted = true;
            throw new Error("TEST crash after policy registration");
          }
          return originalFetch(input, init);
        };
        try {
          await assert.rejects(
            bootstrapLocalPolicies({
              ...options,
              business,
              base: runtime.apiOrigin,
              progress: () => undefined,
            }),
            /TEST crash/u,
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
        assert.ok(policyInterrupted);
        assert.equal(
          (await client.query("SELECT count(*)::int n FROM policies")).rows[0]
            .n,
          1,
        );
        for (const [suffix, afterCommit] of [
          ["/api/v1/admin/content-authoring/create", true],
          ["/api/v1/admin/content-review/approve", false],
          ["/api/v1/admin/content/publication/publish", false],
        ]) {
          stage = "recover and interrupt policy step " + suffix;
          let interrupted = false;
          globalThis.fetch = async (input, init) => {
            if (!interrupted && String(input).endsWith(suffix)) {
              interrupted = true;
              if (afterCommit) {
                const response = await originalFetch(input, init);
                assert.equal(response.status, 200);
                await response.body?.cancel();
              }
              throw new Error("TEST interrupted policy step");
            }
            return originalFetch(input, init);
          };
          try {
            await assert.rejects(
              bootstrapLocalPolicies({
                ...options,
                business,
                base: runtime.apiOrigin,
                progress: () => undefined,
              }),
              /TEST interrupted/u,
            );
          } finally {
            globalThis.fetch = originalFetch;
          }
          assert.ok(interrupted);
        }
        stage = "recover partial policy publication";
        const ready = await bootstrapLocalPolicies({
          ...options,
          business,
          base: runtime.apiOrigin,
          progress: () => undefined,
        });
        assert.equal(ready.stage, "READY");
        const before = (
          await client.query(
            "SELECT policy_key,publication_id FROM policy_publication_heads ORDER BY policy_key",
          )
        ).rows;
        assert.equal(before.length, 4);
        const reopened = await bootstrapLocalBusiness(options);
        assert.equal(reopened.stage, "READY");
        assert.deepEqual(
          (
            await client.query(
              "SELECT policy_key,publication_id FROM policy_publication_heads ORDER BY policy_key",
            )
          ).rows,
          before,
        );
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM admin_sessions WHERE revoked_at IS NULL",
            )
          ).rows[0].n,
          0,
        );
        stage = "reject corrupted bootstrap state without recreating content";
        await client.query(
          "UPDATE local_experience.bootstrap SET state=jsonb_set(state,'{stage}','\"UNKNOWN_STAGE\"'::jsonb) WHERE id=1",
        );
        await assert.rejects(bootstrapLocalBusiness(options));
        assert.deepEqual(
          (
            await client.query(
              "SELECT policy_key,publication_id FROM policy_publication_heads ORDER BY policy_key",
            )
          ).rows,
          before,
        );
        await client.query(
          "UPDATE local_experience.bootstrap SET state=$1 WHERE id=1",
          [ready],
        );
        console.log(
          JSON.stringify({
            schemaVersion: 1,
            status: "PASS",
            checks: assertions,
            isolatedPostgres: true,
            paymentRecovery: true,
            policyRecovery: true,
            restartPreservesPublications: true,
          }),
        );
      } finally {
        for (const close of own.reverse()) await close();
        await client.end();
      }
    },
    { binDirectory },
  );
} catch (error) {
  console.error(
    JSON.stringify({ stage, error: error.name, code: error.code ?? null }),
  );
  throw error;
} finally {
  await rm(state.stateDirectory, { recursive: true });
}
