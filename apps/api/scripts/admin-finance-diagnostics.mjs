import { Client } from "pg";
import { URL } from "node:url";
import { digestAdminContentToken } from "@fan-support/application";
import { adminOpaqueTokenSchema } from "@fan-support/contracts";

/** A failed browser read is diagnosed using booleans/relative lifetimes only. */
export function observeFinanceBrowserSession({ client, tokenPepper, own }) {
  const pages = new WeakSet(),
    pending = new Set();
  own("finance browser session diagnostics", () => Promise.allSettled(pending));
  const digest = (purpose, token) =>
    adminOpaqueTokenSchema.safeParse(token).success
      ? digestAdminContentToken({ tokenPepper, purpose, token })
      : null;
  return (page) => {
    if (pages.has(page)) return;
    pages.add(page);
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname === "/api/admin/auth/callback") {
        const task = (async () => {
          const location = await response.headerValue("location");
          const challenge =
            (
              await client.query(
                `SELECT c.state,a.reason_code,a.outcome,c.session_id IS NOT NULL session_created,floor(extract(epoch FROM c.expires_at-clock_timestamp()))::int ttl_seconds FROM admin_login_challenges c LEFT JOIN audit_logs a ON a.id=c.audit_log_id ORDER BY c.created_at DESC LIMIT 1`,
              )
            ).rows[0] ?? null;
          const metadata = (await response.headerValues("set-cookie")).map(
            (line) => ({
              name:
                /^(__Host-fan-admin-(?:session|csrf|login))=/u.exec(
                  line,
                )?.[1] ?? "OTHER",
              maxAge: Number(
                /(?:^|;\s*)Max-Age=(-?\d+)/iu.exec(line)?.[1] ?? 0,
              ),
              secure: /;\s*Secure(?:;|$)/iu.test(line),
              httpOnly: /;\s*HttpOnly(?:;|$)/iu.test(line),
              sameSite:
                /;\s*SameSite=(Strict|Lax|None)(?:;|$)/iu.exec(line)?.[1] ??
                null,
            }),
          );
          console.log(
            `Finance callback diagnostic ${JSON.stringify({ status: response.status(), failed: location ? new URL(location, response.url()).searchParams.get("login") === "failed" : null, cookies: metadata, challenge })}`,
          );
        })().catch(() =>
          console.error("Finance callback diagnostic unavailable"),
        );
        pending.add(task);
        void task.finally(() => pending.delete(task));
      }
      if (
        response.status() !== 401 ||
        !/^\/api\/admin\/(?:session|(?:orders|finance)-(?:list|detail|context))$/u.test(
          pathname,
        )
      )
        return;
      const task = (async () => {
        const headers = await response.request().allHeaders();
        const cookies = new Map(
          (headers.cookie ?? "").split(";").map((part) => {
            const split = part.indexOf("=");
            return [part.slice(0, split).trim(), part.slice(split + 1).trim()];
          }),
        );
        const session = cookies.get("__Host-fan-admin-session"),
          csrf = cookies.get("__Host-fan-admin-csrf");
        const current = await page.context().cookies(response.url());
        const sessionDigest = digest("admin-session", session),
          csrfDigest = digest("admin-csrf", csrf);
        const rows = sessionDigest
          ? (
              await client.query(
                `WITH instant AS MATERIALIZED(SELECT clock_timestamp() at) SELECT s.revoked_at IS NOT NULL revoked,s.authenticated_with_mfa mfa,i.status='ACTIVE' identity_active,s.created_at<=instant.at created_live,s.expires_at>instant.at unexpired,floor(extract(epoch FROM s.expires_at-instant.at))::int ttl_seconds,ceil(extract(epoch FROM s.created_at-instant.at)*1000000)::bigint created_ahead_us,s.csrf_token_digest=decode($2,'hex') csrf_matches FROM admin_sessions s JOIN admin_identities i ON i.id=s.admin_identity_id CROSS JOIN instant WHERE s.session_token_digest=decode($1,'hex')`,
                [sessionDigest, csrfDigest],
              )
            ).rows
          : [];
        let code = null;
        try {
          const body = await response.json();
          code = /^[A-Z_]{1,64}$/u.test(body?.code ?? "") ? body.code : null;
        } catch {
          /* No raw body is retained. */
        }
        console.log(
          `Finance session diagnostic ${JSON.stringify({ path: pathname, code, requestSession: Boolean(sessionDigest), requestCsrf: Boolean(csrfDigest), headerCsrfMatches: Boolean(csrfDigest) && headers["x-csrf-token"] === csrf, currentSession: current.some((v) => v.name === "__Host-fan-admin-session"), currentMatchesRequest: current.some((v) => v.name === "__Host-fan-admin-session" && v.value === session), found: rows.length === 1, facts: rows[0] ?? null })}`,
        );
      })().catch(() => console.error("Finance session diagnostic unavailable"));
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });
  };
}
/** Owned test instrumentation reports only PostgreSQL codes and schema identifiers, never values or SQL. */
export function observeFinancePostgres() {
  const original = Client.prototype.query;
  Client.prototype.query = function (...args) {
    const value = original.apply(this, args);
    if (!value?.catch) return value;
    return value.catch((error) => {
      const sql = typeof args[0] === "string" ? args[0] : args[0]?.text;
      console.error(
        `Finance PostgreSQL ${JSON.stringify({ operation: sql === "COMMIT" ? "COMMIT" : "STATEMENT", code: /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : null, guard: /PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(error?.where ?? "")?.[1] ?? null, constraint: /^[a-z_][a-z_0-9]{0,127}$/u.test(error?.constraint ?? "") ? error.constraint : null })}`,
      );
      throw error;
    });
  };
  return () => {
    Client.prototype.query = original;
  };
}
