import "server-only";
import { matchesConfiguredRequestOrigin } from "./request-origin";
import {
  checkoutPreflightValidateRequestSchema,
  checkoutPreflightCreateRequestSchema,
  checkoutPreflightReadCommandSchema,
  checkoutPreflightResponseSchema,
  paymentRuntimeCommandSchema,
  paymentRuntimeCreateRequestSchema,
  paymentRuntimeRecoverRequestSchema,
  paymentRuntimeResponseSchema,
  paymentRuntimeOriginSchema,
  idempotencyKeySchema,
  type CheckoutPreflightCommand,
  type PaymentRuntimeCommand,
  type CheckoutPreflightResponse,
  type PaymentRuntimeResponse,
} from "@fan-support/contracts";
import {
  resolveInternalApiRuntimeConfig,
  resolveServerRuntimeConfig,
} from "@fan-support/config/server";

const cookieName = "__Host-fan-cart",
  tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const privateHeaders = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
function failure(status = 503, code = "TEMPORARY_UNAVAILABLE") {
  return Response.json(
    { schemaVersion: 1, outcome: "FAILURE", code },
    { status, headers: privateHeaders },
  );
}
function onlyCartCookie(value: string | null) {
  let token: string | undefined;
  for (const part of value?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== cookieName) continue;
    if (
      token !== undefined ||
      rest.length !== 1 ||
      !tokenPattern.test(rest[0]!)
    )
      throw new Error("Invalid cart cookie");
    token = rest[0];
  }
  if (!token) throw new Error("Missing cart cookie");
  return `${cookieName}=${token}`;
}
function safeClear(value: string) {
  const parts = value.split(";").map((part) => part.trim());
  if (parts.shift() !== `${cookieName}=` || parts.length !== 5) return false;
  const expected = new Set([
    "path=/",
    "httponly",
    "secure",
    "samesite=lax",
    "max-age=0",
  ]);
  return (
    parts.every((part) => expected.delete(part.toLowerCase())) &&
    expected.size === 0
  );
}
async function textWithin(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
) {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new Error("Response size exceeded");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(data);
}
type Command = CheckoutPreflightCommand | PaymentRuntimeCommand;
function parseRoute(
  url: URL,
  method: string,
  body: unknown,
): { payment: boolean; command: Command } {
  const path = url.pathname.slice("/api/storefront".length);
  if (!url.pathname.startsWith("/api/storefront/"))
    throw new Error("Invalid checkout path");
  const match =
    /^\/checkout\/sessions\/([a-f\d-]+)\/(status|capabilities|attempts)(?:\/([a-f\d-]+)(\/recover)?)?$/iu.exec(
      path,
    );
  if (path === "/cart/validate" && method === "POST" && !url.search)
    return {
      payment: false,
      command: {
        ...checkoutPreflightValidateRequestSchema.parse(body),
        operation: "VALIDATE_CHECKOUT",
      },
    };
  if (path === "/checkout/sessions" && method === "POST" && !url.search)
    return {
      payment: false,
      command: {
        ...checkoutPreflightCreateRequestSchema.parse(body),
        operation: "CREATE_CHECKOUT",
      },
    };
  if (path === "/checkout/current/status" && method === "GET" && !url.search)
    return {
      payment: true,
      command: paymentRuntimeCommandSchema.parse({
        schemaVersion: 1,
        operation: "READ_CURRENT_CHECKOUT",
      }),
    };
  if (!match) throw new Error("Invalid checkout path");
  const [, checkoutSessionId, resource, attemptId, recover] = match;
  if (resource === "status" && method === "GET" && !attemptId && !url.search)
    return {
      payment: false,
      command: checkoutPreflightReadCommandSchema.parse({
        schemaVersion: 1,
        operation: "READ_CHECKOUT",
        checkoutSessionId,
      }),
    };
  if (resource === "capabilities" && method === "GET" && !attemptId) {
    for (const key of url.searchParams.keys())
      if (
        !["presentationLocale", "country", "supportedActionTypes"].includes(
          key,
        ) ||
        url.searchParams.getAll(key).length !== 1
      )
        throw new Error("Invalid capability query");
    return {
      payment: true,
      command: paymentRuntimeCommandSchema.parse({
        schemaVersion: 1,
        operation: "READ_PAYMENT_CAPABILITIES",
        checkoutSessionId,
        presentationLocale: url.searchParams.get("presentationLocale"),
        ...(url.searchParams.has("country")
          ? { country: url.searchParams.get("country") }
          : {}),
        supportedActionTypes: url.searchParams
          .get("supportedActionTypes")
          ?.split(","),
      }),
    };
  }
  if (resource !== "attempts" || url.search)
    throw new Error("Invalid attempt path");
  if (!attemptId && method === "POST")
    return {
      payment: true,
      command: paymentRuntimeCommandSchema.parse({
        ...paymentRuntimeCreateRequestSchema.parse(body),
        operation: "CREATE_PAYMENT_ATTEMPT",
        checkoutSessionId,
      }),
    };
  if (attemptId && !recover && method === "GET")
    return {
      payment: true,
      command: paymentRuntimeCommandSchema.parse({
        schemaVersion: 1,
        operation: "READ_PAYMENT_ATTEMPT",
        checkoutSessionId,
        attemptId,
      }),
    };
  if (attemptId && recover && method === "POST")
    return {
      payment: true,
      command: paymentRuntimeCommandSchema.parse({
        ...paymentRuntimeRecoverRequestSchema.parse(body),
        operation: "RECOVER_PAYMENT_ATTEMPT",
        checkoutSessionId,
        attemptId,
      }),
    };
  throw new Error("Invalid checkout method");
}
function responseMatches(
  command: Command,
  result: CheckoutPreflightResponse | PaymentRuntimeResponse,
  origins: readonly string[],
) {
  if (result.outcome === "FAILURE") return true;
  const attempt = "attempt" in result ? result.attempt : undefined;
  const action = attempt?.action;
  if (
    action &&
    "url" in action &&
    !origins.includes(new URL(action.url).origin)
  )
    return false;
  switch (command.operation) {
    case "VALIDATE_CHECKOUT":
      return (
        result.action === "VALIDATED" &&
        result.preflight.cartVersion === command.expectedCartVersion &&
        result.preflight.presentationLocale === command.presentationLocale
      );
    case "CREATE_CHECKOUT":
      return (
        (result.action === "CREATED" || result.action === "REPLAYED") &&
        "checkout" in result
      );
    case "READ_CHECKOUT":
      return (
        result.action === "READ" &&
        "checkout" in result &&
        result.checkout.id.toLowerCase() ===
          command.checkoutSessionId.toLowerCase()
      );
    case "READ_CURRENT_CHECKOUT":
      return result.action === "CURRENT" || result.action === "EMPTY";
    case "READ_PAYMENT_CAPABILITIES":
      return (
        result.action === "CAPABILITIES" &&
        result.capabilities.checkoutSessionId.toLowerCase() ===
          command.checkoutSessionId.toLowerCase() &&
        result.capabilities.presentationLocale === command.presentationLocale &&
        (command.country === undefined ||
          result.capabilities.country === command.country) &&
        result.capabilities.capabilities.every((entry) =>
          entry.supportedActionTypes.every((type) =>
            command.supportedActionTypes.includes(type),
          ),
        )
      );
    default:
      return (
        attempt !== undefined &&
        attempt !== null &&
        attempt.checkoutSessionId.toLowerCase() ===
          command.checkoutSessionId.toLowerCase() &&
        (!("attemptId" in command) ||
          attempt.id.toLowerCase() === command.attemptId.toLowerCase()) &&
        (command.operation === "CREATE_PAYMENT_ATTEMPT"
          ? ["CREATED", "REPLAYED"].includes(result.action)
          : command.operation === "RECOVER_PAYMENT_ATTEMPT"
            ? result.action === "RECOVERED"
            : result.action === "READ") &&
        (command.operation !== "CREATE_PAYMENT_ATTEMPT" ||
          !action ||
          action.type === "WAIT" ||
          command.supportedActionTypes.includes(action.type))
      );
  }
}
function statuses(code: string) {
  if (code === "INVALID_COMMAND") return [400, 413];
  if (code === "INVALID_ACCESS") return [401, 403];
  if (
    [
      "CART_NOT_FOUND",
      "ITEM_NOT_FOUND",
      "CHECKOUT_NOT_FOUND",
      "PREFLIGHT_NOT_FOUND",
      "ATTEMPT_NOT_FOUND",
    ].includes(code)
  )
    return [404];
  if (
    [
      "TEMPORARY_UNAVAILABLE",
      "TRANSACTION_OUTCOME_UNKNOWN",
      "CONTENT_UNAVAILABLE",
      "COMMERCE_UNAVAILABLE",
      "PROVIDER_UNAVAILABLE",
      "CONFIGURATION_ERROR",
    ].includes(code)
  )
    return [503];
  return [409];
}
/** Explicit checkout paths only; neither a path UUID nor a browser return grants access or confirms payment. */
export async function proxyCheckoutRequest(
  request: Request,
  options: {
    siteOrigin: string;
    internalApiOrigin: string;
    actionOrigins: readonly string[];
    fetcher?: typeof fetch;
  },
): Promise<Response> {
  let dispatched = false;
  const unavailable = () =>
    failure(
      503,
      dispatched ? "TRANSACTION_OUTCOME_UNKNOWN" : "TEMPORARY_UNAVAILABLE",
    );
  try {
    const incoming = new URL(request.url),
      target = new URL(options.internalApiOrigin);
    const origins = options.actionOrigins.map((value) =>
      paymentRuntimeOriginSchema.parse(value),
    );
    if (
      !matchesConfiguredRequestOrigin(request, options.siteOrigin) ||
      target.origin !== options.internalApiOrigin ||
      !["http:", "https:"].includes(target.protocol)
    )
      return failure(403, "INVALID_ACCESS");
    paymentRuntimeOriginSchema.parse(options.siteOrigin);
    const method = request.method;
    if (
      ((method !== "GET" || request.headers.has("origin")) &&
        request.headers.get("origin") !== options.siteOrigin) ||
      (request.headers.has("sec-fetch-site") &&
        !["same-origin", "same-site", "none"].includes(
          request.headers.get("sec-fetch-site")!,
        ))
    )
      return failure(403, "INVALID_ACCESS");
    const headers = new Headers({
      accept: "application/json",
      origin: options.siteOrigin,
    });
    try {
      headers.set("cookie", onlyCartCookie(request.headers.get("cookie")));
    } catch {
      return failure(401, "INVALID_ACCESS");
    }
    let command: Command, payment: boolean, body: string | undefined;
    try {
      let parsed: unknown;
      if (method === "POST") {
        if (
          !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
            request.headers.get("content-type") ?? "",
          )
        )
          return failure(400, "INVALID_COMMAND");
        parsed = JSON.parse(await textWithin(request.body, 8192));
        body = JSON.stringify(parsed);
        const csrf = request.headers.get("x-csrf-token") ?? "";
        if (!tokenPattern.test(csrf)) return failure(403, "INVALID_ACCESS");
        headers.set("x-csrf-token", csrf);
        headers.set("content-type", "application/json");
        headers.set(
          "idempotency-key",
          idempotencyKeySchema.parse(request.headers.get("idempotency-key")),
        );
      } else if (
        method !== "GET" ||
        request.body !== null ||
        request.headers.has("transfer-encoding") ||
        (request.headers.has("content-length") &&
          request.headers.get("content-length") !== "0")
      )
        return failure(400, "INVALID_COMMAND");
      ({ command, payment } = parseRoute(incoming, method, parsed));
    } catch {
      return failure(400, "INVALID_COMMAND");
    }
    const path =
      incoming.pathname.replace(/^\/api\/storefront\//u, "/api/v1/") +
      incoming.search;
    dispatched = method === "POST";
    const upstream = await (options.fetcher ?? fetch)(new URL(path, target), {
      method,
      headers,
      ...(body ? { body } : {}),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (
      upstream.headers.get("cache-control") !== "private, no-store" ||
      !/^application\/json(?:;|$)/iu.test(
        upstream.headers.get("content-type") ?? "",
      )
    )
      return unavailable();
    const result = (
      payment ? paymentRuntimeResponseSchema : checkoutPreflightResponseSchema
    ).parse(JSON.parse(await textWithin(upstream.body, 1_048_576)));
    if (
      (result.outcome === "SUCCESS"
        ? upstream.status !== 200
        : !statuses(result.code).includes(upstream.status)) ||
      !responseMatches(command, result, origins)
    )
      return unavailable();
    const responseHeaders = new Headers(privateHeaders),
      cookies = upstream.headers.getSetCookie();
    if (cookies.length) {
      if (
        cookies.length !== 1 ||
        result.outcome !== "FAILURE" ||
        result.code !== "CART_EXPIRED" ||
        !safeClear(cookies[0]!)
      )
        return unavailable();
      responseHeaders.set("set-cookie", cookies[0]!);
    }
    if (result.outcome === "SUCCESS") {
      const csrf = upstream.headers.get("x-csrf-token") ?? "";
      if (!tokenPattern.test(csrf)) return unavailable();
      responseHeaders.set("x-csrf-token", csrf);
    }
    return Response.json(result, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return unavailable();
  }
}
export async function handleCheckoutRequest(
  request: Request,
): Promise<Response> {
  try {
    const sources = { environment: process.env };
    const origins: unknown = JSON.parse(
      process.env["FAN_SUPPORT_PAYMENT_ACTION_ORIGINS_JSON"] ?? "[]",
    );
    if (
      !Array.isArray(origins) ||
      origins.length > 100 ||
      origins.some(
        (value) => !paymentRuntimeOriginSchema.safeParse(value).success,
      ) ||
      new Set(origins).size !== origins.length
    )
      return failure();
    return await proxyCheckoutRequest(request, {
      siteOrigin: resolveServerRuntimeConfig(sources).siteOrigin,
      internalApiOrigin: resolveInternalApiRuntimeConfig(sources).origin,
      actionOrigins: origins as string[],
    });
  } catch {
    return failure();
  }
}
