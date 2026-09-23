import { rm } from "node:fs/promises";

/** Resource failures are independent. Browser profiles and the safe report are always attempted last. */
export async function cleanupAccessibilityResources({
  context,
  browser,
  state,
  profiles,
  remove = rm,
  save,
  report,
}) {
  report.cleanupFailures = [];
  const fail = (name) => {
    report.status = "FAIL";
    report.cleanupFailures.push(name);
  };
  const resources = [
    ["context", context],
    ["browser", browser],
    ["state", state],
  ];
  const results = await Promise.allSettled(
    resources.map(([, resource]) =>
      Promise.resolve().then(() => resource?.close()),
    ),
  );
  for (const [index, result] of results.entries())
    if (result.status === "rejected") fail(resources[index][0]);
  if (profiles) {
    try {
      await remove(profiles, { recursive: true });
    } catch {
      fail("remove");
    }
  }
  try {
    await save();
  } catch {
    fail("save");
  }
}

/** Only static source module locations survive; matcher messages may contain capabilities or form values. */
export function accessibilityFailure(error) {
  const frames = [
    ...String(error?.stack ?? "").matchAll(
      /\/(apps\/api\/scripts|scripts)\/([a-z0-9-]+\.mjs):(\d+):(\d+)/gu,
    ),
  ].map((match) => `${match[1]}/${match[2]}:${match[3]}:${match[4]}`);
  return {
    kind:
      error?.name === "AssertionError"
        ? "ASSERTION"
        : error?.name === "TimeoutError"
          ? "TIMEOUT"
          : "RUNTIME",
    frames: [...new Set(frames)].slice(0, 5),
  };
}
