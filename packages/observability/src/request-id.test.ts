import { expect, test } from "vitest";

type RequestIdModule = Readonly<{
  REQUEST_ID_HEADER: "x-request-id";
  resolveRequestId: (candidate: unknown, generate?: () => string) => string;
}>;

async function loadRequestIdModule(): Promise<RequestIdModule> {
  let loaded: unknown;

  try {
    loaded = await import("./request-id.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "request ID module must exist").toBeDefined();
  return loaded as RequestIdModule;
}

test("preserves one canonical UUID request ID", async () => {
  const { REQUEST_ID_HEADER, resolveRequestId } = await loadRequestIdModule();
  const requestId = "018f47a4-7b7c-4f27-8b35-25c984619a11";

  expect(REQUEST_ID_HEADER).toBe("x-request-id");
  expect(
    resolveRequestId(requestId, () => "be880ccd-a610-4f27-92fb-4d650b41ec3a"),
  ).toBe(requestId);
});

test.each([
  undefined,
  "",
  "018F47A4-7B7C-4F27-8B35-25C984619A11",
  "018f47a4-7b7c-4f27-8b35-25c984619a11,other",
  "018f47a4-7b7c-4f27-8b35-25c984619a11\r\nforwarded",
  "留言不应成为-request-id",
  "x".repeat(512),
  ["018f47a4-7b7c-4f27-8b35-25c984619a11"],
])("replaces an untrusted request ID %#", async (candidate) => {
  const { resolveRequestId } = await loadRequestIdModule();
  const generated = "be880ccd-a610-4f27-92fb-4d650b41ec3a";

  expect(resolveRequestId(candidate, () => generated)).toBe(generated);
});
