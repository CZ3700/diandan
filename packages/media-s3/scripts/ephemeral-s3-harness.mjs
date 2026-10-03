import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
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
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

const versityImage =
  "versity/versitygw:v1.7.0@sha256:c4cbd9d9cb8dedbb055ac788dbd02635651b9b1cebac95b095b3217231aa87ad";
const managedContainerPrefix = "fan-support-media-s3-it-";
const managedTemporaryDirectoryPrefix = "fan-support-media-s3-it-";
const region = "us-east-1";

export class IntegrationFailure extends Error {}

/** Credentials stay inside the protected child config and never enter output. */
export function readEphemeralS3Config(
  configEnvironmentKey = "FAN_SUPPORT_MEDIA_S3_TEST_CONFIG",
) {
  let config;
  try {
    config = JSON.parse(
      readFileSync(process.env[configEnvironmentKey], "utf8"),
    );
  } catch {
    fail("runner-config-unreadable");
  }
  if (
    config?.schemaVersion !== 1 ||
    typeof config.endpoint !== "string" ||
    typeof config.accessKeyId !== "string" ||
    typeof config.secretAccessKey !== "string" ||
    !/^fan-support-media-source-[a-f0-9]{12}$/u.test(config.sourceBucket) ||
    !/^fan-support-media-derivative-[a-f0-9]{12}$/u.test(
      config.derivativeBucket,
    )
  )
    fail("runner-config-invalid");
  const endpoint = new URL(config.endpoint);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "localhost" ||
    endpoint.username ||
    endpoint.password
  )
    fail("runner-config-boundary-invalid");
  return Object.freeze(config);
}

export async function prepareEphemeralS3Buckets(config) {
  const { S3Client, CreateBucketCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  try {
    for (const bucket of [config.sourceBucket, config.derivativeBucket])
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } finally {
    client.destroy();
  }
}

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
      // Seeded catalogs keep full-size PNG masters (a 2400x1350 hero is ~5-8 MB);
      // 128m filled mid-suite and surfaced as STORAGE_UNAVAILABLE media jobs.
      "/data/s3:rw,nosuid,nodev,noexec,size=512m",
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

export function runS3IntegrationChild({
  caCertificatePath,
  configPath,
  scriptUrl,
  argument,
  configEnvironmentKey,
  timeoutMs = 60_000,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(scriptUrl), argument],
      {
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: caCertificatePath,
          NODE_TLS_REJECT_UNAUTHORIZED: "1",
          [configEnvironmentKey]: configPath,
        },
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new IntegrationFailure("adapter-runner-timeout"));
    }, timeoutMs);
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

export async function withEphemeralS3(work) {
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
  let value;

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
    value = await work({
      caCertificatePath: tlsMaterial.caCertificatePath,
      configPath,
      configEnvironmentKey: "FAN_SUPPORT_MEDIA_S3_TEST_CONFIG",
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
  return value;
}
