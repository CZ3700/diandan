import type {
  CheckoutPreflightView,
  PaymentRuntimeCapabilityView,
  SupportedLocale,
  CartRuntimeCurrentResponse,
  CheckoutPreflightResponse,
  PaymentRuntimeResponse,
} from "@fan-support/contracts";
export type CheckoutReply =
  | CartRuntimeCurrentResponse
  | CheckoutPreflightResponse
  | PaymentRuntimeResponse
  | { outcome: "UNKNOWN" };
export type CheckoutCall = Readonly<{
  kind:
    | "current"
    | "cart"
    | "validate"
    | "create"
    | "session"
    | "capabilities"
    | "attempt-create"
    | "attempt"
    | "recover";
  path: string;
  method: "GET" | "POST";
  body?: string;
  key?: string;
  sessionId?: string;
  attemptId?: string;
  locale?: SupportedLocale;
  cartVersion?: number;
}>;
const base = "/api/storefront/checkout";
const sessionPath = (id: string) =>
  `${base}/sessions/${encodeURIComponent(id)}`;
function post(
  call: Omit<CheckoutCall, "method" | "key" | "body">,
  body: unknown,
): CheckoutCall {
  return Object.freeze({
    ...call,
    method: "POST",
    body: JSON.stringify(body),
    key: crypto.randomUUID(),
  });
}
export const checkoutCalls = {
  current: (): CheckoutCall => ({
    kind: "current",
    path: `${base}/current/status`,
    method: "GET",
  }),
  cart: (locale: SupportedLocale): CheckoutCall => ({
    kind: "cart",
    path: `/api/storefront/cart?presentationLocale=${locale}`,
    locale,
    method: "GET",
  }),
  validate: (cartVersion: number, locale: SupportedLocale) =>
    post(
      {
        kind: "validate",
        path: "/api/storefront/cart/validate",
        locale,
        cartVersion,
      },
      {
        schemaVersion: 1,
        expectedCartVersion: cartVersion,
        presentationLocale: locale,
      },
    ),
  create: (preflight: CheckoutPreflightView, email: string) =>
    post(
      { kind: "create", path: `${base}/sessions` },
      {
        schemaVersion: 1,
        preflightId: preflight.id,
        expectedCartVersion: preflight.cartVersion,
        email,
        policyAcceptances: preflight.policies.map(
          ({ policyKey, policyRevisionId, policyTranslationRevisionId }) => ({
            policyKey,
            policyRevisionId,
            policyTranslationRevisionId,
            accepted: true,
          }),
        ),
      },
    ),
  session: (sessionId: string): CheckoutCall => ({
    kind: "session",
    path: `${sessionPath(sessionId)}/status`,
    sessionId,
    method: "GET",
  }),
  capabilities: (
    sessionId: string,
    locale: SupportedLocale,
    country?: string,
  ): CheckoutCall => {
    const query = new URLSearchParams({
      presentationLocale: locale,
      supportedActionTypes: "REDIRECT",
    });
    if (country) query.set("country", country);
    return {
      kind: "capabilities",
      path: `${sessionPath(sessionId)}/capabilities?${query}`,
      sessionId,
      locale,
      method: "GET",
    };
  },
  start: (
    sessionId: string,
    capability: PaymentRuntimeCapabilityView,
    country: string,
  ) =>
    post(
      {
        kind: "attempt-create",
        path: `${sessionPath(sessionId)}/attempts`,
        sessionId,
      },
      {
        schemaVersion: 1,
        capabilityId: capability.id,
        country,
        configVersion: capability.configVersion,
        ruleVersion: capability.ruleVersion,
        supportedActionTypes: ["REDIRECT"],
      },
    ),
  attempt: (sessionId: string, attemptId: string): CheckoutCall => ({
    kind: "attempt",
    path: `${sessionPath(sessionId)}/attempts/${encodeURIComponent(attemptId)}`,
    sessionId,
    attemptId,
    method: "GET",
  }),
  recover: (sessionId: string, attemptId: string) =>
    post(
      {
        kind: "recover",
        path: `${sessionPath(sessionId)}/attempts/${encodeURIComponent(attemptId)}/recover`,
        sessionId,
        attemptId,
      },
      { schemaVersion: 1 },
    ),
};
/** Cookie authority is handled by the browser; CSRF and pending bodies live only in memory. */
export function createCheckoutTransport(
  _locale: SupportedLocale,
  fetcher: typeof fetch = fetch,
) {
  let csrf: string | null = null;
  let generation = 0;
  const active = new Set<AbortController>();
  async function request(call: CheckoutCall): Promise<CheckoutReply> {
    if (call.method === "POST" && !csrf)
      return { schemaVersion: 1, outcome: "FAILURE", code: "INVALID_ACCESS" };
    const epoch = generation;
    const abort = new AbortController();
    active.add(abort);
    const timer = setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await fetcher(call.path, {
        method: call.method,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: abort.signal,
        headers: {
          Accept: "application/json",
          ...(call.body ? { "Content-Type": "application/json" } : {}),
          ...(csrf ? { "x-csrf-token": csrf } : {}),
          ...(call.key ? { "Idempotency-Key": call.key } : {}),
        },
        ...(call.body ? { body: call.body } : {}),
      });
      const data: unknown = await response.json();
      const { validateCheckoutReply } = await import("./checkout-validation");
      const result = validateCheckoutReply(data, call);
      if (epoch !== generation || abort.signal.aborted)
        return { outcome: "UNKNOWN" };
      if (result.outcome === "SUCCESS") {
        const token = response.headers.get("x-csrf-token");
        if (!response.ok || !token || !/^[A-Za-z0-9_-]{43}$/u.test(token))
          throw new Error("CHECKOUT_UNAVAILABLE");
        csrf = token;
      } else if (response.ok) throw new Error("CHECKOUT_UNAVAILABLE");
      return result;
    } catch {
      return { outcome: "UNKNOWN" };
    } finally {
      clearTimeout(timer);
      active.delete(abort);
    }
  }
  return {
    request,
    dispose() {
      generation++;
      csrf = null;
      for (const abort of active) abort.abort();
      active.clear();
    },
  };
}
export type CheckoutTransport = ReturnType<typeof createCheckoutTransport>;
