import "server-only";
import { paymentRuntimeOriginSchema } from "@fan-support/contracts";
import {
  resolveInternalApiRuntimeConfig,
  resolveServerRuntimeConfig,
} from "@fan-support/config/server";
import { matchesConfiguredRequestOrigin } from "./request-origin";
import {
  orderRequestCredentials,
  parseOrderRoute,
} from "./order-proxy-request";
import { validatedOrderCookie } from "./order-proxy-cookie";
import {
  OrderBodyLimitError,
  orderAbortable,
  readOrderBody,
} from "../storefront/order-transport-io";
import {
  checkOrderResponseHeaders,
  orderPrivateHeaders,
  orderResponseBudget,
  validateOrderResponse,
  type OrderOperation,
} from "../storefront/order-transport-validation";

function failure(status = 503, code = "TEMPORARY_UNAVAILABLE") {
  return Response.json(
    { schemaVersion: 1, outcome: "FAILURE", code },
    { status, headers: orderPrivateHeaders },
  );
}
/** Fixed order endpoints only. ID hints and browser return parameters grant no authority. */
export async function proxyOrderRequest(
  request: Request,
  options: {
    siteOrigin: string;
    internalApiOrigin: string;
    fetcher?: typeof fetch;
  },
): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000);
  const cancelled = () => abort.abort();
  request.signal.addEventListener("abort", cancelled, { once: true });
  if (request.signal.aborted) abort.abort();
  try {
    if (abort.signal.aborted) return failure();
    const incoming = new URL(request.url),
      target = new URL(options.internalApiOrigin);
    paymentRuntimeOriginSchema.parse(options.siteOrigin);
    if (
      !matchesConfiguredRequestOrigin(request, options.siteOrigin) ||
      target.origin !== options.internalApiOrigin ||
      !["http:", "https:"].includes(target.protocol)
    )
      return failure(403, "ACCESS_DENIED");
    if (
      ((request.method !== "GET" || request.headers.has("origin")) &&
        request.headers.get("origin") !== options.siteOrigin) ||
      (request.headers.has("sec-fetch-site") &&
        !["same-origin", "none"].includes(
          request.headers.get("sec-fetch-site")!,
        ))
    )
      return failure(403, "ACCESS_DENIED");
    let operation: OrderOperation, body: string | undefined;
    try {
      let parsed: unknown;
      if (request.method === "POST") {
        if (
          !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
            request.headers.get("content-type") ?? "",
          )
        )
          return failure(400, "INVALID_REQUEST");
        const length = request.headers.get("content-length");
        if (
          length !== null &&
          (!/^\d+$/u.test(length) || Number(length) > 1024)
        )
          return failure(413, "INVALID_REQUEST");
        parsed = JSON.parse(
          await readOrderBody(request.body, 1024, abort.signal),
        );
        body = JSON.stringify(parsed);
      } else if (
        request.method !== "GET" ||
        request.body !== null ||
        request.headers.has("transfer-encoding") ||
        (request.headers.has("content-length") &&
          request.headers.get("content-length") !== "0")
      )
        return failure(400, "INVALID_REQUEST");
      operation = parseOrderRoute(incoming, request.method, parsed);
    } catch (error) {
      if (abort.signal.aborted) return failure();
      return failure(
        error instanceof OrderBodyLimitError ? 413 : 400,
        "INVALID_REQUEST",
      );
    }
    let headers: Headers;
    try {
      headers = orderRequestCredentials(request, operation);
    } catch {
      return failure(403, "ACCESS_DENIED");
    }
    headers.set("origin", options.siteOrigin);
    if (body !== undefined) headers.set("content-type", "application/json");
    const path = incoming.pathname.replace(/^\/api\/storefront\//u, "/api/v1/");
    if (abort.signal.aborted) return failure();
    const upstream = await orderAbortable(
      (options.fetcher ?? fetch)(new URL(path, target), {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: abort.signal,
      }),
      abort.signal,
    );
    try {
      const maximum = orderResponseBudget(operation);
      checkOrderResponseHeaders(upstream.headers, maximum);
      const { result, csrf, retryAfterSeconds } = validateOrderResponse(
        JSON.parse(await readOrderBody(upstream.body, maximum, abort.signal)),
        upstream.status,
        upstream.headers,
        operation,
      );
      const cookie = validatedOrderCookie(upstream.headers, result);
      const responseHeaders = new Headers(orderPrivateHeaders);
      if (cookie) responseHeaders.set("set-cookie", cookie);
      if (csrf) responseHeaders.set("x-csrf-token", csrf);
      if (retryAfterSeconds)
        responseHeaders.set("retry-after", String(retryAfterSeconds));
      if (abort.signal.aborted) return failure();
      return Response.json(result, {
        status: upstream.status,
        headers: responseHeaders,
      });
    } finally {
      if (upstream.body && !upstream.body.locked)
        void upstream.body.cancel().catch(() => {});
    }
  } catch {
    return failure();
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancelled);
    abort.abort();
  }
}
export async function handleOrderRequest(request: Request): Promise<Response> {
  try {
    const sources = { environment: process.env };
    return await proxyOrderRequest(request, {
      siteOrigin: resolveServerRuntimeConfig(sources).siteOrigin,
      internalApiOrigin: resolveInternalApiRuntimeConfig(sources).origin,
    });
  } catch {
    return failure();
  }
}
