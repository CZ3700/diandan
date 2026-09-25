import { cartRuntimeCurrentResponseSchema } from "@fan-support/contracts";

/** Fixed cart routes only; request/body lifetime is drained before navigation. */
export function observePaymentBrowserCart({ page, origin, accept }) {
  const pending = new Set();
  function observe(request) {
    const url = new globalThis.URL(request.url());
    const category =
      url.pathname === "/api/storefront/cart"
        ? request.method() === "GET"
          ? "READ_CART"
          : request.method() === "POST"
            ? "INITIALIZE_CART"
            : null
        : url.pathname === "/api/storefront/cart/items" &&
            request.method() === "POST"
          ? "ADD_CART_ITEM"
          : null;
    if (url.origin !== origin || !category) return;
    let task;
    task = (async () => {
      let status = null;
      try {
        const response = await request.response();
        if (!response) {
          accept({ category, status, code: "TRANSPORT_FAILED" });
          return;
        }
        status = response.status();
        const parsed = cartRuntimeCurrentResponseSchema.safeParse(
          await response.json(),
        );
        accept({
          category,
          status,
          code: !parsed.success
            ? "SCHEMA_INVALID"
            : parsed.data.outcome === "FAILURE"
              ? parsed.data.code
              : "SUCCESS",
          csrfPresent: Boolean(response.headers()["x-csrf-token"]),
        });
      } catch {
        accept({ category, status, code: "BODY_UNAVAILABLE" });
      } finally {
        pending.delete(task);
      }
    })();
    pending.add(task);
  }
  page.on("request", observe);
  return {
    async settled() {
      let timer;
      try {
        await Promise.race([
          (async () => {
            while (pending.size) await Promise.all([...pending]);
          })(),
          new Promise((_, reject) => {
            timer = globalThis.setTimeout(
              () => reject(new Error("CART_OBSERVER_DRAIN_TIMEOUT")),
              15_000,
            );
          }),
        ]);
      } finally {
        globalThis.clearTimeout(timer);
      }
    },
    dispose() {
      page.off("request", observe);
      if (pending.size) throw new Error("CART_OBSERVER_UNSETTLED");
    },
  };
}
