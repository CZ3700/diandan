import { readFile } from "node:fs/promises";
import path from "node:path";

/** A missing control socket says nothing about whether persistent services stopped. */
export async function assertLocalStopSucceeded(
  { stateDirectory, config },
  expectedRunId,
) {
  let result;
  try {
    result = JSON.parse(
      await readFile(path.join(stateDirectory, "last-run.json"), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT" && expectedRunId === undefined) return;
    throw new Error(
      "Cannot verify local stop completion; existing processes and data were preserved",
      { cause: error },
    );
  }
  if (
    result.schemaVersion !== 1 ||
    result.instanceId !== config.instanceId ||
    (expectedRunId !== undefined && result.runId !== expectedRunId) ||
    result.stopped !== true ||
    !Array.isArray(result.cleanupFailures) ||
    result.cleanupFailures.some((name) => typeof name !== "string")
  )
    throw new Error(
      "Cannot verify local stop completion; existing processes and data were preserved",
    );
  if (result.cleanupFailures.length)
    throw new Error(
      "Local cleanup failed; restart the owned instance to recover, then stop before reset",
    );
}
