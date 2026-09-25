import { expect, test, vi } from "vitest";
import { createAdminSessionUseCases } from "./admin-session.js";
import { digestAdminContentToken } from "./admin-content-tokens.js";
import type { AdminSessionRepositories } from "@fan-support/persistence-port";

const tokenPepper = "a".repeat(64),
  token = "a".repeat(42) + "A",
  csrf = "b".repeat(42) + "A";
const request = {
  schemaVersion: 1,
  requestId: "10000000-0000-4000-8000-000000000001",
  sessionToken: token,
  csrfToken: csrf,
  command: { schemaVersion: 1, action: "READ_SESSION" },
};
const response = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "ADMIN_SESSION",
  actorId: request.requestId,
  permissions: ["content.read"],
  localeScopes: ["ja"],
};
function setup(value: unknown = response) {
  const read = vi.fn(async () => value);
  const run = vi.fn(
    async (
      work: (repositories: AdminSessionRepositories) => Promise<unknown>,
    ) => work({ adminSession: { read } } as AdminSessionRepositories),
  );
  const useCases = createAdminSessionUseCases({
    tokenPepper,
    transactions: { runInAdminSessionTransaction: run } as never,
  });
  return { read, run, useCases };
}
test("each session discovery reads current canonical access using only credential digests", async () => {
  const { read, useCases } = setup();
  expect(await useCases.execute(request)).toEqual(response);
  expect(read).toHaveBeenCalledWith({
    schemaVersion: 1,
    sessionTokenDigest: digestAdminContentToken({
      tokenPepper,
      purpose: "admin-session",
      token,
    }),
    csrfTokenDigest: digestAdminContentToken({
      tokenPepper,
      purpose: "admin-csrf",
      token: csrf,
    }),
  });
  read.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "UNAUTHENTICATED",
  });
  expect(await useCases.execute(request)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "UNAUTHENTICATED",
  });
  expect(read).toHaveBeenCalledTimes(2);
});
test("invalid client authority does not read the session", async () => {
  const { run, useCases } = setup();
  expect(
    await useCases.execute({ ...request, actorId: request.requestId }),
  ).toEqual({ schemaVersion: 1, outcome: "FAILURE", code: "INVALID_COMMAND" });
  expect(run).not.toHaveBeenCalled();
});
test("invalid repository output and infrastructure errors expose only safe failure", async () => {
  const { read, useCases } = setup({ ...response, sessionToken: token });
  expect(await useCases.execute(request)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
  read.mockRejectedValueOnce(new Error("private infrastructure detail"));
  expect(await useCases.execute(request)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
});

test("session factory rejects an unavailable transaction capability before constructing the application", () => {
  for (const transactions of [
    null,
    {},
    { runInAdminSessionTransaction: null },
  ]) {
    expect(() =>
      createAdminSessionUseCases({ tokenPepper, transactions } as never),
    ).toThrow(TypeError);
  }
});
