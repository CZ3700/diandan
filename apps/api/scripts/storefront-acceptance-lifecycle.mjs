/** Only explicitly registered, owned resources are closed; a failed close never skips another. */
export async function withAcceptanceResources(verify) {
  const resources = [];
  const failures = [];
  let result;
  try {
    result = await verify((name, close) => {
      if (typeof close !== "function")
        throw new TypeError(`Missing cleanup: ${name}`);
      resources.push(close);
    });
  } catch (error) {
    failures.push(error);
  }
  for (const close of resources.reverse()) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      "Acceptance verification or cleanup failed",
    );
  return result;
}
