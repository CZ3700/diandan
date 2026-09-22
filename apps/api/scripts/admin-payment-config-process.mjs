import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { createStructuredLogger } from "@fan-support/observability";
import { Client } from "pg";
import { createPostgresPersistence } from "@fan-support/persistence-postgres";
import { createApiApplication } from "../dist/bootstrap.js";
import {
  createLocalAdminPaymentConfigurationComposition,
  createTestPaymentRuntimeComposition,
} from "../dist/index.js";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import {
  createConfigurationTestFactories,
  createConfigurationTestTlsFetch,
} from "./admin-payment-config-connectors.mjs";
/** Each child owns a distinct pool, connector registry and independent automatic projection timer. */
export async function startConfigurationTestApi(
  options,
  { keyManagement, onLog = () => undefined },
) {
  const child = fork(
    fileURLToPath(import.meta.url),
    ["--owned-payment-configuration-api"],
    { stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [] },
  );
  const pending = new Map();
  let exited = false;
  const exitedPromise = new Promise((resolve) =>
    child.once("exit", () => {
      exited = true;
      for (const entry of pending.values())
        entry.reject(new Error("Owned configuration API exited"));
      pending.clear();
      resolve();
    }),
  );
  child.on("message", async (message) => {
    if (message?.kind === "KMS") {
      try {
        if (
          ![
            "computeBlindIndex",
            "encryptEnvelope",
            "encryptEnvelopeFields",
            "decryptEnvelope",
          ].includes(message.method)
        )
          throw new Error("Invalid TEST KMS operation");
        const value = await keyManagement[message.method](message.value);
        child.send({ kind: "KMS_RESULT", id: message.id, ok: true, value });
      } catch {
        if (child.connected)
          child.send({ kind: "KMS_RESULT", id: message.id, ok: false });
      }
      return;
    }
    if (message?.kind === "DIAGNOSTIC") {
      console.log(
        `Configuration child PostgreSQL ${JSON.stringify(message.value)}`,
      );
      return;
    }
    if (message?.kind === "LOG") {
      onLog(message.value);
      return;
    }
    const entry = pending.get(message?.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.value);
    else
      entry.reject(
        new Error(
          `Owned configuration API ${message.stage ?? "operation"} failed`,
        ),
      );
  });
  child.on("error", () => {
    for (const entry of pending.values())
      entry.reject(new Error("Owned configuration API process failed"));
    pending.clear();
  });
  function call(operation, value) {
    if (exited)
      return Promise.reject(new Error("Owned configuration API stopped"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Owned configuration API timed out"));
      }, 30000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.send({ kind: "COMMAND", id, operation, value }, (error) => {
        if (error) {
          const entry = pending.get(id);
          pending.delete(id);
          entry?.reject(new Error("Owned configuration API IPC failed"));
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
        const timer = setTimeout(() => {
          if (!exited) child.kill("SIGKILL");
        }, 5000);
        await exitedPromise;
        clearTimeout(timer);
      }
    })());
  try {
    const ready = await call("START", options);
    return {
      ...ready,
      pid: child.pid,
      observe: () => call("OBSERVE"),
      dropNextPublicationResponse: () => call("DROP_NEXT_PUBLICATION_RESPONSE"),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
if (process.argv[2] === "--owned-payment-configuration-api" && process.send) {
  const originalQuery = Client.prototype.query;
  Client.prototype.query = function (...args) {
    const result = originalQuery.apply(this, args);
    if (!result?.catch) return result;
    return result.catch((error) => {
      const diagnostic = {
        code: /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : null,
        guard:
          /PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(
            error?.where ?? "",
          )?.[1] ?? null,
        constraint: /^[a-z_][a-z_0-9]{0,127}$/u.test(error?.constraint ?? "")
          ? error.constraint
          : null,
      };
      process.send({ kind: "DIAGNOSTIC", value: diagnostic });
      throw error;
    });
  };
  const pending = new Map();
  let app,
    configuration,
    payment,
    dropResponse = false,
    databaseFailures = 0,
    closing;
  const kms = (method) => (value) =>
    new Promise((resolve, reject) => {
      const id = randomUUID(),
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("TEST KMS IPC timeout"));
        }, 10000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: () => {
          clearTimeout(timer);
          reject(new Error("TEST KMS unavailable"));
        },
      });
      process.send({ kind: "KMS", id, method, value });
    });
  const close = () =>
    (closing ??= (async () => {
      await app?.close();
      await payment?.paymentRuntime.stop();
      await configuration?.adminPaymentConfigurationRuntime.stop();
    })());
  process.on("message", async (message) => {
    if (message?.kind === "KMS_RESULT") {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (entry) {
        if (message.ok) entry.resolve(message.value);
        else entry.reject();
      }
      return;
    }
    if (message?.kind !== "COMMAND") return;
    try {
      let value;
      if (message.operation === "START") {
        if (app) throw new Error("Already started");
        const input = message.value,
          fetcher = await createConfigurationTestTlsFetch(input.caPath);
        const factories = createConfigurationTestFactories({
          ...input.deployments,
          fetcher,
        });
        configuration = createLocalAdminPaymentConfigurationComposition(
          {
            environment: "LOCAL_OIDC",
            database: input.database,
            tokenPepper: input.tokenPepper,
            allowedOrigin: input.adminOrigin,
            connections: input.connections,
            factories,
            initialProviderAccountIds: input.initialProviderAccountIds,
            healthPolicies: input.healthPolicies,
            refreshDelayMs: input.refreshDelayMs,
          },
          {
            createPersistence(database) {
              const actual = createPostgresPersistence(database);
              return {
                ...actual,
                adminPaymentConfigurationTransactionManager: {
                  async runInAdminPaymentConfigurationTransaction(work) {
                    try {
                      return await actual.adminPaymentConfigurationTransactionManager.runInAdminPaymentConfigurationTransaction(
                        work,
                      );
                    } catch (error) {
                      databaseFailures++;
                      throw error;
                    }
                  },
                },
              };
            },
          },
        );
        payment = createTestPaymentRuntimeComposition({
          environment: "TEST",
          database: input.database,
          publicMediaBaseUrl: input.publicMediaBaseUrl,
          configuration: input.paymentConfiguration,
          providers: [],
          providerDirectory: configuration.providerDirectory,
          healthPolicies: input.healthPolicies,
          readHealthPolicies: configuration.readHealthPolicies,
          keyManagement: Object.fromEntries(
            [
              "computeBlindIndex",
              "encryptEnvelope",
              "encryptEnvelopeFields",
              "decryptEnvelope",
            ].map((method) => [method, kms(method)]),
          ),
          activePepperVersion: "test-mac",
          pepperVersions: ["test-mac"],
        });
        app = await createApiApplication(
          {
            ...preflightEnvironment(input.database),
            FAN_SUPPORT_SITE_ORIGIN:
              input.paymentConfiguration.publicStorefrontOrigin,
          },
          {
            ...configuration,
            paymentRuntimeRoute: payment.paymentRuntimeRoute,
            paymentRuntime: {
              start: async () => undefined,
              stop: () => payment.paymentRuntime.stop(),
            },
            logger: createStructuredLogger({
              service: "api",
              write: (value) => process.send({ kind: "LOG", value }),
            }),
          },
        );
        app
          .getHttpAdapter()
          .getInstance()
          .addHook("onSend", async (request, reply, payload) => {
            if (
              dropResponse &&
              request.url.endsWith("/payment-configuration/publish") &&
              reply.statusCode === 200
            ) {
              dropResponse = false;
              reply.raw.destroy();
            }
            return payload;
          });
        await app.listen(0, "127.0.0.1");
        value = { base: await app.getUrl() };
      } else if (message.operation === "OBSERVE") {
        value = {
          generation: configuration.generation,
          databaseFailures,
          accounts: configuration.providerDirectory
            .getRegistrations()
            .map((entry) => entry.configuration.providerAccountId),
          policies: configuration.readHealthPolicies().map((policy) => ({
            providerAccountId: policy.providerAccountId,
            version: policy.version,
            failureThreshold: policy.failureThreshold,
          })),
        };
      } else if (message.operation === "DROP_NEXT_PUBLICATION_RESPONSE") {
        dropResponse = true;
        value = true;
      } else if (message.operation === "STOP") {
        await close();
        value = true;
      } else throw new Error("Unknown operation");
      process.send({ id: message.id, ok: true, value }, () => {
        if (message.operation === "STOP") process.disconnect();
      });
    } catch {
      process.send({ id: message.id, ok: false, stage: message.operation });
    }
  });
  process.on("disconnect", () => {
    void close().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void close().finally(() => process.exit(0));
  });
}
