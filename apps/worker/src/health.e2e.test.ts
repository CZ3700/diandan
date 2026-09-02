import { expect, test } from "vitest";

type InjectResponse = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  json: () => unknown;
}>;

type RuntimeApplication = Readonly<{
  init: () => Promise<unknown>;
  close: () => Promise<unknown>;
  getHttpAdapter: () => Readonly<{
    getInstance: () => Readonly<{
      inject: (
        options: Readonly<{ method: string; url: string }>,
      ) => Promise<InjectResponse>;
    }>;
  }>;
}>;

type BootstrapModule = Readonly<{
  createWorkerApplication: (
    environment: Readonly<Record<string, string | undefined>>,
  ) => Promise<RuntimeApplication>;
}>;

const testDatabaseUrl = [
  "postgresql://",
  "test-user",
  ":",
  "test-password",
  "@postgres:5432/fan_support",
].join("");

const validEnvironment = Object.freeze({
  NODE_ENV: "test",
  FAN_SUPPORT_DEPLOYMENT_ENV: "test",
  FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3003",
  FAN_SUPPORT_DATABASE_URL: testDatabaseUrl,
  FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "http://object-storage:9000",
  FAN_SUPPORT_OBJECT_STORAGE_BUCKET: "fan-support-media",
  FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
  FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: "TEST_ACCESS_KEY_ID",
  FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY:
    "TEST_OBJECT_STORAGE_SECRET_VALUE",
  FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
});

async function loadBootstrapModule(): Promise<BootstrapModule> {
  let loaded: unknown;
  try {
    loaded = await import("./bootstrap.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "worker bootstrap module must exist").toBeDefined();
  return loaded as BootstrapModule;
}

test("serves the worker health contract through Fastify", async () => {
  const { createWorkerApplication } = await loadBootstrapModule();
  const application = await createWorkerApplication(validEnvironment);

  try {
    await application.init();
    const response = await application
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({
      schemaVersion: 1,
      service: "worker",
      status: "ok",
    });
  } finally {
    await application.close();
  }
});

test("refuses to create the worker when required runtime config is missing", async () => {
  const { createWorkerApplication } = await loadBootstrapModule();

  await expect(
    createWorkerApplication({ NODE_ENV: "test" }),
  ).rejects.toMatchObject({
    code: "CONFIG_INVALID",
  });
});
