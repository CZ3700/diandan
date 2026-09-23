import { randomUUID } from "node:crypto";
/** One new, owned TEST instance. Failure always retains its data for diagnosis. */
export async function runJourneyLifecycle(actions) {
  let needsStop = true;
  try {
    await actions.start();
    const result = await actions.browser();
    if (result?.status !== "PASS")
      throw new Error("Complete journey evidence required");
    await actions.stop();
    needsStop = false;
    await actions.reset();
    return result;
  } catch (error) {
    if (needsStop) {
      try {
        await actions.stop();
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          "Journey cleanup failed; data preserved",
          { cause: cleanup },
        );
      }
    }
    throw error;
  }
}

export function regressionInstanceName() {
  return "test-regression-" + randomUUID().replaceAll("-", "").slice(0, 16);
}
