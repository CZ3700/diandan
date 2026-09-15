import {
  publicOrderIdSchema,
  type OrderAccessDetail,
  type OrderAccessFailureCode,
} from "@fan-support/contracts";
import {
  createOrderTransport,
  type OrderReply,
  type OrderTransport,
} from "./order-transport";
export type OrderSnapshot = Readonly<{
  busy: boolean;
  initialized: boolean;
  publicOrderId: string | null;
  order: OrderAccessDetail | null;
  error: OrderAccessFailureCode | "INVALID_LINK" | null;
  retryAt: number | null;
  revoked: boolean;
}>;
const initial = (): OrderSnapshot => ({
  busy: false,
  initialized: false,
  publicOrderId: null,
  order: null,
  error: null,
  retryAt: null,
  revoked: false,
});
const uncertain = (reply: OrderReply) =>
  reply.outcome === "UNKNOWN" ||
  (reply.outcome === "FAILURE" && reply.code === "TEMPORARY_UNAVAILABLE");
/** Coordinates presentation and recovery. A public ID never substitutes for server authorization. */
export function createOrderController(
  factory: () => OrderTransport = createOrderTransport,
  now: () => number = Date.now,
) {
  let state = initial(),
    epoch = 0,
    active = true;
  let api = factory();
  let closing = false;
  let checkoutGrant:
    ((transport: OrderTransport) => Promise<OrderReply>) | null = null;
  const listeners = new Set<() => void>();
  function update(change: Partial<OrderSnapshot>) {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  }
  function reset(id: string) {
    epoch++;
    api.dispose();
    api = factory();
    active = true;
    closing = false;
    update({ ...initial(), publicOrderId: id.toLowerCase() });
  }
  function fail(reply: OrderReply) {
    const error =
      reply.outcome === "FAILURE" ? reply.code : "TEMPORARY_UNAVAILABLE";
    const seconds =
      reply.outcome === "FAILURE" && "retryAfterSeconds" in reply
        ? reply.retryAfterSeconds
        : undefined;
    update({
      busy: false,
      initialized: true,
      order: null,
      error,
      retryAt:
        error === "RATE_LIMITED" && seconds ? now() + seconds * 1000 : null,
    });
  }
  async function invoke(work: () => Promise<OrderReply>, version: number) {
    let reply: OrderReply;
    try {
      reply = await work();
    } catch {
      reply = { schemaVersion: 1, outcome: "UNKNOWN" };
    }
    return active && epoch === version ? reply : null;
  }
  function applyRead(reply: OrderReply, id: string) {
    if (
      reply.outcome === "SUCCESS" &&
      reply.action === "READ" &&
      reply.order.publicOrderId.toLowerCase() === id.toLowerCase()
    ) {
      checkoutGrant = null;
      update({
        busy: false,
        initialized: true,
        order: reply.order,
        error: null,
        retryAt: null,
      });
    } else fail(reply);
  }
  async function load(id: string, allowGrant: boolean) {
    if (
      !active ||
      state.busy ||
      (state.retryAt !== null && now() < state.retryAt)
    )
      return;
    const version = epoch;
    update({ busy: true, error: null, revoked: false });
    let reply = await invoke(() => api.read(id), version);
    if (!reply) return;
    if (
      allowGrant &&
      checkoutGrant &&
      reply.outcome === "FAILURE" &&
      reply.code === "ACCESS_DENIED"
    ) {
      reply = await invoke(() => checkoutGrant!(api), version);
      if (!reply) return;
      if (reply.outcome === "SUCCESS" && reply.action === "GRANTED") {
        if (reply.grant.publicOrderId.toLowerCase() !== id.toLowerCase()) {
          fail({ schemaVersion: 1, outcome: "FAILURE", code: "ACCESS_DENIED" });
          return;
        }
      } else if (!uncertain(reply)) {
        fail(reply);
        return;
      }
      reply = await invoke(() => api.read(id), version);
      if (!reply) return;
    }
    applyRead(reply, id);
  }
  function closed() {
    closing = false;
    checkoutGrant = null;
    api.dispose();
    update({
      busy: false,
      initialized: true,
      revoked: true,
      order: null,
      error: null,
      retryAt: null,
    });
  }
  async function closeAccess(refreshAuthority: boolean) {
    if (
      !active ||
      state.busy ||
      !state.publicOrderId ||
      (state.retryAt !== null && now() < state.retryAt)
    )
      return;
    closing = true;
    const id = state.publicOrderId,
      version = epoch;
    update({ busy: true, order: null, error: null });
    if (refreshAuthority) {
      const read = await invoke(() => api.read(id), version);
      if (!read) return;
      if (read.outcome === "FAILURE" && read.code === "ACCESS_DENIED") {
        closed();
        return;
      }
      if (
        read.outcome !== "SUCCESS" ||
        read.action !== "READ" ||
        read.order.publicOrderId.toLowerCase() !== id.toLowerCase()
      ) {
        fail(read);
        return;
      }
    }
    const reply = await invoke(() => api.revoke(id), version);
    if (!reply) return;
    if (
      reply.outcome === "SUCCESS" &&
      reply.action === "REVOKED" &&
      reply.publicOrderId.toLowerCase() === id.toLowerCase()
    )
      closed();
    else fail(reply);
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async read(id: string) {
      checkoutGrant = null;
      if (!publicOrderIdSchema.safeParse(id).success) {
        this.invalidate();
        return;
      }
      reset(id);
      await load(id, false);
    },
    async fromCheckout(
      id: string,
      bootstrap: (transport: OrderTransport) => Promise<OrderReply>,
    ) {
      if (!publicOrderIdSchema.safeParse(id).success) {
        this.invalidate();
        return;
      }
      reset(id);
      checkoutGrant = bootstrap;
      await load(id, true);
    },
    async exchange(entry: { token: string; publicOrderId: string }) {
      if (state.busy) return;
      checkoutGrant = null;
      reset(entry.publicOrderId);
      const version = epoch;
      update({ busy: true });
      const reply = await invoke(() => api.exchange(entry.token), version);
      if (!reply) return;
      if (reply.outcome === "SUCCESS" && reply.action === "GRANTED") {
        if (
          reply.grant.publicOrderId.toLowerCase() !==
          entry.publicOrderId.toLowerCase()
        ) {
          fail({ schemaVersion: 1, outcome: "FAILURE", code: "ACCESS_DENIED" });
          return;
        }
      } else if (!uncertain(reply)) {
        fail(reply);
        return;
      }
      const result = await invoke(() => api.read(entry.publicOrderId), version);
      if (result) applyRead(result, entry.publicOrderId);
    },
    async retry() {
      if (closing) await closeAccess(true);
      else if (active && !state.revoked && state.publicOrderId)
        await load(state.publicOrderId, checkoutGrant !== null);
    },
    async revoke() {
      await closeAccess(false);
    },
    suspend() {
      active = false;
      epoch++;
      api.dispose();
      update({ busy: false, order: null });
    },
    async resume() {
      if (active || state.revoked || !state.publicOrderId) return;
      active = true;
      epoch++;
      api = factory();
      if (closing) await closeAccess(true);
      else await load(state.publicOrderId, false);
    },
    invalidate() {
      this.dispose();
      active = true;
      update({ initialized: true, error: "INVALID_LINK" });
    },
    dispose() {
      active = false;
      epoch++;
      checkoutGrant = null;
      closing = false;
      api.dispose();
      update(initial());
    },
  };
}
export type OrderController = ReturnType<typeof createOrderController>;
