import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  SUPPORTED_LOCALES,
  publishedContentContextResponseSchema,
  publishedContentResponseSchema,
  storefrontHomepageContextResponseSchema,
  storefrontHomepageResponseSchema,
  storefrontSeoSnapshotSchema,
  storefrontSeoResponseSchema,
  idolDirectoryResponseSchema,
  giftDirectoryResponseSchema,
} from "@fan-support/contracts";
import { isCanonicalRequestId } from "@fan-support/observability";
import { parsePersistenceTransactionFailure } from "../../../packages/persistence-port/dist/index.js";

const publicCodes = new Set([
  "INVALID_QUERY",
  "NOT_FOUND",
  "CONTENT_UNAVAILABLE",
  "CATALOG_CHANGED",
]);
const issueCodes = new Set([
  "invalid_type",
  "invalid_value",
  "invalid_format",
  "invalid_union",
  "unrecognized_keys",
  "too_big",
  "too_small",
  "not_multiple_of",
  "custom",
]);
const issueFields = new Set([
  "schemaVersion",
  "outcome",
  "code",
  "context",
  "locale",
  "publication",
  "canonical",
  "media",
  "slots",
  "kind",
  "content",
  "view",
  "localeContext",
  "requestedLocale",
  "resolvedLocale",
  "sourceLocale",
  "publicationManifest",
  "manifest",
  "snapshot",
  "receipt",
  "proofVersion",
  "proof",
  "evaluatedAt",
  "publishedAt",
  "revisionId",
  "entityId",
  "id",
  "manifestHash",
  "mediaAssetId",
  "mediaMetadataRevisionId",
  "mediaVariantId",
  "url",
  "hero",
  "featured",
  "items",
  "records",
  "continuation",
  "operation",
  "locator",
  "availableLocales",
  "entries",
  "catalog",
  "sourceHash",
  "sourceVersion",
  "title",
  "name",
  "description",
]);
const errorNames = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ZodError",
  "AbortError",
  "TimeoutError",
  "PersistenceTransactionFailureError",
]);
const publicRoutes = new Map([
  [
    "/api/v1/storefront-homepage",
    ["HOMEPAGE", storefrontHomepageResponseSchema],
  ],
  ["/api/v1/homepage", ["HOMEPAGE_CONTENT", publishedContentResponseSchema]],
  ["/api/v1/idols", ["IDOL_DIRECTORY", idolDirectoryResponseSchema]],
  ["/api/v1/gifts", ["GIFT_DIRECTORY", giftDirectoryResponseSchema]],
  ["/api/v1/idols/:handle", ["IDOL", publishedContentResponseSchema]],
  ["/api/v1/gifts/:handle", ["GIFT", publishedContentResponseSchema]],
  ...["entity", "index", "catalog"].map((operation) => [
    `/api/v1/storefront-seo/${operation}`,
    ["SEO", storefrontSeoResponseSchema],
  ]),
]);
function routeFor(pathname, template = false) {
  const exact = publicRoutes.get(pathname);
  if (exact || template) return exact;
  if (/^\/api\/v1\/idols\/[^/]+$/u.test(pathname))
    return publicRoutes.get("/api/v1/idols/:handle");
  if (/^\/api\/v1\/gifts\/[^/]+$/u.test(pathname))
    return publicRoutes.get("/api/v1/gifts/:handle");
  return undefined;
}
function issuesFor(issues) {
  const result = [];
  function visit(items, depth = 0) {
    if (!Array.isArray(items) || depth > 5) return;
    for (const issue of items.slice(0, 12)) {
      if (result.length >= 12) return;
      result.push({
        code: issueCodes.has(issue?.code) ? issue.code : "UNKNOWN_ISSUE",
        path: Array.isArray(issue?.path)
          ? issue.path
              .slice(0, 12)
              .map((part) =>
                typeof part === "number" &&
                Number.isSafeInteger(part) &&
                part >= 0
                  ? "ARRAY_ITEM"
                  : issueFields.has(part)
                    ? part
                    : "UNKNOWN_FIELD",
              )
          : [],
      });
      if (Array.isArray(issue?.errors))
        for (const nested of issue.errors.slice(0, 4)) visit(nested, depth + 1);
    }
  }
  visit(issues);
  return result;
}
function describeResult(value, schema) {
  const outcome =
    value?.outcome === "SUCCESS"
      ? "SUCCESS"
      : value?.outcome === "FAILURE"
        ? "FAILURE"
        : "INVALID";
  const parsed = schema.safeParse(value);
  return {
    outcome,
    schema: parsed.success ? "VALID" : "INVALID",
    ...(publicCodes.has(value?.code) ? { code: value.code } : {}),
    ...(parsed.success ? {} : { issues: issuesFor(parsed.error.issues) }),
  };
}
const transportCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
function transportCodeFor(error) {
  let current = error;
  for (
    let depth = 0;
    depth < 3 && current !== null && typeof current === "object";
    depth++
  ) {
    const code = Object.getOwnPropertyDescriptor(current, "code");
    if (code && "value" in code && transportCodes.has(code.value))
      return code.value;
    const cause = Object.getOwnPropertyDescriptor(current, "cause");
    current = cause && "value" in cause ? cause.value : undefined;
  }
  return undefined;
}
function describeError(error) {
  const parsed = parsePersistenceTransactionFailure(error);
  if (parsed)
    return {
      outcome: "THROW",
      errorKind: "PersistenceTransactionFailureError",
      code: parsed.error.code,
      recovery: parsed.error.recovery,
    };
  return {
    outcome: "THROW",
    errorKind: errorNames.has(error?.name) ? error.name : "UNKNOWN_ERROR",
    ...(error?.name === "ZodError"
      ? { schema: "INVALID", issues: issuesFor(error.issues) }
      : {}),
  };
}
const managers = [
  {
    field: "publishedContentTransactionManager",
    run: "runInPublishedContentTransaction",
    repo: "publishedContent",
    target: "CONTENT",
    methods: { load: publishedContentContextResponseSchema },
    response: publishedContentResponseSchema,
  },
  {
    field: "storefrontHomepageTransactionManager",
    run: "runInStorefrontHomepageTransaction",
    repo: "storefrontHomepage",
    target: "HOMEPAGE",
    methods: { load: storefrontHomepageContextResponseSchema },
    response: storefrontHomepageResponseSchema,
  },
  {
    field: "storefrontSeoTransactionManager",
    run: "runInStorefrontSeoTransaction",
    repo: "storefrontSeo",
    target: "SEO",
    methods: {
      loadEntity: publishedContentContextResponseSchema,
      readIndex: storefrontSeoSnapshotSchema,
      readCatalog: storefrontSeoSnapshotSchema,
    },
    response: storefrontSeoResponseSchema,
  },
];

/** TEST fixture only. No content, SQL, request URLs or error messages are persisted. */
export function createAcceptanceReadDiagnostics({ output, maxFailures = 100 }) {
  if (!Number.isInteger(maxFailures) || maxFailures < 1 || maxFailures > 256)
    throw new TypeError("Invalid diagnostic capacity");
  mkdirSync(output, { recursive: true });
  let sequence = 0;
  let phaseNumber = 0;
  let active;
  function report(label) {
    return {
      schemaVersion: 1,
      scope: "TEST_ONLY",
      phase: label,
      counts: {},
      failures: [],
      truncated: false,
      droppedFailures: 0,
      observationErrors: 0,
      writeFailed: false,
    };
  }
  function persist(state) {
    try {
      for (const [suffix, value] of [
        ["public-read-diagnostics.json", state.read],
        ["public-read-api-diagnostics.json", state.api],
      ]) {
        const json = `${JSON.stringify(value, null, 2)}\n`;
        writeFileSync(
          path.join(
            output,
            `${String(state.number).padStart(3, "0")}-${state.label}-${suffix}`,
          ),
          json,
        );
        if (state === active) writeFileSync(path.join(output, suffix), json);
      }
    } catch {
      state.read.writeFailed = true;
      state.api.writeFailed = true;
    }
  }
  function beginPhase(label) {
    if (!/^(?:setup|protocol|browser-attempt-[1-9][0-9]{0,2})$/u.test(label))
      throw new TypeError("Invalid diagnostic phase");
    active = {
      number: ++phaseNumber,
      label,
      read: report(label),
      api: report(label),
    };
    persist(active);
  }
  function record(state, kind, event) {
    const value = state[kind];
    const key = `${event.target}:${event.phase}:${event.outcome}:${event.schema ?? "NOT_CHECKED"}:${event.code ?? "NONE"}:${event.status ?? "NONE"}`;
    value.counts[key] = (value.counts[key] ?? 0) + 1;
    if (
      event.outcome !== "SUCCESS" ||
      event.schema === "INVALID" ||
      event.status >= 400
    ) {
      if (value.failures.length >= maxFailures) {
        value.failures.shift();
        value.truncated = true;
        value.droppedFailures++;
      }
      value.failures.push({ ...event, observedAt: new Date().toISOString() });
    }
    persist(state);
  }
  function observe(state, kind, callback) {
    try {
      record(state, kind, callback());
    } catch {
      state[kind].observationErrors++;
      persist(state);
    }
  }
  beginPhase("setup");
  function wrapPersistence(persistence) {
    const result = { ...persistence };
    for (const config of managers) {
      const original = persistence[config.field];
      if (typeof original?.[config.run] !== "function") continue;
      result[config.field] = {
        ...original,
        async [config.run](work, ...args) {
          const operationId = ++sequence;
          const state = active;
          const base = { operationId, target: config.target };
          try {
            const value = await original[config.run](
              async (repositories) => {
                const source = repositories[config.repo];
                const repo = { ...source };
                for (const [method, schema] of Object.entries(config.methods)) {
                  if (typeof source?.[method] !== "function") continue;
                  repo[method] = async (...inputs) => {
                    try {
                      const loaded = await source[method](...inputs);
                      observe(state, "read", () => ({
                        ...base,
                        phase: "LOAD_RETURN",
                        ...describeResult(loaded, schema),
                      }));
                      return loaded;
                    } catch (error) {
                      observe(state, "read", () => ({
                        ...base,
                        phase: "LOAD_THROW",
                        ...describeError(error),
                      }));
                      throw error;
                    }
                  };
                }
                try {
                  const worked = await work({
                    ...repositories,
                    [config.repo]: repo,
                  });
                  observe(state, "read", () => ({
                    ...base,
                    phase: "WORK_RETURN",
                    ...describeResult(worked, config.response),
                  }));
                  return worked;
                } catch (error) {
                  observe(state, "read", () => ({
                    ...base,
                    phase: "WORK_THROW",
                    ...describeError(error),
                  }));
                  throw error;
                }
              },
              ...args,
            );
            observe(state, "read", () => ({
              ...base,
              phase: "TX_RETURN",
              ...describeResult(value, config.response),
            }));
            return value;
          } catch (error) {
            observe(state, "read", () => ({
              ...base,
              phase: "TX_THROW",
              ...describeError(error),
            }));
            throw error;
          }
        },
      };
    }
    return result;
  }
  function observeGateway(
    { url, phase, status, bytes, error },
    state = active,
  ) {
    try {
      const route = routeFor(url.pathname);
      if (!route) return;
      const [target, schema] = route;
      const locale = url.searchParams.get("locale");
      const base = {
        operationId: ++sequence,
        target,
        ...(SUPPORTED_LOCALES.includes(locale) ? { locale } : {}),
        ...(Number.isInteger(status) && status >= 100 && status <= 599
          ? { status }
          : {}),
      };
      if (phase === "GATEWAY_TRANSPORT_ERROR") {
        observe(state, "read", () => {
          const transportCode = transportCodeFor(error);
          return {
            ...base,
            phase,
            ...describeError(error),
            ...(transportCode ? { transportCode } : {}),
          };
        });
      } else if (phase === "GATEWAY_FAULT") {
        observe(state, "read", () => ({
          ...base,
          phase,
          outcome: "INJECTED_FAILURE",
        }));
      } else if (phase === "GATEWAY_RESPONSE") {
        observe(state, "read", () => {
          let value;
          try {
            value = JSON.parse(bytes.toString("utf8"));
          } catch {
            return {
              ...base,
              phase,
              outcome: "INVALID",
              json: "INVALID",
              schema: "NOT_CHECKED",
            };
          }
          return {
            ...base,
            phase,
            json: "VALID",
            ...describeResult(value, schema),
          };
        });
      }
    } catch {
      state.read.observationErrors++;
      persist(state);
    }
  }
  function observeApiLog(line) {
    const state = active;
    try {
      const value = JSON.parse(line);
      const route = routeFor(value.httpRoute, true);
      if (
        !route ||
        value.service !== "api" ||
        !["http.request.completed", "http.request.failed"].includes(value.event)
      )
        return;
      observe(state, "api", () => ({
        target: route[0],
        phase: "API_REQUEST",
        phaseAssociation: "COMPLETION_ONLY",
        event: value.event,
        outcome: value.outcome === "success" ? "SUCCESS" : "FAILURE",
        ...(Number.isInteger(value.httpStatusCode) &&
        value.httpStatusCode >= 100 &&
        value.httpStatusCode <= 599
          ? { status: value.httpStatusCode }
          : {}),
        ...(Number.isInteger(value.durationMs) &&
        value.durationMs >= 0 &&
        value.durationMs <= 86_400_000
          ? { durationMs: value.durationMs }
          : {}),
        ...(isCanonicalRequestId(value.requestId)
          ? { requestId: value.requestId }
          : {}),
        ...(typeof value.traceId === "string" &&
        /^(?!0{32}$)[0-9a-f]{32}$/u.test(value.traceId)
          ? { traceId: value.traceId }
          : {}),
      }));
    } catch {
      state.api.observationErrors++;
      persist(state);
    }
  }
  return {
    beginPhase,
    wrapPersistence,
    observeGateway,
    captureGatewayObserver: () => {
      const state = active;
      return (event) => observeGateway(event, state);
    },
    observeApiLog,
    snapshot: () => globalThis.structuredClone(active.read),
  };
}
