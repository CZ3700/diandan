import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const tlsDirectoryPrefix = "fan-support-preview-tls-";
const tlsParentDirectory = path.join(
  workspaceRoot,
  "node_modules",
  ".cache",
  "fan-support-preview",
);

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

function runOpenSsl(arguments_, workingDirectory) {
  const result = spawnSync("openssl", arguments_, {
    cwd: workingDirectory,
    env: process.env,
    stdio: "ignore",
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error("Cannot generate ephemeral preview TLS material");
  }
}

function createTlsDirectory() {
  mkdirSync(tlsParentDirectory, { mode: 0o700, recursive: true });
  const parentMetadata = lstatSync(tlsParentDirectory);
  if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory()) {
    throw new Error("Preview TLS cache root is unsafe");
  }
  const directory = mkdtempSync(
    path.join(tlsParentDirectory, tlsDirectoryPrefix),
  );
  chmodSync(directory, 0o700);

  const clientsDirectory = path.join(directory, "clients");
  const edgeDirectory = path.join(directory, "edge");
  mkdirSync(clientsDirectory, { mode: 0o755 });
  mkdirSync(edgeDirectory, { mode: 0o700 });

  const caCertificate = path.join(edgeDirectory, "ca.crt");
  const caKey = path.join(edgeDirectory, "ca.key");
  const certificate = path.join(edgeDirectory, "preview.crt");
  const certificateRequest = path.join(edgeDirectory, "preview.csr");
  const extensionFile = path.join(edgeDirectory, "preview.ext");
  const privateKey = path.join(edgeDirectory, "preview.key");

  try {
    runOpenSsl(
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-days",
        "2",
        "-nodes",
        "-keyout",
        caKey,
        "-out",
        caCertificate,
        "-subj",
        "/CN=Fan Support Local Preview CA",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-addext",
        "keyUsage=critical,keyCertSign,cRLSign",
      ],
      edgeDirectory,
    );
    runOpenSsl(
      [
        "req",
        "-new",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        privateKey,
        "-out",
        certificateRequest,
        "-subj",
        "/CN=edge",
      ],
      edgeDirectory,
    );
    writeFileSync(
      extensionFile,
      [
        "subjectAltName=DNS:edge,DNS:localhost,IP:127.0.0.1",
        "basicConstraints=critical,CA:FALSE",
        "keyUsage=critical,digitalSignature,keyEncipherment",
        "extendedKeyUsage=serverAuth",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    runOpenSsl(
      [
        "x509",
        "-req",
        "-in",
        certificateRequest,
        "-CA",
        caCertificate,
        "-CAkey",
        caKey,
        "-CAcreateserial",
        "-out",
        certificate,
        "-days",
        "2",
        "-sha256",
        "-extfile",
        extensionFile,
      ],
      edgeDirectory,
    );
    runOpenSsl(
      ["verify", "-CAfile", caCertificate, certificate],
      edgeDirectory,
    );

    chmodSync(caCertificate, 0o644);
    chmodSync(certificate, 0o644);
    chmodSync(privateKey, 0o600);
    const clientCaCertificate = path.join(clientsDirectory, "ca.crt");
    copyFileSync(caCertificate, clientCaCertificate);
    chmodSync(clientCaCertificate, 0o644);
    for (const temporaryFile of [
      caKey,
      certificateRequest,
      extensionFile,
      path.join(edgeDirectory, "ca.srl"),
    ]) {
      rmSync(temporaryFile, { force: true });
    }
    return directory;
  } catch (error) {
    rmSync(directory, { force: true, recursive: true });
    throw error;
  }
}

function isManagedTlsDirectory(directory) {
  if (typeof directory !== "string" || directory === "") {
    return false;
  }
  try {
    const resolved = path.resolve(directory);
    const metadata = lstatSync(resolved);
    return (
      path.dirname(resolved) === tlsParentDirectory &&
      path.basename(resolved).startsWith(tlsDirectoryPrefix) &&
      !metadata.isSymbolicLink() &&
      metadata.isDirectory()
    );
  } catch {
    return false;
  }
}

function removeTlsDirectory(directory) {
  try {
    if (isManagedTlsDirectory(directory)) {
      rmSync(path.resolve(directory), { force: true, recursive: true });
    }
  } catch {
    // A missing or externally changed temp directory needs no further cleanup.
  }
}

function composeEnvironment(state = createSecrets()) {
  return {
    ...process.env,
    COMPOSE_PARALLEL_LIMIT: "1",
    PREVIEW_OBJECT_STORAGE_ACCESS_KEY_ID: state.objectStorageAccessKeyId,
    PREVIEW_OBJECT_STORAGE_SECRET_ACCESS_KEY:
      state.objectStorageSecretAccessKey,
    PREVIEW_POSTGRES_PASSWORD: state.postgresPassword,
    PREVIEW_TLS_DIRECTORY: state.tlsDirectory ?? tlsParentDirectory,
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
    ["--profile", "preview", "ps", "--all", "--quiet", serviceName],
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

function readRunningState() {
  const postgresEnvironment = readContainerEnvironment("postgres");
  const storageEnvironment = readContainerEnvironment("object-storage");
  const edgeEnvironment = readContainerEnvironment("edge");
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
  const tlsDirectory = readEnvironmentValue(
    edgeEnvironment,
    "PREVIEW_TLS_DIRECTORY",
  );

  if (
    postgresPassword === undefined ||
    objectStorageAccessKeyId === undefined ||
    objectStorageSecretAccessKey === undefined ||
    !isManagedTlsDirectory(tlsDirectory)
  ) {
    throw new Error("Preview runtime state is unavailable");
  }

  return Object.freeze({
    postgresPassword,
    objectStorageAccessKeyId,
    objectStorageSecretAccessKey,
    tlsDirectory,
  });
}

function tryReadRunningTlsDirectory() {
  try {
    const tlsDirectory = readEnvironmentValue(
      readContainerEnvironment("edge"),
      "PREVIEW_TLS_DIRECTORY",
    );
    return isManagedTlsDirectory(tlsDirectory) ? tlsDirectory : undefined;
  } catch {
    return undefined;
  }
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

async function requestS3(method, state, caCertificate) {
  const url = new URL(`https://localhost:7443/${bucketName}`);
  return requestLocalHttps(url, caCertificate, {
    headers: signedS3Headers(
      method,
      url,
      state.objectStorageAccessKeyId,
      state.objectStorageSecretAccessKey,
    ),
    method,
  });
}

async function ensureBucket(state, caCertificate) {
  const createResponse = await requestS3("PUT", state, caCertificate);
  if (createResponse.status !== 200 && createResponse.status !== 409) {
    throw new Error(
      `Object-storage bucket creation failed with status ${createResponse.status}`,
    );
  }

  const headResponse = await requestS3("HEAD", state, caCertificate);
  if (!headResponse.ok) {
    throw new Error(
      `Object-storage bucket probe failed with status ${headResponse.status}`,
    );
  }
}

function requestLocalHttps(url, caCertificate, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        ca: caCertificate,
        headers: options.headers,
        method: options.method ?? "GET",
        rejectUnauthorized: true,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            ok:
              (response.statusCode ?? 0) >= 200 &&
              (response.statusCode ?? 0) < 300,
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.once("error", reject);
    request.setTimeout(5_000, () => {
      request.destroy(new Error("Local HTTPS preview request timed out"));
    });
    request.end();
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

function readCaCertificate(tlsDirectory) {
  try {
    return readFileSync(path.join(tlsDirectory, "clients", "ca.crt"));
  } catch {
    throw new Error("Preview TLS certificate is unavailable");
  }
}

function verifyInternalStorageTls(serviceName) {
  const result = runCompose(
    [
      "exec",
      "--no-TTY",
      serviceName,
      "node",
      "-e",
      "fetch('https://edge:7443/_/health').then((response)=>{if(!response.ok)process.exit(1);process.stdout.write('ok')}).catch(()=>process.exit(1))",
    ],
    {
      capture: true,
      failureMessage: `${serviceName} cannot verify the preview S3 TLS edge`,
    },
  ).trim();
  if (result !== "ok") {
    throw new Error(`${serviceName} returned an invalid S3 TLS probe`);
  }
}

async function verifyPreview(state) {
  const caCertificate = readCaCertificate(state.tlsDirectory);
  const storageHealth = await requestLocalHttps(
    "https://localhost:7443/_/health",
    caCertificate,
  );
  if (!storageHealth.ok) {
    throw new Error(
      `Object-storage health failed with status ${storageHealth.status}`,
    );
  }
  await ensureBucket(state, caCertificate);

  verifyInternalStorageTls("api");
  verifyInternalStorageTls("worker");

  await expectHealth("http://127.0.0.1:3002/healthz", "api");
  await expectHealth("http://127.0.0.1:3003/healthz", "worker");

  const [storefrontPage, adminPage, storefrontHealth, adminHealth] =
    await Promise.all([
      requestLocalHttps("https://localhost:3443/", caCertificate),
      requestLocalHttps("https://localhost:3444/", caCertificate),
      requestLocalHttps("https://localhost:3443/healthz", caCertificate),
      requestLocalHttps("https://localhost:3444/healthz", caCertificate),
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
  console.log(`- Object-storage TLS bucket: ${bucketName}`);
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
    const previousTlsDirectory = tryReadRunningTlsDirectory();
    const state = Object.freeze({
      ...createSecrets(),
      tlsDirectory: createTlsDirectory(),
    });
    const environment = composeEnvironment(state);
    try {
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
      await verifyPreview(state);
    } catch (error) {
      if (tryReadRunningTlsDirectory() !== state.tlsDirectory) {
        removeTlsDirectory(state.tlsDirectory);
      }
      throw error;
    }
    if (
      previousTlsDirectory !== undefined &&
      previousTlsDirectory !== state.tlsDirectory
    ) {
      removeTlsDirectory(previousTlsDirectory);
    }
    return;
  }

  if (command === "verify") {
    await verifyPreview(readRunningState());
    return;
  }

  if (command === "logs") {
    const state = readRunningState();
    const text = runCompose(["--profile", "preview", "logs", "--no-color"], {
      capture: true,
      failureMessage: "Cannot read preview logs",
    });
    process.stdout.write(
      scrub(text, [
        state.postgresPassword,
        state.objectStorageAccessKeyId,
        state.objectStorageSecretAccessKey,
      ]),
    );
    return;
  }

  if (command === "down") {
    const tlsDirectory = tryReadRunningTlsDirectory();
    runCompose(["--profile", "preview", "down", "--remove-orphans"], {
      failureMessage: "Preview stack failed to stop",
    });
    removeTlsDirectory(tlsDirectory);
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
