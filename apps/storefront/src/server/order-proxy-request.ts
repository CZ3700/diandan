import {
  checkoutSessionIdSchema,
  publicOrderIdSchema,
  orderAccessBootstrapRequestSchema,
  orderAccessExchangeRequestSchema,
  orderAccessLocateRequestSchema,
  orderAccessRawTokenSchema,
  orderAccessRevokeRequestSchema,
} from "@fan-support/contracts";
import type { OrderOperation } from "../storefront/order-transport-validation";

export function parseOrderRoute(
  url: URL,
  method: string,
  body: unknown,
): OrderOperation {
  if (url.href.includes("?") || url.hash)
    throw new Error("Order query not supported");
  const path = url.pathname;
  if (path === "/api/storefront/order-access/exchange" && method === "POST") {
    orderAccessExchangeRequestSchema.parse(body);
    return { kind: "exchange" };
  }
  if (path === "/api/storefront/order-access/revoke" && method === "POST") {
    const parsed = orderAccessRevokeRequestSchema.parse(body);
    return { kind: "revoke", publicOrderId: parsed.publicOrderId };
  }
  if (path === "/api/storefront/order-access/locate" && method === "POST") {
    const parsed = orderAccessLocateRequestSchema.parse(body);
    return { kind: "locate", publicOrderNo: parsed.publicOrderNo };
  }
  const bootstrap =
    /^\/api\/storefront\/checkout\/sessions\/([a-f\d-]+)\/order-access$/iu.exec(
      path,
    );
  if (bootstrap && method === "POST") {
    checkoutSessionIdSchema.parse(bootstrap[1]);
    orderAccessBootstrapRequestSchema.parse(body);
    return { kind: "bootstrap" };
  }
  const wish =
    /^\/api\/storefront\/orders\/([a-f\d-]+)\/wish-gallery\/([a-f\d-]+)\/withdraw$/iu.exec(
      path,
    );
  if (wish && method === "POST") {
    orderAccessBootstrapRequestSchema.parse(body);
    return {
      kind: "wish-withdraw",
      publicOrderId: publicOrderIdSchema.parse(wish[1]),
      entryId: publicOrderIdSchema.parse(wish[2]),
    };
  }
  const read = /^\/api\/storefront\/orders\/([a-f\d-]+)$/iu.exec(path);
  if (read && method === "GET")
    return { kind: "read", publicOrderId: publicOrderIdSchema.parse(read[1]) };
  throw new Error("Invalid order route");
}
const FORWARDED_CHAIN_BYTES = 512;
/**
 * The edge proxy's X-Forwarded-For chain for the API, which trusts only its configured proxies.
 * Proxies append on the right; an oversized chain loses entries from the left, never the right.
 */
export function forwardedClientChain(headers: Headers): string | undefined {
  const kept: string[] = [];
  let bytes = 0;
  for (const segment of (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .reverse()) {
    const entry = segment.trim();
    if (!entry) continue;
    const size =
      new TextEncoder().encode(entry).byteLength + (kept.length ? 2 : 0);
    if (bytes + size > FORWARDED_CHAIN_BYTES) break;
    kept.unshift(entry);
    bytes += size;
  }
  return kept.length ? kept.join(", ") : undefined;
}
export function orderRequestCredentials(
  request: Request,
  operation: OrderOperation,
): Headers {
  const headers = new Headers({ accept: "application/json" });
  if (operation.kind === "exchange") return headers;
  const name =
    operation.kind === "bootstrap" ? "__Host-fan-cart" : "__Host-fan-order";
  let token: string | undefined;
  for (const raw of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...values] = raw.trim().split("=");
    if (key !== name) continue;
    if (token !== undefined || values.length !== 1)
      throw new Error("Ambiguous order cookie");
    token = values[0];
  }
  if (operation.kind === "bootstrap") {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token ?? ""))
      throw new Error("Invalid cart cookie");
  } else orderAccessRawTokenSchema.parse(token);
  headers.set("cookie", `${name}=${token}`);
  if (
    operation.kind === "bootstrap" ||
    operation.kind === "revoke" ||
    operation.kind === "wish-withdraw"
  ) {
    const csrf = request.headers.get("x-csrf-token");
    if (operation.kind === "bootstrap") {
      if (!/^[A-Za-z0-9_-]{43}$/u.test(csrf ?? ""))
        throw new Error("Invalid cart CSRF");
    } else orderAccessRawTokenSchema.parse(csrf);
    headers.set("x-csrf-token", csrf!);
  }
  return headers;
}
