import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const composeFile = path.join(workspaceRoot, "infra/compose.preview.yml");
const projectName = "fan-support-preview";
const bucketName = "fan-support-media";
const region = "us-east-1";

const composePrefix = [
  "compose",
  "--project-name",
  projectName,
  "--file",
  composeFile,
];

function createSecrets() {
  return Object.freeze({
    postgresPassword: randomBytes(24).toString("hex"),
    objectStorageAccessKeyId: `local${randomBytes(12).toString("hex")}`,
    objectStorageSecretAccessKey: randomBytes(32).toString("hex"),
  });
}

function composeEnvironment(secrets = createSecrets()) {
  return {
    ...process.env,
    COMPOSE_PARALLEL_LIMIT: "1",
    PREVIEW_OBJECT_STORAGE_ACCESS_KEY_ID: secrets.objectStorageAccessKeyId,
    PREVIEW_OBJECT_STORAGE_SECRET_ACCESS_KEY:
      secrets.objectStorageSecretAccessKey,
    PREVIEW_POSTGRES_PASSWORD: secrets.postgresPassword,
  };
}

function runDocker(arguments_, options = {}) {
  const capture = options.capture === true;
  const result = spawnSync("docker", arguments_, {
    cwd: workspaceRoot,
    encoding: capture ? "utf8" : undefined,
    env: options.environment ?? composeEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
    stdio: capture ? "pipe" : "inherit",
  });

  if (result.error !== undefined || result.status !== 0) {
    throw new Error(options.failureMessage ?? "Docker command failed");
  }

  return capture ? String(result.stdout) : "";
}

function runCompose(arguments_, options = {}) {
  return runDocker([...composePrefix, ...arguments_], options);
}

function readEnvironmentValue(entries, name) {
  const prefix = `${name}=`;
  const entry = entries.find((candidate) => candidate.startsWith(prefix));
  return entry?.slice(prefix.length);
}

function readContainerEnvironment(serviceName) {
  const containerId = runCompose(
    ["--profile", "preview", "ps", "--quiet", serviceName],
    {
      capture: true,
      failureMessage: `Cannot locate the ${serviceName} preview container`,
    },
  ).trim();

  if (containerId === "") {
    throw new Error(`The ${serviceName} preview container is not running`);
  }

  const text = runDocker(
    ["inspect", "--format", "{{json .Config.Env}}", containerId],
    {
      capture: true,
      failureMessage: `Cannot inspect the ${serviceName} preview container`,
    },
  );

  try {
    const parsed = JSON.parse(text);
    if (
      !Array.isArray(parsed) ||
      parsed.some((entry) => typeof entry !== "string")
    ) {
      throw new Error("invalid environment shape");
    }
    return parsed;
  } catch {
    throw new Error(`Cannot read the ${serviceName} preview environment`);
  }
}

function readRunningSecrets() {
  const postgresEnvironment = readContainerEnvironment("postgres");
  const storageEnvironment = readContainerEnvironment("object-storage");
  const postgresPassword = readEnvironmentValue(
    postgresEnvironment,
    "POSTGRES_PASSWORD",
  );
  const objectStorageAccessKeyId = readEnvironmentValue(
    storageEnvironment,
    "ROOT_ACCESS_KEY_ID",
  );
  const objectStorageSecretAccessKey = readEnvironmentValue(
    storageEnvironment,
    "ROOT_SECRET_ACCESS_KEY",
  );

  if (
    postgresPassword === undefined ||
    objectStorageAccessKeyId === undefined ||
    objectStorageSecretAccessKey === undefined
  ) {
    throw new Error("Preview credentials are unavailable");
  }

  return Object.freeze({
    postgresPassword,
    objectStorageAccessKeyId,
    objectStorageSecretAccessKey,
  });
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function signedS3Headers(method, url, accessKeyId, secretAccessKey) {
  const now = new Date();
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/gu, "");
  const date = iso.slice(0, 8);
  const payloadHash = hash("");
  const canonicalHeaders = [
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${iso}`,
    "",
  ].join("\n");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    iso,
    scope,
    hash(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${secretAccessKey}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": iso,
  };
}

async function requestS3(method, secrets) {
  const url = new URL(`http://127.0.0.1:7070/${bucketName}`);
  return globalThis.fetch(url, {
    method,
    headers: signedS3Headers(
      method,
      url,
      secrets.objectStorageAccessKeyId,
      secrets.objectStorageSecretAccessKey,
    ),
  });
}

async function ensureBucket(secrets) {
  const createResponse = await requestS3("PUT", secrets);
  if (createResponse.status !== 200 && createResponse.status !== 409) {
    throw new Error(
      `Object-storage bucket creation failed with status ${createResponse.status}`,
    );
  }

  const headResponse = await requestS3("HEAD", secrets);
  if (!headResponse.ok) {
    throw new Error(
      `Object-storage bucket probe failed with status ${headResponse.status}`,
    );
  }
}

function requestLocalHttps(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { rejectUnauthorized: false },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.once("error", reject);
  });
}

async function expectHealth(url, service) {
  const response = await globalThis.fetch(url);
  if (!response.ok) {
    throw new Error(`${service} health failed with status ${response.status}`);
  }

  const body = await response.json();
  const expected = { schemaVersion: 1, service, status: "ok" };
  if (JSON.stringify(body) !== JSON.stringify(expected)) {
    throw new Error(`${service} returned an invalid health contract`);
  }
}

async function verifyPreview(secrets) {
  const storageHealth = await globalThis.fetch(
    "http://127.0.0.1:7070/_/health",
  );
  if (!storageHealth.ok) {
    throw new Error(
      `Object-storage health failed with status ${storageHealth.status}`,
    );
  }
  await ensureBucket(secrets);

  await expectHealth("http://127.0.0.1:3002/healthz", "api");
  await expectHealth("http://127.0.0.1:3003/healthz", "worker");

  const [storefrontPage, adminPage, storefrontHealth, adminHealth] =
    await Promise.all([
      requestLocalHttps("https://localhost:3443/"),
      requestLocalHttps("https://localhost:3444/"),
      requestLocalHttps("https://localhost:3443/healthz"),
      requestLocalHttps("https://localhost:3444/healthz"),
    ]);

  if (
    storefrontPage.status !== 200 ||
    !storefrontPage.body.includes("Storefront runtime is ready.")
  ) {
    throw new Error("Storefront preview page is unavailable");
  }
  if (
    adminPage.status !== 200 ||
    !adminPage.body.includes("Admin runtime is ready.")
  ) {
    throw new Error("Admin preview page is unavailable");
  }
  if (storefrontHealth.status !== 200 || adminHealth.status !== 200) {
    throw new Error("Web runtime health endpoint is unavailable");
  }

  const databaseProbe = runCompose(
    [
      "exec",
      "--no-TTY",
      "postgres",
      "psql",
      "--username",
      "fan_support",
      "--dbname",
      "fan_support",
      "--tuples-only",
      "--no-align",
      "--command",
      "SELECT current_setting('server_version_num') || ':' || 1",
    ],
    {
      capture: true,
      failureMessage: "PostgreSQL query probe failed",
    },
  ).trim();
  if (databaseProbe !== "180006:1") {
    throw new Error("PostgreSQL returned an unexpected version or result");
  }

  console.log("Preview verification passed:");
  console.log("- Storefront: https://localhost:3443/");
  console.log("- Admin: https://localhost:3444/");
  console.log("- API health: http://localhost:3002/healthz");
  console.log("- Worker health: http://localhost:3003/healthz");
  console.log(`- PostgreSQL query: ${databaseProbe}`);
  console.log(`- Object-storage bucket: ${bucketName}`);
}

function scrub(text, values) {
  let scrubbed = text;
  for (const value of values) {
    if (value !== "") {
      scrubbed = scrubbed.replaceAll(value, "[REDACTED_SECRET]");
    }
  }
  return scrubbed;
}

async function main() {
  const command = process.argv[2];

  if (command === "config") {
    const environment = composeEnvironment();
    runCompose(["--profile", "preview", "config", "--quiet"], {
      environment,
      failureMessage: "Preview Compose configuration is invalid",
    });
    const images = runCompose(["--profile", "preview", "config", "--images"], {
      capture: true,
      environment,
      failureMessage: "Cannot list preview images",
    });
    process.stdout.write(images);
    return;
  }

  if (command === "up") {
    const secrets = createSecrets();
    const environment = composeEnvironment(secrets);
    runCompose(
      [
        "--profile",
        "preview",
        "up",
        "--build",
        "--detach",
        "--force-recreate",
        "--wait",
        "--wait-timeout",
        "300",
      ],
      { environment, failureMessage: "Preview stack failed to start" },
    );
    await verifyPreview(secrets);
    return;
  }

  if (command === "verify") {
    await verifyPreview(readRunningSecrets());
    return;
  }

  if (command === "logs") {
    const secrets = readRunningSecrets();
    const text = runCompose(["--profile", "preview", "logs", "--no-color"], {
      capture: true,
      failureMessage: "Cannot read preview logs",
    });
    process.stdout.write(
      scrub(text, [
        secrets.postgresPassword,
        secrets.objectStorageAccessKeyId,
        secrets.objectStorageSecretAccessKey,
      ]),
    );
    return;
  }

  if (command === "down") {
    runCompose(["--profile", "preview", "down", "--remove-orphans"], {
      failureMessage: "Preview stack failed to stop",
    });
    return;
  }

  throw new Error("Usage: runtime-preview.mjs <config|up|verify|logs|down>");
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown failure";
  console.error(message);
  process.exitCode = 1;
}
