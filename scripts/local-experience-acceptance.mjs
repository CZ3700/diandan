import { isDeepStrictEqual } from "node:util";

function requireCompleteBrowser(result) {
  if (result?.status !== "PASS" || !result.factsPath)
    throw new Error("Local acceptance requires complete browser evidence");
  return result;
}

/** Verify one owned instance; unsuccessful runs retain their data. */
export async function runLocalAcceptance(actions, { keep = false } = {}) {
  let needsStop = false;
  const stop = async () => {
    if (!needsStop) return;
    await actions.stop();
    needsStop = false;
  };
  try {
    await actions.initialize();
    needsStop = true;
    await actions.start();
    const first = requireCompleteBrowser(await actions.browser());
    const before = await actions.snapshot();
    await stop();
    needsStop = true;
    await actions.start();
    if (!isDeepStrictEqual(before, await actions.snapshot()))
      throw new Error(
        "Local persisted configuration or media changed on restart",
      );
    const restarted = requireCompleteBrowser(
      await actions.browser(first.factsPath),
    );
    await stop();
    if (!keep) await actions.reset();
    return {
      schemaVersion: 1,
      status: "PASS",
      first,
      restarted,
      retained: keep,
    };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Local acceptance cleanup failed; data preserved",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
