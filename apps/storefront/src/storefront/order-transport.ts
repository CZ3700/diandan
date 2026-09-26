import {
  checkoutSessionIdSchema,
  publicOrderIdSchema,
  publicOrderNoSchema,
  orderAccessRawTokenSchema,
  type OrderAccessResponse,
} from "@fan-support/contracts";
import { orderAbortable, readOrderBody } from "./order-transport-io";
import {
  checkOrderResponseHeaders,
  orderResponseBudget,
  validateOrderResponse,
  type OrderOperation,
} from "./order-transport-validation";

export type OrderReply =
  | Exclude<OrderAccessResponse, { outcome: "FAILURE" }>
  | (Extract<OrderAccessResponse, { outcome: "FAILURE" }> & {
      retryAfterSeconds?: number;
    })
  | { schemaVersion: 1; outcome: "UNKNOWN" };
const unknown = (): OrderReply => ({ schemaVersion: 1, outcome: "UNKNOWN" });
const denied = (): OrderReply => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "ACCESS_DENIED",
});
const invalid = (): OrderReply => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "INVALID_REQUEST",
});
type Call = OrderOperation & { path: string; body?: string; csrf?: string };

/** Cookie authority stays in the browser; order-scoped CSRF exists only for this lifecycle. */
export function createOrderTransport(fetcher: typeof fetch = fetch) {
  let disposed = false,
    sequence = 0;
  let authority: { publicOrderId: string; csrf: string } | undefined;
  const active = new Set<AbortController>();
  async function request(call: Call): Promise<OrderReply> {
    if (disposed) return unknown();
    const generation = ++sequence;
    const abort = new AbortController();
    active.add(abort);
    const timer = setTimeout(() => abort.abort(), 15_000);
    if (call.kind !== "read" && call.kind !== "locate") authority = undefined;
    try {
      const headers = new Headers({ accept: "application/json" });
      if (call.body !== undefined)
        headers.set("content-type", "application/json");
      if (call.csrf) headers.set("x-csrf-token", call.csrf);
      const response = await orderAbortable(
        fetcher(call.path, {
          method: call.kind === "read" ? "GET" : "POST",
          headers,
          ...(call.body === undefined ? {} : { body: call.body }),
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: abort.signal,
        }),
        abort.signal,
      );
      try {
        const maximum = orderResponseBudget(call);
        checkOrderResponseHeaders(response.headers, maximum);
        const { result, csrf, retryAfterSeconds } = validateOrderResponse(
          JSON.parse(await readOrderBody(response.body, maximum, abort.signal)),
          response.status,
          response.headers,
          call,
        );
        if (disposed || generation !== sequence || abort.signal.aborted)
          return unknown();
        if (result.outcome === "FAILURE") {
          if (result.code === "ACCESS_DENIED") authority = undefined;
          return {
            ...result,
            ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
          };
        }
        if (result.action === "REVOKED") authority = undefined;
        else if (result.action !== "LOCATED")
          authority = {
            publicOrderId:
              result.action === "GRANTED"
                ? result.grant.publicOrderId
                : result.order.publicOrderId,
            csrf: csrf!,
          };
        return result;
      } finally {
        if (response.body && !response.body.locked)
          void response.body.cancel().catch(() => {});
      }
    } catch {
      return unknown();
    } finally {
      clearTimeout(timer);
      active.delete(abort);
      abort.abort();
    }
  }
  return Object.freeze({
    async exchange(token: string): Promise<OrderReply> {
      if (disposed) return unknown();
      if (!orderAccessRawTokenSchema.safeParse(token).success) return invalid();
      return request({
        kind: "exchange",
        path: "/api/storefront/order-access/exchange",
        body: JSON.stringify({ schemaVersion: 1, token }),
      });
    },
    async bootstrap(
      checkoutSessionId: string,
      cartCsrf: string,
    ): Promise<OrderReply> {
      if (disposed) return unknown();
      if (!checkoutSessionIdSchema.safeParse(checkoutSessionId).success)
        return invalid();
      if (!/^[A-Za-z0-9_-]{43}$/u.test(cartCsrf)) return denied();
      return request({
        kind: "bootstrap",
        path: `/api/storefront/checkout/sessions/${encodeURIComponent(checkoutSessionId)}/order-access`,
        body: JSON.stringify({ schemaVersion: 1 }),
        csrf: cartCsrf,
      });
    },
    async read(publicOrderId: string): Promise<OrderReply> {
      if (disposed) return unknown();
      if (!publicOrderIdSchema.safeParse(publicOrderId).success)
        return invalid();
      return request({
        kind: "read",
        publicOrderId,
        path: `/api/storefront/orders/${encodeURIComponent(publicOrderId)}`,
      });
    },
    /** Resolves a typed public number through this browser's order session; grants nothing. */
    async locate(publicOrderNo: string): Promise<OrderReply> {
      if (disposed) return unknown();
      if (!publicOrderNoSchema.safeParse(publicOrderNo).success)
        return invalid();
      return request({
        kind: "locate",
        publicOrderNo,
        path: "/api/storefront/order-access/locate",
        body: JSON.stringify({ schemaVersion: 1, publicOrderNo }),
      });
    },
    async revoke(publicOrderId: string): Promise<OrderReply> {
      if (disposed) return unknown();
      if (!publicOrderIdSchema.safeParse(publicOrderId).success)
        return invalid();
      if (
        !authority ||
        authority.publicOrderId.toLowerCase() !== publicOrderId.toLowerCase()
      )
        return denied();
      return request({
        kind: "revoke",
        publicOrderId,
        path: "/api/storefront/order-access/revoke",
        body: JSON.stringify({ schemaVersion: 1, publicOrderId }),
        csrf: authority.csrf,
      });
    },
    dispose() {
      disposed = true;
      sequence += 1;
      authority = undefined;
      for (const controller of active) controller.abort();
      active.clear();
    },
  });
}
export type OrderTransport = ReturnType<typeof createOrderTransport>;
