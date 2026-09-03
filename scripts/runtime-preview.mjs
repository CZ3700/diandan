import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
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
const startupFailureProbeContainerName =
  "fan-support-preview-p0-05-startup-probe";
const fatalFailureProbeContainerName = "fan-support-preview-p0-05-fatal-probe";
const nextFailureProbeContainerNames = Object.freeze({
  admin: "fan-support-preview-p0-05-admin-fatal-probe",
  storefront: "fan-support-preview-p0-05-storefront-fatal-probe",
});
const sourceBucketName = "fan-support-media-source";
const derivativeBucketName = "fan-support-media-derivative";
const bucketNames = Object.freeze([sourceBucketName, derivativeBucketName]);
const previewBrowserOrigins = Object.freeze([
  "https://localhost:3443",
  "https://localhost:3444",
]);
const previewBucketCorsConfiguration = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
  "<CORSRule>",
  ...previewBrowserOrigins.map(
    (origin) => `<AllowedOrigin>${origin}</AllowedOrigin>`,
  ),
  "<AllowedMethod>PUT</AllowedMethod>",
  "<AllowedMethod>GET</AllowedMethod>",
  "<AllowedMethod>HEAD</AllowedMethod>",
  "<AllowedHeader>content-type</AllowedHeader>",
  "<AllowedHeader>if-none-match</AllowedHeader>",
  "<AllowedHeader>x-amz-checksum-sha256</AllowedHeader>",
  "<MaxAgeSeconds>300</MaxAgeSeconds>",
  "</CORSRule>",
  "</CORSConfiguration>",
].join("");
const publicDerivativeObject = Object.freeze({
  body: "fan-support-preview-public-derivative-v1\n",
  key: "preview/runtime/public-derivative.txt",
});
const privateSourceObject = Object.freeze({
  body: "fan-support-preview-private-source-v1\n",
  key: "preview/runtime/private-source.txt",
});
const rejectedAnonymousDerivativeObject = Object.freeze({
  body: "fan-support-preview-rejected-anonymous-write-v1\n",
  key: "preview/runtime/rejected-anonymous-write.txt",
});
const region = "us-east-1";
const applicationLogKeys = new Set([
  "durationMs",
  "errorCode",
  "event",
  "httpMethod",
  "httpRoute",
  "httpStatusCode",
  "level",
  "outcome",
  "requestId",
  "schemaVersion",
  "service",
  "spanId",
  "timestamp",
  "traceId",
]);
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
  const canonicalWorkspaceRoot = realpathSync(workspaceRoot);
  const canonicalTlsParentDirectory = realpathSync(tlsParentDirectory);
  if (
    parentMetadata.isSymbolicLink() ||
    !parentMetadata.isDirectory() ||
    !canonicalTlsParentDirectory.startsWith(
      `${canonicalWorkspaceRoot}${path.sep}`,
    )
  ) {
    throw new Error("Preview TLS cache root is unsafe");
  }
  const directory = mkdtempSync(
    path.join(tlsParentDirectory, tlsDirectoryPrefix),
  );
  try {
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
    const canonicalTlsParentDirectory = realpathSync(tlsParentDirectory);
    const canonicalDirectory = realpathSync(resolved);
    return (
      path.dirname(canonicalDirectory) === canonicalTlsParentDirectory &&
      path.basename(resolved).startsWith(tlsDirectoryPrefix) &&
      !metadata.isSymbolicLink() &&
      metadata.isDirectory()
    );
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw new Error("Cannot inspect managed preview TLS material", {
      cause: error,
    });
  }
}

function removeTlsDirectory(directory) {
  if (!isManagedTlsDirectory(directory)) {
    return;
  }

  try {
    rmSync(path.resolve(directory), { force: true, recursive: true });
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw new Error("Cannot remove managed preview TLS material", {
      cause: error,
    });
  }
}

function listManagedTlsDirectories() {
  let entries;
  try {
    entries = readdirSync(tlsParentDirectory, { withFileTypes: true });
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw new Error("Cannot list managed preview TLS material", {
      cause: error,
    });
  }

  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith(tlsDirectoryPrefix),
    )
    .map((entry) => path.join(tlsParentDirectory, entry.name))
    .filter(isManagedTlsDirectory)
    .sort();
}

function removeStaleTlsDirectories(activeDirectory) {
  const canonicalActiveDirectory =
    activeDirectory === undefined ? undefined : path.resolve(activeDirectory);
  for (const directory of listManagedTlsDirectories()) {
    if (directory !== canonicalActiveDirectory) {
      removeTlsDirectory(directory);
    }
  }
}

function assertManagedTlsDirectories(expectedDirectories) {
  const actualDirectories = listManagedTlsDirectories();
  const normalizedExpectedDirectories = expectedDirectories
    .map((directory) => path.resolve(directory))
    .sort();
  if (
    actualDirectories.length !== normalizedExpectedDirectories.length ||
    normalizedExpectedDirectories.some(
      (directory, index) => directory !== actualDirectories[index],
    )
  ) {
    throw new Error(
      "Managed preview TLS material is not in the expected state",
    );
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
    timeout: options.timeoutMs ?? 60_000,
  });

  if (result.error !== undefined || result.status !== 0) {
    throw new Error(options.failureMessage ?? "Docker command failed");
  }

  return capture ? String(result.stdout) : "";
}

function runCompose(arguments_, options = {}) {
  return runDocker([...composePrefix, ...arguments_], options);
}

function runDockerForResult(arguments_, options = {}) {
  const result = spawnSync("docker", arguments_, {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: options.environment ?? composeEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
    stdio: "pipe",
    timeout: options.timeoutMs ?? 60_000,
  });
  if (result.error !== undefined) {
    throw new Error(options.failureMessage ?? "Docker command failed");
  }

  return Object.freeze({
    output: `${String(result.stdout)}${String(result.stderr)}`,
    signal: result.signal,
    status: result.status,
  });
}

function runComposeForResult(arguments_, options = {}) {
  return runDockerForResult([...composePrefix, ...arguments_], options);
}

function readContainerLogs(containerName, serviceName, environment) {
  const result = runDockerForResult(["logs", containerName], {
    environment,
    failureMessage: `Cannot read the ${serviceName} failure probe logs`,
    timeoutMs: 10_000,
  });
  if (result.status !== 0 || result.signal !== null) {
    throw new Error(`Cannot read the ${serviceName} failure probe logs`);
  }
  return result.output;
}

function removeProbeContainer(containerName, serviceName) {
  const inspected = runDockerForResult(
    ["inspect", "--format", "{{json .Config.Labels}}", containerName],
    {
      failureMessage: "Cannot inspect an isolated failure probe container",
      timeoutMs: 10_000,
    },
  );
  if (inspected.status !== 0) {
    if (
      inspected.status === 1 &&
      /no such (?:container|object)/iu.test(inspected.output)
    ) {
      return;
    }
    throw new Error("Cannot inspect an isolated failure probe container");
  }

  let labels;
  try {
    labels = JSON.parse(inspected.output);
  } catch {
    throw new Error("An isolated failure probe container has invalid labels");
  }
  if (
    labels?.["com.docker.compose.project"] !== projectName ||
    labels?.["com.docker.compose.service"] !== serviceName ||
    labels?.["com.docker.compose.oneoff"] !== "True"
  ) {
    throw new Error("Refusing to remove an unmanaged probe container");
  }

  const removed = runDockerForResult(["rm", "--force", containerName], {
    failureMessage: "Cannot remove an isolated failure probe container",
    timeoutMs: 10_000,
  });
  if (removed.status !== 0) {
    throw new Error("Cannot remove an isolated failure probe container");
  }
}

function readEnvironmentValue(entries, name) {
  const prefix = `${name}=`;
  const entry = entries.find((candidate) => candidate.startsWith(prefix));
  return entry?.slice(prefix.length);
}

function readServiceContainerId(serviceName, environment) {
  const containerId = runCompose(
    ["--profile", "preview", "ps", "--all", "--quiet", serviceName],
    {
      capture: true,
      environment,
      failureMessage: `Cannot locate the ${serviceName} preview container`,
    },
  ).trim();
  if (containerId === "") {
    throw new Error(`The ${serviceName} preview container is unavailable`);
  }
  return containerId;
}

function readContainerState(containerId) {
  const text = runDocker(
    ["inspect", "--format", "{{json .State}}", containerId],
    {
      capture: true,
      failureMessage: "Cannot inspect preview container state",
    },
  );

  try {
    const state = JSON.parse(text);
    if (
      state === null ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      typeof state.ExitCode !== "number" ||
      typeof state.OOMKilled !== "boolean" ||
      typeof state.Running !== "boolean" ||
      typeof state.StartedAt !== "string"
    ) {
      throw new Error("invalid state");
    }
    return state;
  } catch {
    throw new Error("Cannot read preview container state");
  }
}

function readContainerEnvironment(serviceName) {
  const containerId = readServiceContainerId(serviceName);

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

function canonicalS3Query(url) {
  return [...url.searchParams.entries()]
    .map(([key, value]) => [encodeURIComponent(key), encodeURIComponent(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function signedS3Headers(method, url, accessKeyId, secretAccessKey, payload) {
  const now = new Date();
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/gu, "");
  const date = iso.slice(0, 8);
  const payloadHash = hash(payload);
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
    canonicalS3Query(url),
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

function encodeObjectKey(objectKey) {
  return objectKey.split("/").map(encodeURIComponent).join("/");
}

async function requestS3(
  method,
  bucketName,
  state,
  caCertificate,
  options = {},
) {
  const objectPath =
    options.objectKey === undefined
      ? ""
      : `/${encodeObjectKey(options.objectKey)}`;
  const url = new URL(`https://localhost:7443/${bucketName}${objectPath}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const body = options.body ?? "";
  return requestLocalHttps(url, caCertificate, {
    body,
    headers: {
      ...signedS3Headers(
        method,
        url,
        state.objectStorageAccessKeyId,
        state.objectStorageSecretAccessKey,
        body,
      ),
      "content-length": String(Buffer.byteLength(body)),
      ...options.headers,
    },
    method,
  });
}

async function ensureBucket(bucketName, state, caCertificate) {
  const createResponse = await requestS3(
    "PUT",
    bucketName,
    state,
    caCertificate,
  );
  if (createResponse.status !== 200 && createResponse.status !== 409) {
    throw new Error(
      `Object-storage bucket ${bucketName} creation failed with status ${createResponse.status}`,
    );
  }

  const headResponse = await requestS3(
    "HEAD",
    bucketName,
    state,
    caCertificate,
  );
  if (!headResponse.ok) {
    throw new Error(
      `Object-storage bucket ${bucketName} probe failed with status ${headResponse.status}`,
    );
  }
}

async function configureBucketCors(bucketName, state, caCertificate) {
  const response = await requestS3("PUT", bucketName, state, caCertificate, {
    body: previewBucketCorsConfiguration,
    headers: {
      "content-md5": createHash("md5")
        .update(previewBucketCorsConfiguration)
        .digest("base64"),
      "content-type": "application/xml",
    },
    query: { cors: "" },
  });
  if (!response.ok) {
    throw new Error(
      `Object-storage bucket ${bucketName} CORS configuration failed with status ${response.status}`,
    );
  }
}

async function configureDerivativePublicRead(state, caCertificate) {
  const policy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowAnonymousDerivativeReads",
        Effect: "Allow",
        Principal: "*",
        Action: "s3:GetObject",
        Resource: `arn:aws:s3:::${derivativeBucketName}/*`,
      },
    ],
  });
  const response = await requestS3(
    "PUT",
    derivativeBucketName,
    state,
    caCertificate,
    { body: policy, query: { policy: "" } },
  );
  if (!response.ok) {
    throw new Error(
      `Derivative bucket policy failed with status ${response.status}`,
    );
  }
}

async function putPreviewObject(bucketName, object, state, caCertificate) {
  const response = await requestS3("PUT", bucketName, state, caCertificate, {
    body: object.body,
    objectKey: object.key,
  });
  if (!response.ok) {
    throw new Error(
      `Preview object upload failed with status ${response.status}`,
    );
  }
}

async function verifyPublicMediaBoundary(state, caCertificate) {
  await configureDerivativePublicRead(state, caCertificate);
  await putPreviewObject(
    derivativeBucketName,
    publicDerivativeObject,
    state,
    caCertificate,
  );
  await putPreviewObject(
    sourceBucketName,
    privateSourceObject,
    state,
    caCertificate,
  );

  const publicUrl = new URL(
    publicDerivativeObject.key,
    "https://localhost:7444/",
  );
  const publicResponse = await requestLocalHttps(publicUrl, caCertificate);
  if (
    !publicResponse.ok ||
    publicResponse.body !== publicDerivativeObject.body
  ) {
    throw new Error(
      `Public derivative media verification failed with status ${publicResponse.status}`,
    );
  }

  const privateSourceUrl = new URL(
    `/${sourceBucketName}/${encodeObjectKey(privateSourceObject.key)}`,
    "https://localhost:7443/",
  );
  const privateResponse = await requestLocalHttps(
    privateSourceUrl,
    caCertificate,
  );
  if (privateResponse.status !== 403) {
    throw new Error(
      `Source media anonymous access returned status ${privateResponse.status}`,
    );
  }

  const encodedSourceEscapePaths = [
    `/%2e%2e/${sourceBucketName}/${encodeObjectKey(privateSourceObject.key)}`,
    `/%252e%252e/${sourceBucketName}/${encodeObjectKey(privateSourceObject.key)}`,
    `/..%2f${sourceBucketName}/${encodeObjectKey(privateSourceObject.key)}`,
  ];
  for (const requestPath of encodedSourceEscapePaths) {
    const response = await requestLocalHttps(
      {
        hostname: "localhost",
        path: requestPath,
        port: 7444,
        protocol: "https:",
      },
      caCertificate,
    );
    if (response.ok || response.body === privateSourceObject.body) {
      throw new Error("Encoded source-bucket escape attempt was not denied");
    }
  }

  const anonymousWriteUrl = new URL(
    rejectedAnonymousDerivativeObject.key,
    "https://localhost:7444/",
  );
  const anonymousWriteResponse = await requestLocalHttps(
    anonymousWriteUrl,
    caCertificate,
    {
      body: rejectedAnonymousDerivativeObject.body,
      method: "PUT",
    },
  );
  if (anonymousWriteResponse.status !== 403) {
    throw new Error(
      `Anonymous derivative write returned status ${anonymousWriteResponse.status}`,
    );
  }
  const rejectedObjectProbe = await requestLocalHttps(
    anonymousWriteUrl,
    caCertificate,
  );
  if (rejectedObjectProbe.status !== 404) {
    throw new Error(
      `Rejected anonymous derivative object probe returned status ${rejectedObjectProbe.status}`,
    );
  }

  const anonymousListUrl = new URL("https://localhost:7444/");
  anonymousListUrl.searchParams.set("list-type", "2");
  const anonymousListResponse = await requestLocalHttps(
    anonymousListUrl,
    caCertificate,
  );
  if (anonymousListResponse.status !== 403) {
    throw new Error(
      `Anonymous derivative listing returned status ${anonymousListResponse.status}`,
    );
  }

  return Object.freeze({ publicUrl: publicUrl.href });
}

function requestLocalHttps(url, caCertificate, options = {}) {
  return new Promise((resolve, reject) => {
    const requestOptions = {
      ca: caCertificate,
      headers: options.headers,
      method: options.method ?? "GET",
      rejectUnauthorized: true,
    };
    const handleResponse = (response) => {
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
    };
    const request =
      typeof url === "object" && !(url instanceof URL)
        ? https.request({ ...url, ...requestOptions }, handleResponse)
        : https.request(url, requestOptions, handleResponse);
    request.once("error", reject);
    request.setTimeout(5_000, () => {
      request.destroy(new Error("Local HTTPS preview request timed out"));
    });
    request.end(options.body);
  });
}

async function expectHealth(url, service) {
  const deadline = Date.now() + 20_000;
  const expected = { schemaVersion: 1, service, status: "ok" };

  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(url, {
        signal: globalThis.AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const body = await response.json();
        if (JSON.stringify(body) === JSON.stringify(expected)) {
          return;
        }
      }
    } catch {
      // A just-restarted container can briefly be healthy before its host
      // port forwarding is ready. Retry within the fixed deadline.
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
  }

  throw new Error(`${service} health did not become ready`);
}

function parseApplicationLogRecords(text) {
  const records = [];
  for (const line of text.split(/\r?\n/u)) {
    const jsonStart = line.indexOf("{");
    if (jsonStart < 0) {
      continue;
    }

    try {
      const record = JSON.parse(line.slice(jsonStart));
      if (
        record !== null &&
        typeof record === "object" &&
        !Array.isArray(record) &&
        record.schemaVersion === 1 &&
        typeof record.service === "string" &&
        typeof record.event === "string"
      ) {
        records.push(record);
      }
    } catch {
      // Framework-owned banner and infrastructure output are not app records.
    }
  }
  return records;
}

function assertAllowlistedApplicationLog(record) {
  const unexpectedKey = Object.keys(record).find(
    (key) => !applicationLogKeys.has(key),
  );
  if (unexpectedKey !== undefined) {
    throw new Error("An application log record contains a non-allowlisted key");
  }
}

async function readCorrelationLogs(since, requestId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const text = runCompose(
      [
        "--profile",
        "preview",
        "logs",
        "--no-color",
        "--since",
        since,
        "storefront",
        "api",
      ],
      {
        capture: true,
        failureMessage: "Cannot read application correlation logs",
      },
    );
    const records = parseApplicationLogRecords(text).filter(
      (record) => record.requestId === requestId,
    );
    if (
      records.some((record) => record.service === "storefront") &&
      records.some((record) => record.service === "api")
    ) {
      return { records, text };
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }

  throw new Error("Storefront-to-API correlation logs were not emitted");
}

async function verifyObservabilityCorrelation(caCertificate) {
  const requestId = randomUUID();
  const traceId = randomBytes(16).toString("hex");
  const parentSpanId = randomBytes(8).toString("hex");
  const privacyCanary = `private-${randomBytes(18).toString("hex")}`;
  const since = new Date(Date.now() - 1_000).toISOString();
  const response = await requestLocalHttps(
    `https://localhost:3443/_internal/observability?private=${privacyCanary}`,
    caCertificate,
    {
      headers: {
        authorization: `Bearer ${privacyCanary}`,
        cookie: `preview_private=${privacyCanary}`,
        traceparent: `00-${traceId}-${parentSpanId}-01`,
        "x-request-id": requestId,
      },
    },
  );
  if (response.status !== 200 || response.body.includes(privacyCanary)) {
    throw new Error("Storefront observability probe returned an unsafe result");
  }

  let body;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new Error("Storefront observability probe returned invalid JSON");
  }
  if (
    body?.schemaVersion !== 1 ||
    body?.status !== "ok" ||
    body?.upstream !== "api"
  ) {
    throw new Error(
      "Storefront observability probe returned an invalid contract",
    );
  }

  const { records, text } = await readCorrelationLogs(since, requestId);
  if (text.includes(privacyCanary)) {
    throw new Error(
      "Application correlation logs contain private request data",
    );
  }
  for (const record of records) {
    assertAllowlistedApplicationLog(record);
  }

  const storefrontRecord = records.find(
    (record) =>
      record.service === "storefront" &&
      record.event === "http.request.completed" &&
      record.httpRoute === "/_internal/observability",
  );
  const apiRecord = records.find(
    (record) =>
      record.service === "api" &&
      record.event === "http.request.completed" &&
      record.httpRoute === "/healthz",
  );
  if (
    storefrontRecord === undefined ||
    apiRecord === undefined ||
    storefrontRecord.traceId !== traceId ||
    apiRecord.traceId !== traceId ||
    typeof storefrontRecord.spanId !== "string" ||
    typeof apiRecord.spanId !== "string" ||
    storefrontRecord.spanId === apiRecord.spanId
  ) {
    throw new Error(
      "Storefront and API did not preserve request/trace correlation",
    );
  }

  return Object.freeze({ requestId, traceId });
}

function verifySafeStartupFailure(state) {
  const privacyCanary = `private-${randomBytes(18).toString("hex")}`;
  removeProbeContainer(startupFailureProbeContainerName, "api");
  let result;
  try {
    result = runDockerForResult(
      [
        ...composePrefix,
        "--profile",
        "preview",
        "run",
        "--rm",
        "--no-deps",
        "--name",
        startupFailureProbeContainerName,
        "--env",
        `PORT=${privacyCanary}`,
        "api",
      ],
      {
        environment: composeEnvironment(state),
        failureMessage: "Cannot execute the isolated startup failure probe",
        timeoutMs: 30_000,
      },
    );
  } finally {
    removeProbeContainer(startupFailureProbeContainerName, "api");
  }
  if (
    result.status !== 1 ||
    result.signal !== null ||
    result.output.includes(privacyCanary)
  ) {
    throw new Error("The startup failure probe was not safely rejected");
  }

  const records = parseApplicationLogRecords(result.output).filter(
    (candidate) =>
      candidate.service === "api" && candidate.event === "runtime.start_failed",
  );
  const record = records[0];
  if (
    records.length !== 1 ||
    record === undefined ||
    record.level !== "error" ||
    record.errorCode !== "STARTUP_FAILED" ||
    record.outcome !== "failure"
  ) {
    throw new Error("The startup failure probe did not emit its fixed record");
  }
  assertAllowlistedApplicationLog(record);
}

function verifySafeFatalFailure(state) {
  const privacyCanary = `private-${randomBytes(18).toString("hex")}`;
  removeProbeContainer(fatalFailureProbeContainerName, "api");
  let result;
  try {
    result = runDockerForResult(
      [
        ...composePrefix,
        "--profile",
        "preview",
        "run",
        "--rm",
        "--no-deps",
        "--name",
        fatalFailureProbeContainerName,
        "--env",
        "PORT=3102",
        "--env",
        `P0_FATAL_PROBE_CANARY=${privacyCanary}`,
        "api",
        "node",
        "--input-type=module",
        "--eval",
        [
          'await import("./dist/main.js");',
          "Promise.reject(new Error(process.env.P0_FATAL_PROBE_CANARY));",
          "Promise.reject(new Error(process.env.P0_FATAL_PROBE_CANARY));",
          "Promise.reject(new Error(process.env.P0_FATAL_PROBE_CANARY));",
        ].join("\n"),
      ],
      {
        environment: composeEnvironment(state),
        failureMessage: "Cannot execute the isolated fatal failure probe",
        timeoutMs: 30_000,
      },
    );
  } finally {
    removeProbeContainer(fatalFailureProbeContainerName, "api");
  }

  if (
    result.status !== 1 ||
    result.signal !== null ||
    result.output.includes(privacyCanary)
  ) {
    throw new Error("The fatal failure probe was not safely contained");
  }

  const records = parseApplicationLogRecords(result.output);
  const fatalRecords = records.filter(
    (record) =>
      record.service === "api" && record.event === "runtime.fatal_error",
  );
  const stoppedRecords = records.filter(
    (record) => record.service === "api" && record.event === "runtime.stopped",
  );
  if (
    fatalRecords.length !== 1 ||
    fatalRecords[0]?.level !== "error" ||
    fatalRecords[0]?.errorCode !== "FATAL_RUNTIME_ERROR" ||
    fatalRecords[0]?.outcome !== "failure" ||
    stoppedRecords.length !== 1
  ) {
    throw new Error("The fatal failure probe did not emit its fixed records");
  }
  assertAllowlistedApplicationLog(fatalRecords[0]);
  assertAllowlistedApplicationLog(stoppedRecords[0]);
}

async function readNextFailureProbeLogs(containerName, serviceName, canary) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const text = readContainerLogs(containerName, serviceName);
    if (text.includes(canary)) {
      throw new Error(`The ${serviceName} failure probe leaked private data`);
    }
    const failureRecords = parseApplicationLogRecords(text).filter(
      (record) =>
        record.service === serviceName &&
        record.event === "next.runtime.failed",
    );
    if (failureRecords.length > 0) {
      return Object.freeze({ failureRecords, text });
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }

  throw new Error(`The ${serviceName} failure probe did not emit a record`);
}

async function verifyNextFailureProbeHealth(
  containerName,
  serviceName,
  environment,
) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      runDocker(
        [
          "exec",
          containerName,
          "node",
          "--input-type=module",
          "--eval",
          [
            'const response = await fetch("http://127.0.0.1:3100/healthz");',
            "const body = await response.json();",
            `if (!response.ok || body.service !== "${serviceName}" || body.status !== "ok") process.exit(1);`,
          ].join("\n"),
        ],
        {
          capture: true,
          environment,
          failureMessage: `The ${serviceName} failure probe stopped serving`,
          timeoutMs: 10_000,
        },
      );
      return;
    } catch {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
    }
  }

  throw new Error(`The ${serviceName} failure probe stopped serving`);
}

async function verifySafeNextRuntimeFailure(state, serviceName, signal) {
  const containerName = nextFailureProbeContainerNames[serviceName];
  const privacyCanary = `private-${randomBytes(18).toString("hex")}`;
  const signalExitCode = signal === "SIGINT" ? 130 : 143;
  const environment = composeEnvironment(state);
  removeProbeContainer(containerName, serviceName);

  try {
    const containerId = runCompose(
      [
        "--profile",
        "preview",
        "run",
        "--detach",
        "--no-deps",
        "--name",
        containerName,
        "--env",
        "PORT=3100",
        "--env",
        `P0_NEXT_FAILURE_PROBE_CANARY=${privacyCanary}`,
        serviceName,
        "node",
        "--input-type=module",
        "--eval",
        [
          'process.once("SIGUSR2", () => {',
          "  for (let index = 0; index < 3; index += 1) {",
          "    Promise.reject(new Error(process.env.P0_NEXT_FAILURE_PROBE_CANARY));",
          "  }",
          "});",
          'await import("./server.js");',
        ].join("\n"),
      ],
      {
        capture: true,
        environment,
        failureMessage: `Cannot start the isolated ${serviceName} failure probe`,
        timeoutMs: 30_000,
      },
    ).trim();
    if (!/^[a-f0-9]{12,64}$/u.test(containerId)) {
      throw new Error(`The ${serviceName} failure probe has an invalid ID`);
    }

    await verifyNextFailureProbeHealth(containerName, serviceName, environment);
    runDocker(["kill", "--signal=SIGUSR2", containerName], {
      environment,
      failureMessage: `Cannot trigger the ${serviceName} failure probe`,
      timeoutMs: 10_000,
    });
    const { failureRecords } = await readNextFailureProbeLogs(
      containerName,
      serviceName,
      privacyCanary,
    );
    for (const record of failureRecords) {
      if (
        record.level !== "error" ||
        record.errorCode !== "INTERNAL_ERROR" ||
        record.outcome !== "failure"
      ) {
        throw new Error(
          `The ${serviceName} failure probe emitted an invalid record`,
        );
      }
      assertAllowlistedApplicationLog(record);
    }

    await verifyNextFailureProbeHealth(containerName, serviceName, environment);

    runDocker(
      ["stop", `--signal=${signal}`, "--timeout", "12", containerName],
      {
        environment,
        failureMessage: `The ${serviceName} failure probe did not stop`,
        timeoutMs: 20_000,
      },
    );
    const stoppedState = readContainerState(containerName);
    if (
      stoppedState.Running ||
      stoppedState.OOMKilled ||
      stoppedState.ExitCode !== signalExitCode
    ) {
      throw new Error(
        `The ${serviceName} signal exit was not safely preserved`,
      );
    }

    const stoppedText = readContainerLogs(
      containerName,
      `stopped ${serviceName}`,
      environment,
    );
    if (stoppedText.includes(privacyCanary)) {
      throw new Error(`The ${serviceName} stopped logs leaked private data`);
    }
    const stoppedRecords = parseApplicationLogRecords(stoppedText);
    const shutdownRecords = stoppedRecords.filter(
      (record) =>
        record.service === serviceName && record.event === "runtime.stopped",
    );
    const failedShutdownRecords = stoppedRecords.filter(
      (record) =>
        record.service === serviceName &&
        record.event === "runtime.stop_failed",
    );
    if (
      shutdownRecords.length !== 1 ||
      shutdownRecords[0]?.level !== "info" ||
      shutdownRecords[0]?.outcome !== "success" ||
      failedShutdownRecords.length !== 0
    ) {
      throw new Error(
        `The ${serviceName} telemetry shutdown was not safely observed`,
      );
    }
    assertAllowlistedApplicationLog(shutdownRecords[0]);
  } finally {
    removeProbeContainer(containerName, serviceName);
  }
}

async function readWorkerShutdownRecords(since, environment) {
  const deadline = Date.now() + 5_000;
  let records = [];

  while (Date.now() < deadline) {
    const text = runCompose(
      [
        "--profile",
        "preview",
        "logs",
        "--no-color",
        "--since",
        since,
        "worker",
      ],
      {
        capture: true,
        environment,
        failureMessage: "Cannot inspect Worker shutdown logs",
      },
    );
    records = parseApplicationLogRecords(text).filter(
      (record) =>
        record.service === "worker" && record.event === "runtime.stopped",
    );
    if (records.length > 0) {
      return records;
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }

  return records;
}

async function verifyGracefulWorkerShutdown(state) {
  const environment = composeEnvironment(state);
  const originalContainerId = readServiceContainerId("worker", environment);
  const originalState = readContainerState(originalContainerId);
  const since = originalState.StartedAt;
  let shutdownVerified = false;

  try {
    if (!originalState.Running || originalState.OOMKilled) {
      throw new Error("Worker is not running before the shutdown probe");
    }
    runDocker(
      ["stop", "--signal=SIGTERM", "--timeout", "10", originalContainerId],
      {
        environment,
        failureMessage: "Worker did not stop gracefully",
        timeoutMs: 20_000,
      },
    );
    const stoppedState = readContainerState(originalContainerId);
    if (
      stoppedState.Running ||
      stoppedState.OOMKilled ||
      stoppedState.ExitCode !== 0
    ) {
      throw new Error("Worker did not exit cleanly after SIGTERM");
    }
    const records = await readWorkerShutdownRecords(since, environment);
    if (
      records.length !== 1 ||
      records[0]?.level !== "info" ||
      records[0]?.outcome !== "success"
    ) {
      throw new Error(
        "Worker did not emit exactly one graceful shutdown record",
      );
    }
    assertAllowlistedApplicationLog(records[0]);
    shutdownVerified = true;
  } catch {
    // Recovery is attempted below before the fixed verification error escapes.
  }

  let recoveryVerified = false;
  try {
    runCompose(
      [
        "--profile",
        "preview",
        "up",
        "--detach",
        "--no-deps",
        "--wait",
        "--wait-timeout",
        "60",
        "worker",
      ],
      {
        environment,
        failureMessage: "Worker did not recover after the shutdown probe",
        timeoutMs: 90_000,
      },
    );
    await expectHealth("http://127.0.0.1:3003/healthz", "worker");
    const restartedContainerId = readServiceContainerId("worker", environment);
    const restartedState = readContainerState(restartedContainerId);
    if (
      !restartedState.Running ||
      restartedState.OOMKilled ||
      restartedState.StartedAt === originalState.StartedAt
    ) {
      throw new Error("Worker restart did not create a fresh running process");
    }
    const restartLogs = runCompose(
      [
        "--profile",
        "preview",
        "logs",
        "--no-color",
        "--since",
        restartedState.StartedAt,
        "worker",
      ],
      {
        capture: true,
        environment,
        failureMessage: "Cannot inspect Worker restart logs",
      },
    );
    const startedRecords = parseApplicationLogRecords(restartLogs).filter(
      (record) =>
        record.service === "worker" && record.event === "runtime.started",
    );
    const startedRecord = startedRecords[0];
    if (
      startedRecords.length !== 1 ||
      startedRecord?.level !== "info" ||
      startedRecord?.outcome !== "success"
    ) {
      throw new Error("Worker restart did not emit one fixed startup record");
    }
    assertAllowlistedApplicationLog(startedRecord);
    recoveryVerified = true;
  } catch {
    // Report only the fixed recovery classification below.
  }

  if (!shutdownVerified && !recoveryVerified) {
    throw new Error("Worker shutdown and recovery verification failed");
  }
  if (!shutdownVerified) {
    throw new Error("Worker graceful shutdown verification failed");
  }
  if (!recoveryVerified) {
    throw new Error("Worker recovery verification failed");
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
  for (const bucketName of bucketNames) {
    await ensureBucket(bucketName, state, caCertificate);
    await configureBucketCors(bucketName, state, caCertificate);
  }
  const publicMedia = await verifyPublicMediaBoundary(state, caCertificate);

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

  const correlation = await verifyObservabilityCorrelation(caCertificate);
  verifySafeStartupFailure(state);
  verifySafeFatalFailure(state);
  await verifySafeNextRuntimeFailure(state, "storefront", "SIGTERM");
  await verifySafeNextRuntimeFailure(state, "admin", "SIGINT");
  await verifyGracefulWorkerShutdown(state);

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
  console.log(
    `- Storefront/API correlation: request ${correlation.requestId}, trace ${correlation.traceId}`,
  );
  console.log("- Safe startup failure: fixed structured record verified");
  console.log("- Safe fatal failure: fixed records and clean exit verified");
  console.log(
    "- Next runtime failures: private data contained and signal shutdown verified",
  );
  console.log(
    "- Worker shutdown: graceful stop, single record, and recovery verified",
  );
  console.log(`- PostgreSQL query: ${databaseProbe}`);
  console.log(`- Object-storage TLS buckets: ${bucketNames.join(", ")}`);
  console.log(`- Public derivative media: ${publicMedia.publicUrl}`);
  console.log("- Source media anonymous access: denied");
  console.log("- Encoded source-bucket escape attempts: denied");
  console.log("- Anonymous derivative write: denied and absent");
  console.log("- Anonymous derivative listing: denied");
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
    const previousTlsDirectories = listManagedTlsDirectories();
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
        {
          environment,
          failureMessage: "Preview stack failed to start",
          timeoutMs: 900_000,
        },
      );
      await verifyPreview(state);
    } catch (error) {
      const runningTlsDirectory = tryReadRunningTlsDirectory();
      if (runningTlsDirectory !== undefined) {
        removeStaleTlsDirectories(runningTlsDirectory);
        assertManagedTlsDirectories([runningTlsDirectory]);
      } else {
        removeTlsDirectory(state.tlsDirectory);
        assertManagedTlsDirectories(previousTlsDirectories);
      }
      throw error;
    }
    removeStaleTlsDirectories(state.tlsDirectory);
    assertManagedTlsDirectories([state.tlsDirectory]);
    return;
  }

  if (command === "verify") {
    await verifyPreview(readRunningState());
    return;
  }

  if (command === "logs") {
    const state = readRunningState();
    const result = runComposeForResult(
      ["--profile", "preview", "logs", "--no-color"],
      {
        environment: composeEnvironment(state),
        failureMessage: "Cannot read preview logs",
      },
    );
    if (result.status !== 0 || result.signal !== null) {
      throw new Error("Cannot read preview logs");
    }
    process.stdout.write(
      scrub(result.output, [
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
    removeStaleTlsDirectories(undefined);
    assertManagedTlsDirectories([]);
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
