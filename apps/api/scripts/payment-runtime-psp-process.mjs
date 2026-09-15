import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createPaymentTestPspServer } from "./payment-runtime-psp-server.mjs";

/** Secrets travel only over owned IPC, never argv, logs or evidence files. */
export async function startPaymentTestPspProcess(options) {
  const child = fork(fileURLToPath(import.meta.url), ["--owned-test-psp"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    execArgv: [],
  });
  const pending = new Map();
  let exited = false;
  const exit = new Promise((resolve) =>
    child.once("exit", () => {
      exited = true;
      for (const request of pending.values())
        request.reject(new Error("Owned TEST PSP exited"));
      pending.clear();
      resolve();
    }),
  );
  child.on("message", (message) => {
    const request = pending.get(message?.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok === true) request.resolve(message.value);
    else request.reject(new Error("Owned TEST PSP command failed"));
  });
  child.on("error", () => {
    for (const request of pending.values())
      request.reject(new Error("Owned TEST PSP process failed"));
    pending.clear();
  });
  function call(operation, value) {
    if (exited) return Promise.reject(new Error("Owned TEST PSP is stopped"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        pending.delete(id);
        reject(new Error("Owned TEST PSP command timed out"));
      }, 15_000);
      pending.set(id, {
        resolve: (result) => {
          globalThis.clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          globalThis.clearTimeout(timer);
          reject(error);
        },
      });
      child.send({ id, operation, value }, (error) => {
        if (error) {
          const request = pending.get(id);
          pending.delete(id);
          request?.reject(new Error("Owned TEST PSP IPC failed"));
        }
      });
    });
  }
  let closing;
  const close = () =>
    (closing ??= (async () => {
      if (exited) return;
      try {
        await call("STOP");
      } finally {
        if (!exited) child.kill("SIGTERM");
        const timer = globalThis.setTimeout(() => {
          if (!exited) child.kill("SIGKILL");
        }, 5000);
        await exit;
        globalThis.clearTimeout(timer);
      }
    })());
  try {
    const ready = await call("START", options);
    return {
      ...ready,
      pid: child.pid,
      arm: (value) => call("ARM", value),
      counts: () => call("COUNTS"),
      observations: () => call("OBSERVATIONS"),
      webhook: (value) => call("WEBHOOK", value),
      hostedAction: (attemptId) => call("HOSTED_ACTION", attemptId),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[2] === "--owned-test-psp" && process.send) {
  let server, closing;
  const close = () =>
    (closing ??= (async () => {
      await server?.close();
    })());
  process.on("SIGTERM", () => {
    void close().finally(() => process.exit(0));
  });
  process.on("disconnect", () => {
    void close().finally(() => process.exit(0));
  });
  process.on("message", async (message) => {
    const { id, operation, value } = message ?? {};
    try {
      let result;
      if (operation === "START" && !server) {
        server = await createPaymentTestPspServer(value);
        result = { origin: server.origin, binding: server.binding };
      } else if (operation === "ARM" && server) server.arm(value);
      else if (operation === "COUNTS" && server) result = await server.counts();
      else if (operation === "OBSERVATIONS" && server)
        result = server.observations();
      else if (operation === "WEBHOOK" && server)
        result = await server.webhook(value);
      else if (operation === "HOSTED_ACTION" && server)
        result = await server.hostedAction(value);
      else if (operation === "STOP") await close();
      else throw new Error("Unknown owned TEST PSP command");
      process.send?.({ id, ok: true, value: result });
    } catch {
      process.send?.({ id, ok: false });
    }
  });
}
