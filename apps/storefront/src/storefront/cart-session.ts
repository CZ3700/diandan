import type {
  CartRuntimeView,
  CartEditorResponse,
  CartEditResponse,
  CartRuntimeCurrentResponse,
  SupportedLocale,
} from "@fan-support/contracts";

export type CartResult =
  CartRuntimeCurrentResponse | CartEditResponse | { outcome: "UNKNOWN" };
export type CartSnapshot = Readonly<{
  status: "idle" | "loading" | "ready" | "empty" | "error";
  cart: CartRuntimeView | null;
}>;
export type CartMutation = Readonly<{
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body: string;
  key: string;
}>;
export function createCartMutation(
  method: CartMutation["method"],
  path: string,
  body: unknown,
): CartMutation {
  return Object.freeze({
    method,
    path,
    body: JSON.stringify(body),
    key: crypto.randomUUID(),
  });
}

/** One browser session; neither credentials nor drafts enter browser persistence. */
export function createCartSession(
  locale: SupportedLocale,
  fetcher: typeof fetch = fetch,
) {
  let state: CartSnapshot = { status: "idle", cart: null };
  let csrf: string | null = null;
  let sequence = 0;
  const listeners = new Set<() => void>();
  const publish = (next: CartSnapshot) => {
    state = next;
    for (const listener of listeners) listener();
  };
  async function send(
    path: string,
    method: string,
    body?: string,
    key?: string,
  ) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8_000);
    try {
      const response = await fetcher(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: abort.signal,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(csrf ? { "x-csrf-token": csrf } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body ? { body } : {}),
      });
      const data: unknown = await response.json();
      const validation = await import("./cart-validation");
      const value = validation.validateCartReply(
        data,
        path.endsWith("/editor")
          ? "editor"
          : method === "PATCH" || method === "DELETE"
            ? "edit"
            : "cart",
        locale,
      );
      if (value.outcome === "SUCCESS") {
        const token = response.headers.get("x-csrf-token");
        if (!response.ok || !token)
          throw new Error("CART_RESPONSE_UNAVAILABLE");
        csrf = token;
      }
      return value;
    } finally {
      clearTimeout(timer);
    }
  }
  const commit = (value: CartResult, requestSequence: number) => {
    if (requestSequence !== sequence) return;
    if (value.outcome === "SUCCESS")
      publish({ status: "ready", cart: value.cart });
    else if (
      value.outcome === "FAILURE" &&
      (value.code === "CART_NOT_FOUND" || value.code === "CART_EXPIRED")
    ) {
      csrf = null;
      publish({ status: "empty", cart: null });
    } else
      publish({
        ...state,
        status: value.outcome === "FAILURE" && state.cart ? "ready" : "error",
      });
  };
  async function read() {
    const requestSequence = ++sequence;
    publish({ ...state, status: "loading" });
    try {
      const value = await send(
        `/api/storefront/cart?presentationLocale=${locale}`,
        "GET",
      );
      if (value.outcome === "SUCCESS" && value.action !== "READ")
        throw new Error("CART_RESPONSE_UNAVAILABLE");
      commit(value as CartResult, requestSequence);
      return value as CartResult;
    } catch {
      if (requestSequence === sequence) publish({ ...state, status: "error" });
      return { outcome: "UNKNOWN" } as const;
    }
  }
  async function initialize(
    market: string,
    currency: string,
  ): Promise<CartResult> {
    if (state.cart && csrf)
      return {
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "READ",
        cart: state.cart,
      };
    const current = await read();
    if (current.outcome === "SUCCESS") return current;
    if (
      current.outcome !== "FAILURE" ||
      !["CART_NOT_FOUND", "CART_EXPIRED"].includes(current.code)
    )
      return current;
    const requestSequence = ++sequence;
    const create = () =>
      send(
        "/api/storefront/cart",
        "POST",
        JSON.stringify({
          schemaVersion: 1,
          presentationLocale: locale,
          market,
          currency,
        }),
      );
    try {
      let value = await create();
      // Reads keep a finished cart's cookie for its paid checkout; creating clears it, so try once more.
      if (value.outcome === "FAILURE" && value.code === "CART_EXPIRED")
        value = await create();
      if (value.outcome === "SUCCESS" && value.action !== "INITIALIZED")
        throw new Error("CART_RESPONSE_UNAVAILABLE");
      commit(value as CartResult, requestSequence);
      return value as CartResult;
    } catch {
      commit({ outcome: "UNKNOWN" }, requestSequence);
      return { outcome: "UNKNOWN" };
    }
  }
  async function mutate(request: CartMutation): Promise<CartResult> {
    const requestSequence = ++sequence;
    if (!csrf)
      return { schemaVersion: 1, outcome: "FAILURE", code: "CART_NOT_FOUND" };
    try {
      const value = (await send(
        request.path,
        request.method,
        request.body,
        request.key,
      )) as CartResult;
      const overtaken = requestSequence !== sequence;
      commit(value, requestSequence);
      // A read begun during this write may have observed the previous version.
      if (overtaken && value.outcome === "SUCCESS") await read();
      return value;
    } catch {
      commit({ outcome: "UNKNOWN" }, requestSequence);
      return { outcome: "UNKNOWN" };
    }
  }
  async function editor(
    itemId: string,
    cartVersion: number,
    itemVersion: number,
  ): Promise<CartEditorResponse | { outcome: "UNKNOWN" }> {
    if (!csrf)
      return { schemaVersion: 1, outcome: "FAILURE", code: "CART_NOT_FOUND" };
    try {
      const value = await send(
        `/api/storefront/cart/items/${itemId}/editor`,
        "POST",
        JSON.stringify({
          schemaVersion: 1,
          presentationLocale: locale,
          expectedCartVersion: cartVersion,
          expectedItemVersion: itemVersion,
        }),
      );
      if (
        value.outcome === "SUCCESS" &&
        (value.action !== "EDITOR_READ" ||
          value.cartItemId !== itemId ||
          value.cartVersion !== cartVersion ||
          value.itemVersion !== itemVersion)
      )
        throw new Error("CART_RESPONSE_UNAVAILABLE");
      return value as CartEditorResponse;
    } catch {
      return { outcome: "UNKNOWN" };
    }
  }
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read,
    initialize,
    mutate,
    editor,
  };
}
export type CartSession = ReturnType<typeof createCartSession>;
