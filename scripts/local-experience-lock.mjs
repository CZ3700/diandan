import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  readFile,
  writeFile,
  rm,
  lstat,
  mkdir,
  readdir,
  rename,
} from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function rejectSymlink(file) {
  try {
    if ((await lstat(file)).isSymbolicLink())
      throw new Error("Workspace ownership symlink is forbidden");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function publishClaim(directory, claim) {
  const file = path.join(directory, claim.claimId + ".json");
  const temporary = file + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(claim), {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, file);
}

async function readClaims(directory) {
  const claims = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.name.endsWith(".json")) continue;
    if (!entry.isFile())
      throw new Error("Invalid workspace arbitration record");
    const file = path.join(directory, entry.name);
    let value;
    try {
      value = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (
      value.schemaVersion !== 1 ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value.claimId) ||
      entry.name !== value.claimId + ".json" ||
      !Number.isSafeInteger(value.pid) ||
      value.pid < 1 ||
      !(
        value.ticket === null ||
        (Number.isSafeInteger(value.ticket) && value.ticket > 0)
      )
    )
      throw new Error("Invalid workspace arbitration record");
    if (processAlive(value.pid)) claims.push(value);
    // Each claim has a fresh UUID and is never reassigned, including after a crash.
    // Unlike workspace.lock, this path can never refer to a newer owner's record.
    else await rm(file, { force: true });
  }
  return claims;
}

/** Serialize short lock-file mutations, including recovery and release. */
async function withArbitration(directory, action) {
  const claimsDirectory = path.join(directory, ".workspace-claims");
  await mkdir(claimsDirectory, { mode: 0o700, recursive: true });
  await rejectSymlink(claimsDirectory);
  const claim = {
    schemaVersion: 1,
    claimId: randomUUID(),
    pid: process.pid,
    ticket: null,
  };
  // Lamport's choosing stage MUST be visible before selecting a ticket. A contender
  // with a later publication and lower UUID cannot enter while this selection runs.
  await publishClaim(claimsDirectory, claim);
  try {
    const existing = await readClaims(claimsDirectory);
    claim.ticket =
      Math.max(0, ...existing.map((value) => value.ticket ?? 0)) + 1;
    if (!Number.isSafeInteger(claim.ticket))
      throw new Error("Workspace arbitration ticket exhausted");
    await publishClaim(claimsDirectory, claim);
    const deadline = performance.now() + 10000;
    while (true) {
      const waiting = (await readClaims(claimsDirectory)).some(
        (value) =>
          value.claimId !== claim.claimId &&
          (value.ticket === null ||
            value.ticket < claim.ticket ||
            (value.ticket === claim.ticket && value.claimId < claim.claimId)),
      );
      if (!waiting) return await action();
      if (performance.now() >= deadline)
        throw new Error(
          "Workspace ownership arbitration is busy; existing environment preserved",
        );
      await delay(5);
    }
  } finally {
    await rm(path.join(claimsDirectory, claim.claimId + ".json"), {
      force: true,
    });
  }
}

/** Next's generated files belong to the checkout, so only one local environment may own them. */
export async function acquireLocalWorkspaceLock(directory, owner) {
  const file = path.join(directory, "workspace.lock");
  await withArbitration(directory, async () => {
    await rejectSymlink(file);
    try {
      await writeFile(file, JSON.stringify({ schemaVersion: 1, ...owner }), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const previous = JSON.parse(await readFile(file, "utf8"));
      if (
        !Number.isInteger(previous.pid) ||
        previous.pid < 1 ||
        previous.schemaVersion !== 1
      )
        throw new Error(
          "Invalid workspace lock; existing environment preserved",
          { cause: error },
        );
      if (processAlive(previous.pid))
        throw new Error(
          `Local instance ${previous.instance} already owns this checkout; stop it before starting another`,
          { cause: error },
        );
      await rm(file);
      await writeFile(file, JSON.stringify({ schemaVersion: 1, ...owner }), {
        flag: "wx",
        mode: 0o600,
      });
    }
  });
  return () =>
    withArbitration(directory, async () => {
      await rejectSymlink(file);
      const value = JSON.parse(await readFile(file, "utf8"));
      if (value.runId !== owner.runId || value.instanceId !== owner.instanceId)
        throw new Error("Workspace ownership changed");
      await rm(file);
    });
}
