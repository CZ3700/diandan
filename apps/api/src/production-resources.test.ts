import { createPostgresPersistence } from "@fan-support/persistence-postgres";
import { expect, test, vi } from "vitest";

import { resolveApiProductionConfig } from "./production-config.js";
import { createApiProductionResources } from "./production-resources.js";
import {
  completeProductionEnvironment,
  coreEnvironment,
  quietLogger,
} from "./test-support/production-environment.js";

function observedPersistence() {
  const opened: { config: unknown; options: unknown }[] = [];
  const closes = vi.fn();
  const createPersistence = vi.fn(
    (...args: Parameters<typeof createPostgresPersistence>) => {
      opened.push({ config: args[0], options: args[1] });
      const persistence = createPostgresPersistence(...args);
      return {
        ...persistence,
        close: async () => {
          closes();
          await persistence.close();
        },
      };
    },
  );
  return { createPersistence, opened, closes };
}

test("a pool opens only for a borrowed role and closes after its owner and borrowers return", async () => {
  const observed = observedPersistence();
  const resources = createApiProductionResources(
    resolveApiProductionConfig(completeProductionEnvironment),
    {
      logger: quietLogger,
      factories: { createPersistence: observed.createPersistence },
    },
  );
  expect(observed.createPersistence).not.toHaveBeenCalled();
  const first = resources.persistence();
  const second = resources.persistence();
  expect(observed.opened).toEqual([
    {
      config: {
        connectionString:
          completeProductionEnvironment.FAN_SUPPORT_DATABASE_URL,
        application_name: "fan-support-api",
        connectionTimeoutMillis: 5000,
      },
      options: {
        catalogPublicMediaBaseUrl: "https://media.example.invalid",
        onInfrastructureFailure: expect.any(Function),
      },
    },
  ]);
  const configuration = resources.paymentConfigurationPersistence();
  expect(observed.opened[1]?.config).toEqual({
    connectionString: completeProductionEnvironment.FAN_SUPPORT_DATABASE_URL,
    application_name: "fan-support-api-payment-configuration",
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    query_timeout: 6000,
  });
  await first.close();
  await resources.lifecycle.stop();
  expect(observed.closes).toHaveBeenCalledTimes(0);
  await second.close();
  await configuration.close();
  expect(observed.closes).toHaveBeenCalledTimes(2);
});

test("pool failures are reported through the allowlisted structured event", () => {
  const observed = observedPersistence();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const resources = createApiProductionResources(
    resolveApiProductionConfig(coreEnvironment),
    { logger, factories: { createPersistence: observed.createPersistence } },
  );
  void resources.persistence();
  const report = (
    observed.opened[0]?.options as {
      onInfrastructureFailure(notice: { code: string }): void;
    }
  ).onInfrastructureFailure;
  report({ code: "TEMPORARY_UNAVAILABLE" });
  expect(logger.error).toHaveBeenCalledWith("persistence.pool_failure", {
    errorCode: "TEMPORARY_UNAVAILABLE",
    outcome: "failure",
  });
  return resources.lifecycle.stop();
});

test("key and media clients exist once, only for the surfaces that need them", async () => {
  const core = createApiProductionResources(
    resolveApiProductionConfig(coreEnvironment),
    { logger: quietLogger },
  );
  expect(core.keys).toBeUndefined();
  expect(core.media).toBeUndefined();
  const complete = createApiProductionResources(
    resolveApiProductionConfig(completeProductionEnvironment),
    { logger: quietLogger },
  );
  expect(complete.keys).toMatchObject({
    activePepperVersion: "blind-v1",
    pepperVersions: ["blind-v1"],
  });
  expect(complete.keys?.keyManagement.computeBlindIndex).toBeTypeOf("function");
  expect(complete.media?.storage.createUploadGrant).toBeTypeOf("function");
  expect(complete.media?.inspector.inspect).toBeTypeOf("function");
  await Promise.all([core.lifecycle.stop(), complete.lifecycle.stop()]);
});
