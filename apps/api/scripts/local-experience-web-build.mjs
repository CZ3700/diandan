import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { acquireLocalWorkspaceLock } from "../../../scripts/local-experience-lock.mjs";

// The compiled output belongs to the checkout, like the workspace lock that protects it.
const WEB_APPS = Object.freeze(["admin", "storefront"]);
const REVISION = /^[0-9a-f]{40}$/u;
const STALE =
  "Compiled web is missing or stale for this checkout; stop the instance and run pnpm local:build-web first";

export async function localExperienceRoot(workspaceRoot) {
  const directory = path.join(
    await realpath(workspaceRoot),
    "node_modules",
    ".cache",
    "fan-support-local-experience",
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export function webBuildStampPath(workspaceRoot) {
  return path.join(
    workspaceRoot,
    "node_modules",
    ".cache",
    "fan-support-local-experience",
    "web-build.json",
  );
}

async function buildId(workspaceRoot, app) {
  try {
    const value = (
      await readFile(
        path.join(workspaceRoot, "apps", app, ".next", "BUILD_ID"),
        "utf8",
      )
    ).trim();
    return /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function workspaceRevision(workspaceRoot) {
  const { stdout } = await promisify(execFile)("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    timeout: 10000,
  });
  const revision = stdout.trim();
  if (!REVISION.test(revision)) throw new Error("Unknown checkout revision");
  return revision;
}

/** Starting compiled web must never compile: the stamp names the revision both builds came from. */
export async function assertPrebuiltWebCurrent(workspaceRoot, revision) {
  let stamp;
  try {
    stamp = JSON.parse(
      await readFile(webBuildStampPath(workspaceRoot), "utf8"),
    );
  } catch {
    throw new Error(STALE);
  }
  if (stamp?.schemaVersion !== 1 || stamp.revision !== revision)
    throw new Error(STALE);
  for (const app of WEB_APPS) {
    const id = await buildId(workspaceRoot, app);
    if (id === null || stamp.buildIds?.[app] !== id) throw new Error(STALE);
  }
}

/** Builds the four deployable applications exactly as the container image does. */
export function runWebBuild(workspaceRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "corepack",
      [
        "pnpm",
        "exec",
        "turbo",
        "run",
        "build",
        "--filter=@fan-support/admin",
        "--filter=@fan-support/api",
        "--filter=@fan-support/storefront",
        "--filter=@fan-support/worker",
        "--concurrency=1",
      ],
      {
        cwd: workspaceRoot,
        stdio: "inherit",
        // No instance configuration at build time: every origin is read when the server starts.
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !key.startsWith("FAN_SUPPORT_"),
            ),
          ),
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
    );
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(signal ? 1 : code));
  });
}

/**
 * Removes the previous stamp, builds, and stamps only a successful build of an unchanged checkout.
 * Refuses while any instance owns the checkout, and no instance can start while it builds.
 */
export async function buildLocalWeb({
  workspaceRoot,
  runBuild = runWebBuild,
  revisionOf = workspaceRevision,
}) {
  let release;
  try {
    release = await acquireLocalWorkspaceLock(
      await localExperienceRoot(workspaceRoot),
      {
        instance: "build-web",
        instanceId: randomUUID(),
        runId: randomUUID(),
        pid: process.pid,
      },
    );
  } catch (error) {
    throw new Error(
      "Stop the running local instance before building its web applications",
      { cause: error },
    );
  }
  try {
    const revision = await revisionOf(workspaceRoot);
    await rm(webBuildStampPath(workspaceRoot), { force: true });
    const code = await runBuild(workspaceRoot);
    if (code !== 0) return code;
    if ((await revisionOf(workspaceRoot)) !== revision)
      throw new Error("The checkout changed during the build; build again");
    const buildIds = {};
    for (const app of WEB_APPS) {
      buildIds[app] = await buildId(workspaceRoot, app);
      if (buildIds[app] === null)
        throw new Error(`The ${app} build produced no BUILD_ID`);
    }
    const file = webBuildStampPath(workspaceRoot),
      temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({
        schemaVersion: 1,
        revision,
        buildIds,
        builtAt: new Date().toISOString(),
      }) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    await rename(temporary, file);
    return 0;
  } finally {
    await release();
  }
}
