/// <reference types="node" />
import { describe, expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  type AdminContentFailure,
} from "@fan-support/contracts";
import type {
  PublicationPreflightRepositories,
  PublicationPreflightTransactionManager,
} from "@fan-support/persistence-port";
import { createPublicationPreflightUseCases } from "./publication-preflight.js";
import { digestAdminContentToken } from "./admin-content-tokens.js";
import { policyPreflightFixture } from "./publication-preflight-fixtures.js";

const id = (n: number) =>
  `89000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tokenPepper = "ac".repeat(32);
const sessionToken = Buffer.alloc(32, 3).toString("base64url");
const csrfToken = Buffer.alloc(32, 4).toString("base64url");
const request = {
  schemaVersion: 1,
  requestId: id(1),
  sessionToken,
  csrfToken,
  command: {
    schemaVersion: 1,
    target: {
      owner: { kind: "POLICY", policyKey: "privacy" },
      revisionId: id(2),
    },
    action: "PUBLISH",
  },
};
const failure = (code: AdminContentFailure["code"]): AdminContentFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
function harness() {
  const events: string[] = [];
  const authorize = vi.fn<
    PublicationPreflightRepositories["authorization"]["authorize"]
  >(async () => {
    events.push("authorize");
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal: {
        schemaVersion: 1,
        actorId: id(3),
        sessionId: id(4),
        authorizedAt: "2026-09-06T09:00:00.000789Z",
        expiresAt: "2026-09-06T10:00:00.000789Z",
      },
    };
  });
  const load = vi.fn<
    PublicationPreflightRepositories["publicationPreflight"]["load"]
  >(async () => {
    events.push("load");
    return failure("NOT_FOUND");
  });
  const run = vi.fn(async () => {
    events.push("transaction");
  });
  const transactions: PublicationPreflightTransactionManager = {
    async runInPublicationPreflightTransaction(work) {
      await run();
      return work({
        authorization: { authorize },
        publicationPreflight: { load },
      });
    },
  };
  return {
    events,
    authorize,
    load,
    run,
    transactions,
    useCases: createPublicationPreflightUseCases({ transactions, tokenPepper }),
  };
}

describe("authorized publication preflight", () => {
  test("returns the current canonical report without exposing the internal evidence or changing its input", async () => {
    const h = harness();
    const context = policyPreflightFixture();
    const before = structuredClone(context);
    h.load.mockResolvedValue({ schemaVersion: 1, outcome: "SUCCESS", context });
    const result = await h.useCases.execute({
      ...request,
      command: { ...request.command, target: context.target },
    });
    expect(result).toMatchObject({
      outcome: "SUCCESS",
      kind: "PUBLICATION_PREFLIGHT",
      target: context.target,
      headVersion: context.headVersion,
      contentHash: context.snapshot.contentHash,
      ready: true,
    });
    expect(result).not.toHaveProperty("snapshot");
    expect(result).not.toHaveProperty("approvals");
    expect(result).not.toHaveProperty("mediaLineage");
    expect(context).toEqual(before);
  });
  test("rejects a different canonical target or action rather than returning its readiness", async () => {
    const h = harness();
    const context = policyPreflightFixture();
    h.load.mockResolvedValue({ schemaVersion: 1, outcome: "SUCCESS", context });
    expect(
      await h.useCases.execute({
        ...request,
        command: {
          ...request.command,
          target: { ...context.target, revisionId: id(999) },
        },
      }),
    ).toEqual(failure("CONTENT_UNAVAILABLE"));
    expect(
      await h.useCases.execute({
        ...request,
        command: {
          ...request.command,
          target: context.target,
          action: "ROLLBACK",
        },
      }),
    ).toEqual(failure("CONTENT_UNAVAILABLE"));
  });
  test("authorizes all seven locales in the read transaction before loading content", async () => {
    const h = harness();
    expect(await h.useCases.execute(request)).toEqual(failure("NOT_FOUND"));
    expect(h.events).toEqual(["transaction", "authorize", "load"]);
    expect(h.authorize).toHaveBeenCalledWith({
      schemaVersion: 1,
      permission: "content.read",
      locales: [...SUPPORTED_LOCALES],
      sessionTokenDigest: digestAdminContentToken({
        tokenPepper,
        purpose: "admin-session",
        token: sessionToken,
      }),
      csrfTokenDigest: digestAdminContentToken({
        tokenPepper,
        purpose: "admin-csrf",
        token: csrfToken,
      }),
    });
    expect(h.load).toHaveBeenCalledWith(request.command);
    expect(JSON.stringify(h.authorize.mock.calls)).not.toContain(sessionToken);
  });
  test.each(["UNAUTHENTICATED", "FORBIDDEN", "CSRF_INVALID"] as const)(
    "%s never reads canonical data",
    async (code) => {
      const h = harness();
      h.authorize.mockResolvedValue(failure(code));
      expect(await h.useCases.execute(request)).toEqual(failure(code));
      expect(h.load).not.toHaveBeenCalled();
    },
  );
  test("each request checks current grants even when the command is repeated", async () => {
    const h = harness();
    expect(await h.useCases.execute(request)).toEqual(failure("NOT_FOUND"));
    h.authorize.mockResolvedValue(failure("FORBIDDEN"));
    expect(await h.useCases.execute(request)).toEqual(failure("FORBIDDEN"));
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.authorize).toHaveBeenCalledTimes(2);
  });
  test.each([
    { actorId: id(8) },
    { evaluatedAt: "2026-01-01T00:00:00Z" },
    { candidate: {} },
    { idempotencyKey: "unnecessary-command-key" },
  ])(
    "rejects client-controlled evidence and mutation fields before a transaction",
    async (extra) => {
      const h = harness();
      expect(
        await h.useCases.execute({
          ...request,
          command: { ...request.command, ...extra },
        }),
      ).toEqual(failure("INVALID_COMMAND"));
      expect(h.run).not.toHaveBeenCalled();
    },
  );
  test("malformed authorization and persistence responses are safe failures", async () => {
    const h = harness();
    h.authorize.mockResolvedValueOnce({
      outcome: "SUCCESS",
      principal: {},
    } as never);
    expect(await h.useCases.execute(request)).toEqual(
      failure("CONTENT_UNAVAILABLE"),
    );
    expect(h.load).not.toHaveBeenCalled();
    h.load.mockResolvedValueOnce({ outcome: "SUCCESS", context: {} } as never);
    expect(await h.useCases.execute(request)).toEqual(
      failure("CONTENT_UNAVAILABLE"),
    );
  });
  test("database errors never escape or expose adapter details", async () => {
    const h = harness();
    h.run.mockRejectedValueOnce(new Error("internal connection details"));
    expect(await h.useCases.execute(request)).toEqual(
      failure("CONTENT_UNAVAILABLE"),
    );
  });
  test("configuration is rejected before use", () => {
    const h = harness();
    expect(() =>
      createPublicationPreflightUseCases({
        transactions: h.transactions,
        tokenPepper: "weak",
      }),
    ).toThrow();
  });
});
