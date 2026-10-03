import "server-only";
import {
  deliveryProofRenditionNameSchema,
  orderAccessRawTokenSchema,
  paymentRuntimeOriginSchema,
  publicOrderIdSchema,
} from "@fan-support/contracts";
import {
  resolveInternalApiRuntimeConfig,
  resolveServerRuntimeConfig,
} from "@fan-support/config/server";
import { matchesConfiguredRequestOrigin } from "./request-origin";
import { forwardedClientChain } from "./order-proxy-request";
import { orderAbortable } from "../storefront/order-transport-io";
import { orderPrivateHeaders } from "../storefront/order-transport-validation";

const cookieName = "__Host-fan-order";
const route =
  /^\/api\/storefront\/orders\/([^/]+)\/delivery-proofs\/([^/]+)\/([^/]+)$/u;
// Bounds mirror the private rendition profile; anything larger is not a delivery photo.
const byteLimit = { thumbnail: 512 * 1024, display: 4 * 1024 * 1024 } as const;
const imageHeaders = {
  ...orderPrivateHeaders,
  "content-type": "image/webp",
  "content-disposition": 'inline; filename="delivery-photo.webp"',
  "content-security-policy":
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox",
  "cross-origin-resource-policy": "same-origin",
};

function failure(status: number, code: string, retryAfter?: string | null) {
  const headers = new Headers(orderPrivateHeaders);
  if (retryAfter && /^\d{1,4}$/u.test(retryAfter))
    headers.set("retry-after", retryAfter);
  return Response.json(
    { schemaVersion: 1, outcome: "FAILURE", code },
    { status, headers },
  );
}
function orderCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  let token: string | null = null;
  for (const part of header.split(";")) {
    const offset = part.indexOf("=");
    if (offset < 1) return null;
    if (part.slice(0, offset).trim() !== cookieName) continue;
    if (token !== null) return null;
    token = part.slice(offset + 1).trim();
  }
  return token !== null && orderAccessRawTokenSchema.safeParse(token).success
    ? token
    : null;
}
async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      if (signal.aborted) return null;
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > limit) return null;
      chunks.push(chunk.value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Relays one private delivery photo of this browser's order session. Only the order cookie
 * leaves the browser; the API authorizes the exact proof and the response is never cached.
 */
export async function proxyOrderProofRequest(
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
    const incoming = new URL(request.url),
      target = new URL(options.internalApiOrigin);
    paymentRuntimeOriginSchema.parse(options.siteOrigin);
    if (
      !matchesConfiguredRequestOrigin(request, options.siteOrigin) ||
      target.origin !== options.internalApiOrigin ||
      !["http:", "https:"].includes(target.protocol) ||
      (request.headers.has("origin") &&
        request.headers.get("origin") !== options.siteOrigin) ||
      (request.headers.has("sec-fetch-site") &&
        !["same-origin", "none"].includes(
          request.headers.get("sec-fetch-site")!,
        ))
    )
      return failure(403, "ACCESS_DENIED");
    if (request.method !== "GET") return failure(405, "INVALID_REQUEST");
    const matched = route.exec(incoming.pathname);
    const publicOrderId = publicOrderIdSchema.safeParse(matched?.[1]),
      proofId = publicOrderIdSchema.safeParse(matched?.[2]),
      rendition = deliveryProofRenditionNameSchema.safeParse(matched?.[3]);
    if (
      incoming.search !== "" ||
      !publicOrderId.success ||
      !proofId.success ||
      !rendition.success ||
      request.body !== null ||
      request.headers.has("transfer-encoding") ||
      (request.headers.has("content-length") &&
        request.headers.get("content-length") !== "0")
    )
      return failure(400, "INVALID_REQUEST");
    const token = orderCookie(request);
    if (!token) return failure(401, "ACCESS_DENIED");
    const forwarded = forwardedClientChain(request.headers);
    const upstream = await orderAbortable(
      (options.fetcher ?? fetch)(
        new URL(
          `/api/v1/orders/${publicOrderId.data}/delivery-proofs/${proofId.data}/${rendition.data}`,
          target,
        ),
        {
          method: "GET",
          headers: {
            origin: options.siteOrigin,
            cookie: `${cookieName}=${token}`,
            ...(forwarded ? { "x-forwarded-for": forwarded } : {}),
          },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: abort.signal,
        },
      ),
      abort.signal,
    );
    try {
      if (upstream.status !== 200)
        return [400, 401, 403, 404, 409, 429].includes(upstream.status)
          ? failure(
              upstream.status === 404 ? 401 : upstream.status,
              upstream.status === 429
                ? "RATE_LIMITED"
                : upstream.status === 400
                  ? "INVALID_REQUEST"
                  : "ACCESS_DENIED",
              upstream.headers.get("retry-after"),
            )
          : failure(503, "TEMPORARY_UNAVAILABLE");
      const limit = byteLimit[rendition.data];
      const length = upstream.headers.get("content-length");
      if (
        upstream.headers.get("content-type") !== "image/webp" ||
        upstream.headers.get("cache-control") !== "private, no-store" ||
        length === null ||
        !/^\d+$/u.test(length) ||
        Number(length) < 1 ||
        Number(length) > limit
      )
        return failure(503, "TEMPORARY_UNAVAILABLE");
      const bytes = await readBounded(upstream.body, limit, abort.signal);
      if (!bytes || bytes.byteLength !== Number(length) || abort.signal.aborted)
        return failure(503, "TEMPORARY_UNAVAILABLE");
      return new Response(bytes, {
        status: 200,
        headers: {
          ...imageHeaders,
          "content-length": String(bytes.byteLength),
        },
      });
    } finally {
      if (upstream.body && !upstream.body.locked)
        void upstream.body.cancel().catch(() => {});
    }
  } catch {
    return failure(503, "TEMPORARY_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancelled);
    abort.abort();
  }
}

export async function handleOrderProofRequest(
  request: Request,
): Promise<Response> {
  try {
    const sources = { environment: process.env };
    return await proxyOrderProofRequest(request, {
      siteOrigin: resolveServerRuntimeConfig(sources).siteOrigin,
      internalApiOrigin: resolveInternalApiRuntimeConfig(sources).origin,
    });
  } catch {
    return failure(503, "TEMPORARY_UNAVAILABLE");
  }
}
