import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { acquireLocalWorkspaceLock } from "./local-experience-lock.mjs";
import { resetLocalState } from "./local-experience-state.mjs";
import { resetLocalStorage } from "../apps/api/scripts/local-experience-storage.mjs";

/** Hold the same ownership guard as startup until the confirmed instance is fully removed. */
export async function resetLocalExperience({
  workspaceRoot,
  instance,
  state,
  confirmation,
  resetStorage = resetLocalStorage,
}) {
  if (confirmation !== state.config.instanceId)
    throw new Error("Reset confirmation must match the instance identity");
  const release = await acquireLocalWorkspaceLock(
    path.dirname(state.stateDirectory),
    {
      instance,
      instanceId: state.config.instanceId,
      runId: randomUUID(),
      pid: process.pid,
    },
  );
  try {
    try {
      await lstat(path.join(state.stateDirectory, "supervisor.lock"));
      throw new Error("Stop the local instance before reset");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await lstat(path.join(state.stateDirectory, "postgres/postmaster.pid"));
      throw new Error(
        "Confirm owned PostgreSQL has stopped before reset; existing data was preserved",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await resetStorage({ ...state, confirmation });
    await resetLocalState(workspaceRoot, instance, confirmation);
  } finally {
    await release();
  }
}
