import { fork } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { withoutLocalPaymentCredentials } from "./local-experience-payment-profile.mjs";

/** Configuration travels only through local IPC; the worker owns a distinct process and database pools. */
export async function startLocalExperienceWorkerProcess(
  options,
  { onLog = () => undefined } = {},
) {
  const child = fork(
    fileURLToPath(import.meta.url),
    ["--local-experience-worker"],
    {
      execArgv: [],
      env: {
        ...Object.fromEntries(
          Object.entries(withoutLocalPaymentCredentials(process.env)).filter(
            ([key]) => !key.startsWith("FAN_SUPPORT_"),
          ),
        ),
        NODE_EXTRA_CA_CERTS: options.config.tls.caCertificatePath,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let exited = false,
    stopping;
  const exit = new Promise((resolve) =>
    child.once("exit", () => {
      exited = true;
      resolve();
    }),
  );
  child.stdout.on("data", (chunk) => onLog(chunk.toString()));
  child.stderr.on("data", (chunk) => onLog(chunk.toString()));
  const close = () =>
    (stopping ??= (async () => {
      if (exited) return;
      if (child.connected) child.send({ kind: "STOP" });
      const timer = setTimeout(() => {
        if (!exited) child.kill("SIGKILL");
      }, 15000);
      try {
        await exit;
      } finally {
        clearTimeout(timer);
      }
    })());
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Local worker start timed out")),
        30000,
      );
      const fail = () => {
        clearTimeout(timer);
        reject(new Error("Local worker did not start"));
      };
      child.once("error", fail);
      child.once("exit", fail);
      child.on("message", (message) => {
        if (message?.kind === "READY") {
          clearTimeout(timer);
          child.off("exit", fail);
          child.off("error", fail);
          resolve(message.value);
        }
        if (message?.kind === "FAILED") fail();
      });
      child.send({ kind: "START", options });
    });
    return { ...ready, pid: child.pid, close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[2] === "--local-experience-worker" && process.send) {
  const owned = [];
  let startup, closing;
  const own = (_name, close) => owned.push(close);
  const close = () =>
    (closing ??= (async () => {
      await startup?.catch(() => undefined);
      for (const stop of owned.reverse()) await stop().catch(() => undefined);
      if (process.connected) process.disconnect();
    })());
  process.on("message", async (message) => {
    if (message?.kind === "STOP") {
      await close();
      return;
    }
    if (message?.kind !== "START" || startup || closing) return;
    startup = (async () => {
      try {
        const { createLocalExperienceMailTransport } =
          await import("./local-experience-services-mail.mjs");
        const { startLocalExperienceWorker } =
          await import("./local-experience-worker.mjs");
        const mail = await createLocalExperienceMailTransport({
          config: message.options.config,
        });
        const value = await startLocalExperienceWorker({
          ...message.options,
          mail,
          own,
        });
        process.send?.({ kind: "READY", value });
      } catch {
        process.send?.({ kind: "FAILED" });
        throw new Error("Local worker composition failed");
      }
    })();
    await startup.catch(() => close());
  });
  process.once("SIGTERM", () => {
    void close();
  });
  process.once("SIGINT", () => {
    void close();
  });
  process.once("disconnect", () => {
    void close();
  });
}
