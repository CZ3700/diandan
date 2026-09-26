import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { startLocalProxy } from "./local-experience-tls.mjs";
const execute = promisify(execFile);
const S3_IMAGE =
  "versity/versitygw:v1.7.0@sha256:c4cbd9d9cb8dedbb055ac788dbd02635651b9b1cebac95b095b3217231aa87ad";
export function verifyOwnedContainer(container, instanceId) {
  if (
    container?.Config?.Labels?.["com.fan-support.local-instance"] !== instanceId
  )
    throw new Error("Local container ownership mismatch");
}
export async function startS3(context) {
  const { config, stateDirectory, own } = context,
    name = "fan-local-s3-" + config.instanceId;
  const run = (args) =>
    execute("docker", args, { timeout: 60000, maxBuffer: 1024 * 1024 });
  for (const child of ["s3", "iam"])
    await mkdir(path.join(stateDirectory, "media", child), {
      recursive: true,
      mode: 0o700,
    });
  let container;
  try {
    container = JSON.parse((await run(["inspect", name])).stdout)[0];
  } catch (error) {
    if (!/no such (object|container)/iu.test(String(error.stderr)))
      throw new Error("Docker is unavailable; start Docker or Colima", {
        cause: error,
      });
  }
  if (container) verifyOwnedContainer(container, config.instanceId);
  else {
    const data = path.join(stateDirectory, "media");
    await mkdir(data, { recursive: true, mode: 0o700 });
    const environment = path.join(stateDirectory, "s3.env");
    await writeFile(
      environment,
      `ROOT_ACCESS_KEY_ID=${config.s3.accessKeyId}\nROOT_SECRET_ACCESS_KEY=${config.s3.secretAccessKey}\nVGW_BACKEND=posix\nVGW_BACKEND_ARGS=/data/s3\nVGW_HEALTH=/_/health\nVGW_IAM_DIR=/data/iam\nVGW_PORT=:7070\nVGW_REGION=us-east-1\n`,
      { mode: 0o600 },
    );
    try {
      await run([
        "create",
        "--name",
        name,
        "--label",
        "com.fan-support.local-instance=" + config.instanceId,
        "--publish",
        `127.0.0.1:${config.ports.s3Backend}:7070`,
        "--mount",
        `type=bind,source=${data},target=/data`,
        "--env-file",
        environment,
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=128",
        // Native Linux Docker keeps host ownership on the 0700 bind mount; without
        // DAC override only the owning user can write it (macOS file sharing maps it).
        ...(process.platform === "linux"
          ? ["--user", `${process.getuid()}:${process.getgid()}`]
          : []),
        S3_IMAGE,
      ]);
    } finally {
      await rm(environment, { force: true });
    }
  }
  await run(["start", name]);
  own("persistent object storage", async () => {
    verifyOwnedContainer(
      JSON.parse((await run(["inspect", name])).stdout)[0],
      config.instanceId,
    );
    await run(["stop", "--time", "10", name]);
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await globalThis.fetch(
        `http://127.0.0.1:${config.ports.s3Backend}/_/health`,
      );
      await r.body?.cancel();
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Startup probe. */
    }
    await delay(100);
  }
  if (!ready) throw new Error("Object storage did not become healthy");
  const endpoint = `https://localhost:${config.ports.s3}`;
  await startLocalProxy({
    config,
    port: config.ports.s3,
    origin: endpoint,
    target: `http://127.0.0.1:${config.ports.s3Backend}`,
    own,
    name: "object storage TLS",
  });
  const s3 = { schemaVersion: 1, endpoint, ...config.s3 };
  const client = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
    },
  });
  own("object storage client", () => client.destroy());
  for (const Bucket of [s3.sourceBucket, s3.derivativeBucket]) {
    try {
      await client.send(new CreateBucketCommand({ Bucket }));
    } catch (error) {
      if (
        !["BucketAlreadyExists", "BucketAlreadyOwnedByYou"].includes(error.name)
      )
        throw error;
    }
    await client.send(
      new PutBucketCorsCommand({
        Bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [config.origins.admin],
              AllowedMethods:
                Bucket === s3.sourceBucket ? ["PUT"] : ["GET", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 300,
            },
          ],
        },
      }),
    );
  }
  return s3;
}

/** Explicit reset only: stop preserves this container and its bind-mounted business media. */
export async function resetLocalStorage({
  config,
  stateDirectory,
  confirmation,
  execute: runCommand = execute,
}) {
  if (confirmation !== config.instanceId)
    throw new Error("Reset confirmation must match the instance identity");
  const name = "fan-local-s3-" + config.instanceId;
  const run = (args) =>
    runCommand("docker", args, { timeout: 60000, maxBuffer: 1024 * 1024 });
  let container;
  try {
    container = JSON.parse((await run(["inspect", name])).stdout)[0];
  } catch (error) {
    if (/no such (object|container)/iu.test(String(error.stderr))) return;
    throw new Error(
      "Cannot verify local storage before reset; existing data was preserved",
      { cause: error },
    );
  }
  verifyOwnedContainer(container, config.instanceId);
  if (
    container.State?.Running !== false ||
    container.State?.Restarting === true
  )
    throw new Error("Stop local object storage before reset");
  const mounts = container.Mounts;
  if (
    !Array.isArray(mounts) ||
    mounts.length !== 1 ||
    mounts[0].Type !== "bind" ||
    mounts[0].Destination !== "/data" ||
    mounts[0].Source !== path.join(stateDirectory, "media")
  )
    throw new Error(
      "Local storage mount ownership mismatch; existing data was preserved",
    );
  // No force flag: if it starts after inspection, Docker refuses removal and the directory survives.
  await run(["rm", name]);
}
