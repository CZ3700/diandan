import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { clearTimeout, setTimeout as scheduleTimeout } from "node:timers";

import { expect, test } from "vitest";

const testDatabaseUrl = [
  "postgresql://",
  "test-user",
  ":",
  "test-password",
  "@postgres:5432/fan_support",
].join("");

async function reserveAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Cannot reserve a test port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

function runFatalApiProcess(port: number): Promise<
  Readonly<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
    stdout: string;
  }>
> {
  const evaluation = [
    'await import("./src/main.ts");',
    'Promise.reject(new Error("PRIVATE_FATAL_ONE_17392"));',
    'Promise.reject(new Error("PRIVATE_FATAL_TWO_28403"));',
    'Promise.reject(new Error("PRIVATE_FATAL_THREE_39514"));',
  ].join("\n");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", evaluation],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(port),
        FAN_SUPPORT_DEPLOYMENT_ENV: "test",
        FAN_SUPPORT_SITE_ORIGIN: `http://localhost:${port}`,
        FAN_SUPPORT_DATABASE_URL: testDatabaseUrl,
        FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "http://object-storage:9000",
        FAN_SUPPORT_OBJECT_STORAGE_BUCKET: "fan-support-media",
        FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
        FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: "TEST_ACCESS_KEY_ID",
        FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY:
          "TEST_OBJECT_STORAGE_SECRET_VALUE",
        FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return new Promise((resolve, reject) => {
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    const timeout = scheduleTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Fatal process boundary did not terminate in time"));
    }, 15_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stderr, stdout });
    });
  });
}

test("contains repeated fatal errors without reflecting them to process output", async () => {
  const port = await reserveAvailablePort();
  const result = await runFatalApiProcess(port);
  const output = `${result.stdout}\n${result.stderr}`;

  expect(result.code).toBe(1);
  expect(result.signal).toBeNull();
  expect(output).not.toContain("PRIVATE_FATAL_ONE_17392");
  expect(output).not.toContain("PRIVATE_FATAL_TWO_28403");
  expect(output).not.toContain("PRIVATE_FATAL_THREE_39514");

  const records = result.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Readonly<Record<string, unknown>>);
  expect(
    records.filter((record) => record["event"] === "runtime.fatal_error"),
  ).toEqual([
    expect.objectContaining({
      errorCode: "FATAL_RUNTIME_ERROR",
      outcome: "failure",
    }),
  ]);
  expect(
    records.filter((record) => record["event"] === "runtime.stopped"),
  ).toHaveLength(1);
}, 20_000);
