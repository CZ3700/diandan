import { expect, test } from "vitest";
import { AdminClientError } from "../workspace/client";
const subject = await import("./state").catch(() => undefined);
test("unknown and transport failures preserve the original request while explicit denials block the view", () => {
  expect(subject?.uncertainExceptionResult).toBeTypeOf("function");
  for (const code of [
    "NETWORK_ERROR",
    "INVALID_RESPONSE",
    "TEMPORARY_UNAVAILABLE",
    "CONTENT_UNAVAILABLE",
  ])
    expect(subject!.uncertainExceptionResult(new AdminClientError(code))).toBe(
      true,
    );
  expect(subject!.uncertainExceptionResult(new Error("unknown"))).toBe(true);
  for (const code of ["FORBIDDEN", "UNAUTHENTICATED", "CSRF_INVALID"]) {
    expect(subject!.uncertainExceptionResult(new AdminClientError(code))).toBe(
      false,
    );
    expect(subject!.exceptionAccessLost(new AdminClientError(code))).toBe(true);
  }
  expect(
    subject!.exceptionAccessLost(new AdminClientError("STALE_VERSION")),
  ).toBe(false);
});
test("read failures describe unavailable information, while an unresolved write describes recovery", async () => {
  const { exceptionError } = await import("./labels");
  const { exceptionsCopy } = await import("./copy");
  const copy = exceptionsCopy("en");
  const error = new AdminClientError("NETWORK_ERROR");
  expect(exceptionError(error, copy, false)).toBe(copy.error);
  expect(exceptionError(error, copy, true)).toBe(copy.uncertain);
});
