import { performance } from "node:perf_hooks";
import { URL } from "node:url";
import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";
import { setTimeout as sleep } from "node:timers/promises";
import { digestAdminContentToken } from "@fan-support/application";
import { adminOpaqueTokenSchema } from "@fan-support/contracts";

/** TEST-only causal readiness; never retries a refused operation or changes authorization time. */
export async function waitForFinanceSessionClock({
  read,
  now = () => performance.now(),
  delay = sleep,
}) {
  const start = now();
  while (now() - start < 6000) {
    const state = await read();
    if (now() - start >= 6000) break;
    if (!state.eligible) return "PASSTHROUGH";
    if (state.postgresReady && state.nodeReady) return "READY";
    await delay(25);
  }
  throw new Error("TEST session clock did not become ready");
}

/** Existing TEST grant-readiness margin also protects a freshly issued browser session from local PG clock rollback. */
export function createFinanceBrowserSessionClock({
  client,
  tokenPepper,
  check,
}) {
  const digest = (purpose, value) =>
    adminOpaqueTokenSchema.safeParse(value).success
      ? digestAdminContentToken({ tokenPepper, purpose, token: value })
      : null;
  return {
    async install(page) {
      let failure,
        issued,
        consumed = false;
      const pending = new Set();
      const track = (task) => {
        pending.add(task);
        void task.then(
          () => pending.delete(task),
          () => pending.delete(task),
        );
        return task;
      };
      const onResponse = (response) => {
        if (
          new URL(response.url()).pathname !== "/api/admin/auth/callback" ||
          response.status() !== 303
        )
          return;
        issued = track(
          (async () => {
            const cookies = new Map(
              (await response.headerValues("set-cookie")).map((line) => {
                const pair = line.split(";")[0],
                  at = pair.indexOf("=");
                return [pair.slice(0, at), pair.slice(at + 1)];
              }),
            );
            return {
              session: digest(
                "admin-session",
                cookies.get("__Host-fan-admin-session"),
              ),
              csrf: digest("admin-csrf", cookies.get("__Host-fan-admin-csrf")),
            };
          })().catch((error) => {
            failure ??= error;
            return null;
          }),
        );
      };
      page.on("response", onResponse);
      const work = async (route) => {
        try {
          if (consumed || route.request().method() !== "GET" || !issued) {
            await route.continue();
            return;
          }
          const issuedPair = await issued;
          const headers = await route.request().allHeaders();
          const entries = (headers.cookie ?? "").split(";").map((part) => {
            const at = part.indexOf("=");
            return [part.slice(0, at).trim(), part.slice(at + 1).trim()];
          });
          const cookies = new Map(entries),
            session = digest(
              "admin-session",
              cookies.get("__Host-fan-admin-session"),
            ),
            csrf = digest("admin-csrf", cookies.get("__Host-fan-admin-csrf"));
          if (
            session &&
            csrf &&
            entries.length === cookies.size &&
            issuedPair?.session === session &&
            issuedPair?.csrf === csrf
          ) {
            consumed = true;
            const result = await waitForFinanceSessionClock({
              read: async () => {
                const row = (
                  await client.query(
                    `WITH instant AS MATERIALIZED(SELECT clock_timestamp() at) SELECT s.revoked_at IS NULL AND s.authenticated_with_mfa AND i.status='ACTIVE' AND s.expires_at>instant.at AND s.csrf_token_digest=decode($2,'hex') eligible,s.created_at+interval '500 milliseconds'<=instant.at postgres_ready,s.created_at+interval '500 milliseconds'<=$3::timestamptz node_ready FROM admin_sessions s JOIN admin_identities i ON i.id=s.admin_identity_id CROSS JOIN instant WHERE s.session_token_digest=decode($1,'hex')`,
                    [session, csrf, new Date().toISOString()],
                  )
                ).rows[0];
                return {
                  eligible: row?.eligible === true,
                  postgresReady: row?.postgres_ready === true,
                  nodeReady: row?.node_ready === true,
                };
              },
            });
            if (result === "READY")
              check(
                true,
                "TEST browser session read waits for its persisted issue time without changing authority or lifetime",
              );
          }
          await route.continue();
        } catch (error) {
          failure ??= error;
          console.error(
            `Finance session route failure ${JSON.stringify({ alreadyHandled: /already handled/iu.test(error?.message ?? ""), targetClosed: /has been closed/iu.test(error?.message ?? ""), requestAborted: route.request().failure?.()?.errorText === "net::ERR_ABORTED" })}`,
          );
          try {
            await route.abort("failed");
          } catch {
            console.error(
              "Finance session route abort failed after original error",
            );
          }
        }
      };
      const handler = (route) => track(work(route));
      await page.route("**/api/admin/session", handler);
      return async () => {
        page.off("response", onResponse);
        while (pending.size) await Promise.allSettled([...pending]);
        try {
          await page.unroute("**/api/admin/session", handler);
        } catch (error) {
          failure ??= error;
        } finally {
          while (pending.size) await Promise.allSettled([...pending]);
        }
        if (failure) throw failure;
      };
    },
  };
}

/** Precisely bind the TEST token response to its own persisted OIDC claim, never the latest challenge. */
export function createFinanceTokenClock({ client, check }) {
  return async ({ state, tokenPepper }) => {
    if (typeof state !== "string" || !/^[a-f0-9]{64}$/u.test(state)) return;
    const stateDigest = createHmac("sha256", Buffer.from(tokenPepper, "hex"))
      .update("fan-support:admin-login-digest:v1:state:")
      .update(state)
      .digest("hex");
    const result = await waitForFinanceSessionClock({
      read: async () => {
        const row = (
          await client.query(
            `WITH instant AS MATERIALIZED(SELECT clock_timestamp() at) SELECT c.state='CLAIMED' AND c.claimed_at IS NOT NULL AND c.expires_at>instant.at eligible,c.claimed_at+interval '500 milliseconds'<=instant.at postgres_ready,c.claimed_at+interval '500 milliseconds'<=$2::timestamptz node_ready FROM admin_login_challenges c CROSS JOIN instant WHERE c.state_digest=decode($1,'hex')`,
            [stateDigest, new Date().toISOString()],
          )
        ).rows[0];
        return {
          eligible: row?.eligible === true,
          postgresReady: row?.postgres_ready === true,
          nodeReady: row?.node_ready === true,
        };
      },
    });
    if (result === "READY")
      check(
        true,
        "TEST valid token response waits for its own persisted claim without changing code, authority or lifetime",
      );
  };
}
