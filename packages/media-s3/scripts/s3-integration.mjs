import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request as requestHttp } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const versityImage =
  "versity/versitygw:v1.7.0@sha256:c4cbd9d9cb8dedbb055ac788dbd02635651b9b1cebac95b095b3217231aa87ad";
const managedContainerPrefix = "fan-support-media-s3-it-";
const managedTemporaryDirectoryPrefix = "fan-support-media-s3-it-";
const runnerArgument = "--run-adapter";
const runnerConfigEnvironmentKey = "FAN_SUPPORT_MEDIA_S3_TEST_CONFIG";
const region = "us-east-1";
const previewBrowserOrigins = Object.freeze([
  "https://localhost:3443",
  "https://localhost:3444",
]);
const previewCorsRequestHeaders = Object.freeze([
  "content-type",
  "if-none-match",
  "x-amz-checksum-sha256",
]);
const integrationPublicMediaOrigin = "https://media.example.invalid";

class IntegrationFailure extends Error {}

function fail(code) {
  throw new IntegrationFailure(code);
}

function runOpenSsl(arguments_, workingDirectory) {
  const result = spawnSync("openssl", arguments_, {
    cwd: workingDirectory,
    env: process.env,
    stdio: "ignore",
  });
  if (result.error !== undefined || result.status !== 0) {
    fail("ephemeral-tls-generation-failed");
  }
}

function createTlsMaterial(directory) {
  const caCertificatePath = path.join(directory, "ca.crt");
  const caKeyPath = path.join(directory, "ca.key");
  const certificatePath = path.join(directory, "server.crt");
  const certificateRequestPath = path.join(directory, "server.csr");
  const extensionPath = path.join(directory, "server.ext");
  const privateKeyPath = path.join(directory, "server.key");

  writeFileSync(
    extensionPath,
    [
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "",
    ].join("\n"),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );

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
      caKeyPath,
      "-out",
      caCertificatePath,
      "-subj",
      "/CN=Fan Support Media S3 Integration CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
    ],
    directory,
  );
  runOpenSsl(
    [
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      privateKeyPath,
      "-out",
      certificateRequestPath,
      "-subj",
      "/CN=localhost",
    ],
    directory,
  );
  runOpenSsl(
    [
      "x509",
      "-req",
      "-in",
      certificateRequestPath,
      "-CA",
      caCertificatePath,
      "-CAkey",
      caKeyPath,
      "-CAcreateserial",
      "-out",
      certificatePath,
      "-days",
      "2",
      "-sha256",
      "-extfile",
      extensionPath,
    ],
    directory,
  );

  chmodSync(caCertificatePath, 0o600);
  chmodSync(caKeyPath, 0o600);
  chmodSync(certificatePath, 0o600);
  chmodSync(privateKeyPath, 0o600);

  return Object.freeze({
    caCertificatePath,
    certificatePath,
    privateKeyPath,
  });
}

function runDocker(arguments_, options = {}) {
  const result = spawnSync("docker", arguments_, {
    encoding: "utf8",
    env: process.env,
    stdio: options.capture === true ? ["ignore", "pipe", "pipe"] : "ignore",
    timeout: options.timeoutMs ?? 60_000,
  });
  if (
    result.error !== undefined ||
    result.signal !== null ||
    (result.status !== 0 && options.allowFailure !== true)
  ) {
    fail(options.failureCode ?? "docker-command-failed");
  }
  return Object.freeze({
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
  });
}

function startVersityContainer({ containerName, environmentFilePath, runId }) {
  runDocker(
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--label",
      "com.fan-support.test-suite=media-s3",
      "--label",
      `com.fan-support.test-run=${runId}`,
      "--publish",
      "127.0.0.1::7070",
      "--env-file",
      environmentFilePath,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "128",
      "--tmpfs",
      "/data/iam:rw,nosuid,nodev,noexec,size=16m",
      "--tmpfs",
      "/data/s3:rw,nosuid,nodev,noexec,size=128m",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,noexec,size=16m",
      "--stop-timeout",
      "2",
      versityImage,
    ],
    { failureCode: "versity-start-failed" },
  );
}

function readVersityPort(containerName) {
  const result = runDocker(
    [
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "7070/tcp") 0).HostPort}}',
      containerName,
    ],
    { capture: true, failureCode: "versity-port-inspection-failed" },
  );
  const port = Number(result.stdout);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    fail("versity-port-invalid");
  }
  return port;
}

async function waitForVersity(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(
        `http://127.0.0.1:${port}/_/health`,
        { signal: globalThis.AbortSignal.timeout(1_000) },
      );
      await response.body?.cancel();
      if (response.ok) {
        return;
      }
    } catch {
      // The container may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail("versity-health-timeout");
}

async function startTlsProxy({
  certificatePath,
  privateKeyPath,
  upstreamPort,
}) {
  const server = createHttpsServer(
    {
      cert: readFileSync(certificatePath),
      key: readFileSync(privateKeyPath),
      minVersion: "TLSv1.2",
    },
    (request, response) => {
      const upstreamRequest = requestHttp(
        {
          headers: request.headers,
          host: "127.0.0.1",
          method: request.method,
          path: request.url,
          port: upstreamPort,
        },
        (upstreamResponse) => {
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.statusMessage,
            upstreamResponse.headers,
          );
          upstreamResponse.pipe(response);
        },
      );
      upstreamRequest.on("error", () => {
        if (!response.headersSent) {
          response.writeHead(502);
        }
        response.end();
      });
      request.pipe(upstreamRequest);
    },
  );
  server.on("clientError", (_error, socket) => socket.destroy());

  await new Promise((resolve, reject) => {
    const handleError = () =>
      reject(new IntegrationFailure("tls-proxy-failed"));
    server.once("error", handleError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", handleError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    fail("tls-proxy-address-invalid");
  }

  return Object.freeze({ port: address.port, server });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(new IntegrationFailure("tls-proxy-cleanup-failed"));
      }
    });
    server.closeAllConnections();
  });
}

function writeSecretFile(filePath, value) {
  writeFileSync(filePath, value, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  chmodSync(filePath, 0o600);
}

function isManagedContainerName(containerName, runId) {
  return (
    containerName === `${managedContainerPrefix}${runId}` &&
    /^[a-f0-9-]{36}$/u.test(runId)
  );
}

function cleanupContainer(containerName, runId) {
  if (!isManagedContainerName(containerName, runId)) {
    fail("container-cleanup-target-invalid");
  }
  const inspection = runDocker(
    [
      "inspect",
      "--format",
      '{{index .Config.Labels "com.fan-support.test-run"}}',
      containerName,
    ],
    {
      allowFailure: true,
      capture: true,
      failureCode: "container-cleanup-inspection-failed",
    },
  );
  if (inspection.status !== 0) {
    return;
  }
  if (inspection.stdout !== runId) {
    fail("container-cleanup-label-mismatch");
  }
  runDocker(["rm", "--force", containerName], {
    failureCode: "container-cleanup-failed",
  });
}

function cleanupTemporaryDirectory(directory) {
  const canonicalParent = realpathSync(path.dirname(directory));
  const canonicalTemporaryRoot = realpathSync(tmpdir());
  const metadata = lstatSync(directory);
  if (
    canonicalParent !== canonicalTemporaryRoot ||
    !path.basename(directory).startsWith(managedTemporaryDirectoryPrefix) ||
    metadata.isSymbolicLink() ||
    !metadata.isDirectory()
  ) {
    fail("temporary-directory-cleanup-target-invalid");
  }
  rmSync(directory, { force: false, recursive: true });
}

function runAdapterChild({ caCertificatePath, configPath }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), runnerArgument],
      {
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: caCertificatePath,
          NODE_TLS_REJECT_UNAUTHORIZED: "1",
          [runnerConfigEnvironmentKey]: configPath,
        },
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new IntegrationFailure("adapter-runner-timeout"));
    }, 60_000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new IntegrationFailure("adapter-runner-start-failed"));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && signal === null) {
        resolve();
      } else {
        reject(new IntegrationFailure("adapter-runner-failed"));
      }
    });
  });
}

function parseRunnerConfig() {
  const configPath = process.env[runnerConfigEnvironmentKey];
  if (configPath === undefined || configPath.length === 0) {
    fail("runner-config-missing");
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    fail("runner-config-unreadable");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.endpoint !== "string" ||
    typeof parsed.accessKeyId !== "string" ||
    typeof parsed.secretAccessKey !== "string" ||
    typeof parsed.sourceBucket !== "string" ||
    typeof parsed.derivativeBucket !== "string" ||
    typeof parsed.objectKey !== "string"
  ) {
    fail("runner-config-invalid");
  }
  const endpoint = new URL(parsed.endpoint);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "localhost" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    !/^fan-support-media-source-[a-f0-9]{12}$/u.test(parsed.sourceBucket) ||
    !/^fan-support-media-derivative-[a-f0-9]{12}$/u.test(
      parsed.derivativeBucket,
    ) ||
    !/^source\/integration\/[a-f0-9-]{36}\/asset\.jpg$/u.test(parsed.objectKey)
  ) {
    fail("runner-config-boundary-invalid");
  }
  return Object.freeze(parsed);
}

function requireSuccessfulResult(result, operation) {
  if (
    typeof result !== "object" ||
    result === null ||
    result.schemaVersion !== 1 ||
    result.operation !== operation ||
    result.outcome !== "SUCCESS" ||
    typeof result.value !== "object" ||
    result.value === null
  ) {
    fail(`adapter-${operation.toLowerCase()}-failed`);
  }
  return result.value;
}

function assertPresignedHttpsUrl(value, endpoint, expectedMethod) {
  if (value.method !== expectedMethod || typeof value.url !== "string") {
    fail("presigned-grant-invalid");
  }
  const url = new URL(value.url);
  const expected = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.origin !== expected.origin ||
    url.username !== "" ||
    url.password !== ""
  ) {
    fail("presigned-grant-not-local-https");
  }
}

function commaSeparatedHeaderValues(value) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== ""),
  );
}

async function assertPreviewCorsPreflight(upload) {
  for (const origin of previewBrowserOrigins) {
    const response = await globalThis.fetch(upload.url, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "PUT",
        "access-control-request-headers": previewCorsRequestHeaders.join(","),
      },
    });
    await response.body?.cancel();
    const allowedMethods = commaSeparatedHeaderValues(
      response.headers.get("access-control-allow-methods"),
    );
    const allowedHeaders = commaSeparatedHeaderValues(
      response.headers.get("access-control-allow-headers"),
    );
    if (
      !response.ok ||
      response.headers.get("access-control-allow-origin") !== origin ||
      !allowedMethods.has("put") ||
      previewCorsRequestHeaders.some((header) => !allowedHeaders.has(header))
    ) {
      fail("preview-cors-preflight-not-allowed");
    }
  }

  const rejected = await globalThis.fetch(upload.url, {
    method: "OPTIONS",
    headers: {
      origin: "https://attacker.example.invalid",
      "access-control-request-method": "PUT",
      "access-control-request-headers": previewCorsRequestHeaders.join(","),
    },
  });
  await rejected.body?.cancel();
  if (rejected.headers.has("access-control-allow-origin")) {
    fail("preview-cors-unknown-origin-allowed");
  }
}

async function createBucket(client, bucket) {
  const { CreateBucketCommand } = await import("@aws-sdk/client-s3");
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
}

async function configureBucketCors(client, bucket) {
  const { PutBucketCorsCommand } = await import("@aws-sdk/client-s3");
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: [...previewCorsRequestHeaders],
            AllowedMethods: ["PUT", "GET", "HEAD"],
            AllowedOrigins: [...previewBrowserOrigins],
            MaxAgeSeconds: 300,
          },
        ],
      },
    }),
  );
}

async function runAdapterIntegration() {
  const config = parseRunnerConfig();
  const [{ S3Client }, { createS3MediaStorageAdapter }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import(
      pathToFileURL(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "../dist/index.js",
        ),
      ).href
    ),
  ]);
  const credentials = {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  };
  const setupClient = new S3Client({
    credentials,
    endpoint: config.endpoint,
    forcePathStyle: true,
    region,
  });
  try {
    await createBucket(setupClient, config.sourceBucket);
    await createBucket(setupClient, config.derivativeBucket);
    await configureBucketCors(setupClient, config.sourceBucket);
    await configureBucketCors(setupClient, config.derivativeBucket);
  } finally {
    setupClient.destroy();
  }

  const payload = Buffer.from("fan-support-media-s3-integration\n", "utf8");
  const checksumSha256 = createHash("sha256").update(payload).digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const adapter = createS3MediaStorageAdapter({
    schemaVersion: 1,
    sourceBucket: config.sourceBucket,
    derivativeBucket: config.derivativeBucket,
    publicMediaOrigin: integrationPublicMediaOrigin,
    maxUploadBytes: payload.byteLength,
    region,
    authentication: {
      mode: "static",
      endpoint: config.endpoint,
      presignEndpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      forcePathStyle: true,
    },
  });
  const upload = requireSuccessfulResult(
    await adapter.createUploadGrant({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      storageClass: "SOURCE",
      objectKey: config.objectKey,
      checksumSha256,
      byteSize: payload.byteLength,
      mimeType: "image/jpeg",
      expiresAt,
    }),
    "CREATE_UPLOAD_GRANT",
  );
  assertPresignedHttpsUrl(upload, config.endpoint, "PUT");
  if (
    typeof upload.headers !== "object" ||
    upload.headers === null ||
    upload.headers["content-type"] !== "image/jpeg" ||
    upload.headers["if-none-match"] !== "*" ||
    Object.hasOwn(upload.headers, "content-length") ||
    upload.headers["x-amz-checksum-sha256"] !==
      Buffer.from(checksumSha256, "hex").toString("base64")
  ) {
    fail("upload-headers-not-bound");
  }
  const signedHeaders = new Set(
    (new URL(upload.url).searchParams.get("X-Amz-SignedHeaders") ?? "").split(
      ";",
    ),
  );
  for (const requiredHeader of [
    "content-length",
    "content-type",
    "host",
    "if-none-match",
    "x-amz-checksum-sha256",
  ]) {
    if (!signedHeaders.has(requiredHeader)) {
      fail("presigned-upload-required-header-not-signed");
    }
  }
  await assertPreviewCorsPreflight(upload);
  const oversizedPayload = Buffer.concat([payload, Buffer.from([0])]);
  const oversizedObjectKey = config.objectKey.replace(
    /asset\.jpg$/u,
    "oversized.jpg",
  );
  const oversizedChecksumSha256 = createHash("sha256")
    .update(oversizedPayload)
    .digest("hex");
  const oversizedUpload = requireSuccessfulResult(
    await adapter.createUploadGrant({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      storageClass: "SOURCE",
      objectKey: oversizedObjectKey,
      checksumSha256: oversizedChecksumSha256,
      byteSize: payload.byteLength,
      mimeType: "image/jpeg",
      expiresAt,
    }),
    "CREATE_UPLOAD_GRANT",
  );
  const oversizedResponse = await globalThis.fetch(oversizedUpload.url, {
    method: oversizedUpload.method,
    headers: oversizedUpload.headers,
    body: oversizedPayload,
  });
  await oversizedResponse.body?.cancel();
  if (oversizedResponse.status < 400) {
    fail("presigned-upload-content-length-mismatch-not-rejected");
  }
  const oversizedMissing = await adapter.inspectObject({
    schemaVersion: 1,
    operation: "INSPECT_OBJECT",
    storageClass: "SOURCE",
    objectKey: oversizedObjectKey,
  });
  if (
    oversizedMissing.outcome !== "FAILURE" ||
    oversizedMissing.error?.code !== "OBJECT_NOT_FOUND"
  ) {
    fail("rejected-oversized-upload-remains-visible");
  }
  const missingConditionHeaders = { ...upload.headers };
  delete missingConditionHeaders["if-none-match"];
  const missingConditionResponse = await globalThis.fetch(upload.url, {
    method: upload.method,
    headers: missingConditionHeaders,
    body: payload,
  });
  await missingConditionResponse.body?.cancel();
  if (missingConditionResponse.status !== 403) {
    fail("presigned-upload-missing-condition-not-rejected");
  }
  const alteredConditionResponse = await globalThis.fetch(upload.url, {
    method: upload.method,
    headers: { ...upload.headers, "if-none-match": '"different-etag"' },
    body: payload,
  });
  await alteredConditionResponse.body?.cancel();
  if (alteredConditionResponse.status !== 403) {
    fail("presigned-upload-altered-condition-not-rejected");
  }
  for (const headerName of ["content-type", "x-amz-checksum-sha256"]) {
    const missingHeaderSet = { ...upload.headers };
    delete missingHeaderSet[headerName];
    const missingHeaderResponse = await globalThis.fetch(upload.url, {
      method: upload.method,
      headers: missingHeaderSet,
      body: payload,
    });
    await missingHeaderResponse.body?.cancel();
    if (missingHeaderResponse.status !== 403) {
      fail("presigned-upload-bound-header-omission-not-rejected");
    }
  }
  const checksumMismatchResponse = await globalThis.fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: Buffer.from("different-payload\n", "utf8"),
  });
  await checksumMismatchResponse.body?.cancel();
  if (checksumMismatchResponse.status < 400) {
    fail("presigned-upload-checksum-mismatch-not-rejected");
  }
  const uploadResponse = await globalThis.fetch(upload.url, {
    method: upload.method,
    headers: {
      ...upload.headers,
      origin: previewBrowserOrigins[1],
    },
    body: payload,
  });
  if (
    !uploadResponse.ok ||
    uploadResponse.headers.get("access-control-allow-origin") !==
      previewBrowserOrigins[1]
  ) {
    await uploadResponse.body?.cancel();
    fail("presigned-upload-failed");
  }
  await uploadResponse.body?.cancel();

  const overwriteResponse = await globalThis.fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: payload,
  });
  await overwriteResponse.body?.cancel();
  if (![409, 412].includes(overwriteResponse.status)) {
    fail("presigned-upload-overwrite-not-rejected");
  }

  const inspected = requireSuccessfulResult(
    await adapter.inspectObject({
      schemaVersion: 1,
      operation: "INSPECT_OBJECT",
      storageClass: "SOURCE",
      objectKey: config.objectKey,
    }),
    "INSPECT_OBJECT",
  );
  if (
    inspected.objectKey !== config.objectKey ||
    inspected.storageClass !== "SOURCE" ||
    inspected.checksumSha256 !== checksumSha256 ||
    inspected.byteSize !== payload.byteLength ||
    inspected.mimeType !== "image/jpeg" ||
    typeof inspected.revisionToken !== "string"
  ) {
    fail("head-metadata-mismatch");
  }

  const download = requireSuccessfulResult(
    await adapter.createDownloadGrant({
      schemaVersion: 1,
      operation: "CREATE_DOWNLOAD_GRANT",
      storageClass: "SOURCE",
      objectKey: config.objectKey,
      expiresAt,
    }),
    "CREATE_DOWNLOAD_GRANT",
  );
  assertPresignedHttpsUrl(download, config.endpoint, "GET");
  const downloadResponse = await globalThis.fetch(download.url, {
    method: download.method,
    headers: download.headers,
  });
  if (!downloadResponse.ok) {
    await downloadResponse.body?.cancel();
    fail("presigned-download-failed");
  }
  const downloadedPayload = Buffer.from(await downloadResponse.arrayBuffer());
  if (!downloadedPayload.equals(payload)) {
    fail("downloaded-payload-mismatch");
  }

  const derivativeObjectKey = config.objectKey
    .replace(/^source\//u, "derivatives/")
    .replace(/\.jpg$/u, ".webp");
  const derivativeUpload = requireSuccessfulResult(
    await adapter.createUploadGrant({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      storageClass: "DERIVATIVE",
      objectKey: derivativeObjectKey,
      checksumSha256,
      byteSize: payload.byteLength,
      mimeType: "image/webp",
      expiresAt,
    }),
    "CREATE_UPLOAD_GRANT",
  );
  const derivativeUploadResponse = await globalThis.fetch(
    derivativeUpload.url,
    {
      method: derivativeUpload.method,
      headers: derivativeUpload.headers,
      body: payload,
    },
  );
  await derivativeUploadResponse.body?.cancel();
  if (!derivativeUploadResponse.ok) {
    fail("derivative-bucket-upload-failed");
  }
  const inspectedDerivative = requireSuccessfulResult(
    await adapter.inspectObject({
      schemaVersion: 1,
      operation: "INSPECT_OBJECT",
      storageClass: "DERIVATIVE",
      objectKey: derivativeObjectKey,
    }),
    "INSPECT_OBJECT",
  );
  if (
    inspectedDerivative.objectKey !== derivativeObjectKey ||
    inspectedDerivative.storageClass !== "DERIVATIVE" ||
    inspectedDerivative.mimeType !== "image/webp" ||
    typeof inspectedDerivative.revisionToken !== "string"
  ) {
    fail("derivative-bucket-routing-mismatch");
  }
  requireSuccessfulResult(
    await adapter.deleteObject({
      schemaVersion: 1,
      operation: "DELETE_OBJECT",
      storageClass: "DERIVATIVE",
      objectKey: derivativeObjectKey,
      expectedChecksumSha256: checksumSha256,
      expectedRevisionToken: inspectedDerivative.revisionToken,
      ...(typeof inspectedDerivative.versionId === "string"
        ? { expectedVersionId: inspectedDerivative.versionId }
        : {}),
    }),
    "DELETE_OBJECT",
  );

  const deleted = requireSuccessfulResult(
    await adapter.deleteObject({
      schemaVersion: 1,
      operation: "DELETE_OBJECT",
      storageClass: "SOURCE",
      objectKey: config.objectKey,
      expectedChecksumSha256: checksumSha256,
      expectedRevisionToken: inspected.revisionToken,
      ...(typeof inspected.versionId === "string"
        ? { expectedVersionId: inspected.versionId }
        : {}),
    }),
    "DELETE_OBJECT",
  );
  if (deleted.objectKey !== config.objectKey || deleted.deleted !== true) {
    fail("delete-result-invalid");
  }

  const missing = await adapter.inspectObject({
    schemaVersion: 1,
    operation: "INSPECT_OBJECT",
    storageClass: "SOURCE",
    objectKey: config.objectKey,
  });
  if (
    missing.schemaVersion !== 1 ||
    missing.operation !== "INSPECT_OBJECT" ||
    missing.outcome !== "FAILURE" ||
    missing.error?.code !== "OBJECT_NOT_FOUND"
  ) {
    fail("deleted-object-remains-visible");
  }
}

async function runOrchestrator() {
  const runId = randomUUID();
  const containerName = `${managedContainerPrefix}${runId}`;
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), managedTemporaryDirectoryPrefix),
  );
  chmodSync(temporaryDirectory, 0o700);
  const environmentFilePath = path.join(temporaryDirectory, "versity.env");
  const configPath = path.join(temporaryDirectory, "runner.json");
  const suffix = randomBytes(6).toString("hex");
  const accessKeyId = `local${randomBytes(12).toString("hex")}`;
  const secretAccessKey = randomBytes(32).toString("hex");
  const sourceBucket = `fan-support-media-source-${suffix}`;
  const derivativeBucket = `fan-support-media-derivative-${suffix}`;
  let containerStarted = false;
  let tlsProxy;
  let failure;

  try {
    const tlsMaterial = createTlsMaterial(temporaryDirectory);
    writeSecretFile(
      environmentFilePath,
      [
        `ROOT_ACCESS_KEY_ID=${accessKeyId}`,
        `ROOT_SECRET_ACCESS_KEY=${secretAccessKey}`,
        "VGW_BACKEND=posix",
        "VGW_BACKEND_ARGS=/data/s3",
        "VGW_HEALTH=/_/health",
        "VGW_IAM_DIR=/data/iam",
        "VGW_PORT=:7070",
        `VGW_REGION=${region}`,
        "",
      ].join("\n"),
    );
    containerStarted = true;
    startVersityContainer({ containerName, environmentFilePath, runId });
    rmSync(environmentFilePath, { force: false });
    const upstreamPort = readVersityPort(containerName);
    await waitForVersity(upstreamPort);
    tlsProxy = await startTlsProxy({
      certificatePath: tlsMaterial.certificatePath,
      privateKeyPath: tlsMaterial.privateKeyPath,
      upstreamPort,
    });
    const endpoint = `https://localhost:${tlsProxy.port}`;
    writeSecretFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        endpoint,
        accessKeyId,
        secretAccessKey,
        sourceBucket,
        derivativeBucket,
        objectKey: `source/integration/${runId}/asset.jpg`,
      }),
    );
    await runAdapterChild({
      caCertificatePath: tlsMaterial.caCertificatePath,
      configPath,
    });
  } catch (error) {
    failure =
      error instanceof IntegrationFailure
        ? error
        : new IntegrationFailure("unexpected-integration-failure");
  } finally {
    if (tlsProxy !== undefined) {
      try {
        await closeServer(tlsProxy.server);
      } catch (error) {
        failure ??= error;
      }
    }
    if (containerStarted) {
      try {
        cleanupContainer(containerName, runId);
      } catch (error) {
        failure ??= error;
      }
    }
    try {
      cleanupTemporaryDirectory(temporaryDirectory);
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure !== undefined) {
    throw failure;
  }
  process.stdout.write(
    "S3 adapter integration passed: exact preview CORS preflight/PUT response, signed byte-bounded immutable PUT, oversize/tamper rejection, source/derivative routing, checksum HEAD, HTTPS GET, conditional delete, and not-found.\n",
  );
}

if (process.argv[2] === runnerArgument) {
  try {
    await runAdapterIntegration();
    process.exit(0);
  } catch (error) {
    const code =
      error instanceof IntegrationFailure
        ? error.message
        : "unexpected-adapter-runner-failure";
    process.stderr.write(`S3 adapter integration child failed: ${code}\n`);
    process.exit(1);
  }
} else {
  try {
    await runOrchestrator();
  } catch (error) {
    const code =
      error instanceof IntegrationFailure
        ? error.message
        : "unexpected-integration-failure";
    process.stderr.write(`S3 adapter integration failed: ${code}\n`);
    process.exitCode = 1;
  }
}
