import { AsyncLocalStorage } from "node:async_hooks";
import { Server } from "node:http";
import { createRequire } from "node:module";
import { URL } from "node:url";

const numericFacts = [
  "actor_role_count",
  "exact_join_count",
  "identity_due_count",
  "permission_due_count",
  "unrevoked_count",
  "eligible_count",
  "future_count",
  "eligible_at_authorization_count",
  "missing_count",
];
const booleanFacts = ["wall_before_transaction"];
export function safeFacts(input) {
  const output = {};
  for (const name of numericFacts) {
    const value = input?.[name];
    if (Number.isSafeInteger(value) && value >= 0) output[name] = value;
  }
  for (const name of booleanFacts)
    if (typeof input?.[name] === "boolean") output[name] = input[name];
  return output;
}
export function authorizationStage(text) {
  const sql = text.replace(/\s+/gu, " ").trim();
  if (
    sql.startsWith("SELECT ar.role_id FROM public.admin_identity_roles ar") &&
    sql.includes("ar.granted_at <= clock_timestamp()") &&
    sql.includes("rp.granted_at <= clock_timestamp()")
  )
    return "PERMISSION";
  if (
    sql.startsWith("SELECT locale FROM public.admin_content_locale_grants") &&
    sql.includes("locale = ANY($2::text[])") &&
    sql.includes("granted_at <= clock_timestamp()")
  )
    return "LOCALE";
  if (
    sql.startsWith(
      "WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)",
    ) &&
    sql.includes("s.csrf_token_digest") &&
    sql.includes("s.session_token_digest = $1")
  )
    return "SESSION";
  return null;
}
const permissionProbe = `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now),
  grants AS (SELECT ar.granted_at AS identity_at,rp.granted_at AS permission_at
    FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id
    JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id
    WHERE ar.admin_identity_id=$1 AND p.permission_key=$2)
  SELECT (SELECT count(*)::int FROM public.admin_identity_roles WHERE admin_identity_id=$1) AS actor_role_count,
    (SELECT count(*)::int FROM grants) AS exact_join_count,
    (SELECT count(*)::int FROM grants WHERE identity_at<=instant.now) AS identity_due_count,
    (SELECT count(*)::int FROM grants WHERE permission_at<=instant.now) AS permission_due_count,
    (SELECT count(*)::int FROM grants WHERE identity_at<=instant.now AND permission_at<=instant.now) AS eligible_count,
    (SELECT count(*)::int FROM grants WHERE identity_at>instant.now OR permission_at>instant.now) AS future_count,
    (SELECT count(*)::int FROM grants WHERE identity_at<=$3::timestamptz AND permission_at<=$3::timestamptz) AS eligible_at_authorization_count,
    instant.now<transaction_timestamp() AS wall_before_transaction FROM instant`;
const localeProbe = `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now),
  grants AS (SELECT locale,granted_at,revoked_at FROM public.admin_content_locale_grants WHERE admin_identity_id=$1 AND locale=ANY($2::text[]))
  SELECT (SELECT count(DISTINCT locale)::int FROM grants) AS exact_join_count,
    (SELECT count(DISTINCT locale)::int FROM grants WHERE revoked_at IS NULL) AS unrevoked_count,
    (SELECT count(DISTINCT locale)::int FROM grants WHERE revoked_at IS NULL AND granted_at<=instant.now) AS eligible_count,
    (SELECT count(DISTINCT locale)::int FROM grants WHERE revoked_at IS NULL AND granted_at>instant.now) AS future_count,
    (SELECT count(DISTINCT locale)::int FROM grants WHERE revoked_at IS NULL AND granted_at<=$3::timestamptz) AS eligible_at_authorization_count,
    cardinality($2::text[])-(SELECT count(DISTINCT locale)::int FROM grants WHERE revoked_at IS NULL AND granted_at<=instant.now) AS missing_count,
    instant.now<transaction_timestamp() AS wall_before_transaction FROM instant`;

if (process.env["P404_AUTH_DIAGNOSTIC"] === "1") {
  const require = createRequire(
    new URL("../../../apps/api/package.json", import.meta.url),
  );
  const { Client } = require("pg");
  const context = new AsyncLocalStorage();
  const originalEmit = Server.prototype.emit;
  const originalQuery = Client.prototype.query;
  const sessionTimes = new WeakMap();
  let sequence = 0;
  Server.prototype.emit = function (event, ...args) {
    if (event !== "request")
      return Reflect.apply(originalEmit, this, [event, ...args]);
    const [request, response] = args;
    const path = request.url?.split("?")[0];
    const route =
      path === "/api/v1/admin/content-review/read"
        ? "BASE_CONTENT_READ"
        : path === "/api/v1/admin/content/publication/validate"
          ? "PUBLICATION_VALIDATE"
          : path?.startsWith("/api/v1/admin/")
            ? "OTHER_ADMIN"
            : null;
    if (!route) return Reflect.apply(originalEmit, this, [event, ...args]);
    const record = {
      inboundAdminSequence: ++sequence,
      route,
      origin_matches:
        request.headers.origin === "https://admin.example.invalid",
      origin_single:
        request.rawHeaders.filter(
          (value, index) => index % 2 === 0 && value.toLowerCase() === "origin",
        ).length === 1,
      fetch_metadata_cross_site:
        request.headers["sec-fetch-site"] === "cross-site",
      queries: [],
    };
    response.once("finish", () => {
      if (
        response.statusCode >= 400 ||
        record.queries.some((entry) => entry.deficient)
      )
        process.stdout.write(
          "AUTH_QUERY_DIAGNOSTIC " +
            JSON.stringify({ ...record, httpStatus: response.statusCode }) +
            "\n",
        );
    });
    return context.run(record, () =>
      Reflect.apply(originalEmit, this, [event, ...args]),
    );
  };
  Client.prototype.query = function (...args) {
    const record = context.getStore();
    const text = typeof args[0] === "string" ? args[0] : args[0]?.text;
    const stage =
      record && typeof text === "string" ? authorizationStage(text) : null;
    if (!stage || args.some((arg) => typeof arg === "function"))
      return Reflect.apply(originalQuery, this, args);
    const values = typeof args[0] === "string" ? args[1] : args[0].values;
    const result = Reflect.apply(originalQuery, this, args);
    return result.then(
      async (value) => {
        const required =
          stage === "LOCALE" ? new Set(values?.[1] ?? []).size : 1;
        const rowCount = value.rows.length;
        const entry = {
          phase: stage,
          originalRowCount: rowCount,
          requiredCount: required,
          deficient: rowCount < required,
        };
        if (stage === "SESSION") {
          if (rowCount === 1) sessionTimes.set(this, value.rows[0].now);
          else sessionTimes.delete(this);
        } else if (entry.deficient) {
          try {
            const probe = await Reflect.apply(originalQuery, this, [
              stage === "PERMISSION" ? permissionProbe : localeProbe,
              [values[0], values[1], sessionTimes.get(this) ?? null],
            ]);
            entry.diagnostic_after_query = safeFacts(probe.rows[0]);
          } catch (error) {
            entry.diagnostic_after_query = {
              outcome: "FAILED",
              sqlstate: /^[A-Z0-9]{5}$/u.test(error?.code ?? "")
                ? error.code
                : "OTHER",
            };
          }
        }
        record.queries.push(entry);
        if (record.queries.length > 12) record.queries.shift();
        return value;
      },
      (error) => {
        record.queries.push({
          phase: stage,
          outcome: "THREW",
          sqlstate: /^[A-Z0-9]{5}$/u.test(error?.code ?? "")
            ? error.code
            : "OTHER",
        });
        throw error;
      },
    );
  };
  process.stdout.write(
    "AUTH_QUERY_DIAGNOSTIC_SCOPE " +
      JSON.stringify({
        schemaVersion: 1,
        originalQueriesUnchanged: true,
        projection: "POST_QUERY_ONLY",
        isolatedTestOnly: true,
        caveat:
          "Later diagnostic clock is not the original volatile query instant; passing does not explain earlier failures",
      }) +
      "\n",
  );
}
