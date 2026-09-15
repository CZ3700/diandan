import { Buffer } from "node:buffer";
import { createHmac, randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import type {
  ComputeBlindIndexCommand,
  ComputeBlindIndexResponse,
} from "@fan-support/contracts";
import {
  createOrderAccessCredentials,
  isOrderAccessCredential,
} from "./order-access-credentials.js";

function setup() {
  const calls: ComputeBlindIndexCommand[] = [];
  const options = {
    activePepperVersion: "current",
    pepperVersions: ["current", "previous"],
    keyManagement: {
      async computeBlindIndex(
        command: ComputeBlindIndexCommand,
      ): Promise<ComputeBlindIndexResponse> {
        calls.push(command);
        return {
          schemaVersion: 1,
          operation: "COMPUTE_BLIND_INDEX",
          outcome: "SUCCESS",
          value: {
            algorithm: "HMAC_SHA_256",
            keyVersion: command.keyVersion!,
            digestBase64: createHmac(
              "sha256",
              `TEST_ORDER_${command.keyVersion}`,
            )
              .update(command.purpose)
              .update(command.valueBase64)
              .digest("base64url"),
          },
        };
      },
    },
  };
  return { calls, options };
}

test("issues independent canonical 256-bit link and session secrets with distinct keyed scopes", async () => {
  const { options, calls } = setup();
  const codec = createOrderAccessCredentials(options);
  const link = await codec.issueLink();
  const session = await codec.issueSession();
  expect(isOrderAccessCredential(link.token)).toBe(true);
  expect(Buffer.from(link.token, "base64url")).toHaveLength(32);
  expect(session.token).not.toBe(link.token);
  const linkProofs = await codec.resolveLink(link.token);
  const sessionProofs = await codec.resolveSession(link.token);
  expect(linkProofs.map((proof) => proof.pepperVersion)).toEqual([
    "current",
    "previous",
  ]);
  expect(linkProofs[0]).toEqual(link.access);
  expect(session.access).toEqual(
    (await codec.resolveSession(session.token)).accesses[0],
  );
  expect(linkProofs[0]!.tokenDigest).not.toBe(
    sessionProofs.accesses[0]!.tokenDigest,
  );
  expect(calls.every((call) => call.purpose === "ORDER_ACCESS_TOKEN")).toBe(
    true,
  );
  const inputs = calls.map((call) =>
    Buffer.from(call.valueBase64, "base64url").toString("utf8"),
  );
  expect(inputs).toContain(`ORDER_LINK_V1\u0000${link.token}`);
  expect(inputs).toContain(`ORDER_SESSION_V1\u0000${link.token}`);
  expect(JSON.stringify(link.access)).not.toContain(link.token);
  expect(
    linkProofs.every((proof) => /^[a-f0-9]{64}$/u.test(proof.tokenDigest)),
  ).toBe(true);
});

test("binds CSRF to the session across pepper rotation without accepting another credential", async () => {
  const { options } = setup();
  const previous = createOrderAccessCredentials({
    ...options,
    activePepperVersion: "previous",
  });
  const current = createOrderAccessCredentials(options);
  const session = await previous.issueSession();
  expect(
    (await current.resolveSession(session.token, session.csrfToken)).csrfValid,
  ).toBe(true);
  expect(
    (
      await current.resolveSession(
        randomBytes(32).toString("base64url"),
        session.csrfToken,
      )
    ).csrfValid,
  ).toBe(false);
  expect(
    (await current.resolveSession(session.token, "invalid")).csrfValid,
  ).toBe(false);
  expect(Buffer.from(session.csrfToken, "base64url")).toHaveLength(32);
  expect(Buffer.from(session.csrfToken, "base64url").toString("hex")).not.toBe(
    session.access.tokenDigest,
  );
});

test("rate bucket uses its own scope and only current pepper without returning raw network identity", async () => {
  const { options, calls } = setup();
  const codec = createOrderAccessCredentials(options);
  const bucket = await codec.rateLimitAccess("127.0.0.1");
  expect(bucket).toEqual({
    schemaVersion: 1,
    tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    pepperVersion: "current",
  });
  expect(calls).toHaveLength(1);
  expect(Buffer.from(calls[0]!.valueBase64, "base64url").toString("utf8")).toBe(
    "ORDER_RATE_LIMIT_V1\u0000127.0.0.1",
  );
  expect(JSON.stringify(bucket)).not.toContain("127.0.0.1");
});

test("rejects malformed credential, invalid network identity, and invalid key versions before KMS", async () => {
  const { options, calls } = setup();
  const codec = createOrderAccessCredentials(options);
  for (const token of [
    "A".repeat(42) + "B",
    "A".repeat(42),
    "A".repeat(44),
    "A".repeat(43) + "=",
    "",
  ])
    await expect(codec.resolveLink(token)).rejects.toThrow(
      "Invalid order access credential",
    );
  for (const ip of ["", "127.0.0.1\u0000ignored", "X".repeat(65)])
    await expect(codec.rateLimitAccess(ip)).rejects.toThrow(
      "Invalid order access network identity",
    );
  expect(calls).toHaveLength(0);
  for (const pepperVersions of [
    [],
    ["current", "current"],
    ["previous"],
    ["current", "v1", "v2", "v3", "v4"],
  ])
    expect(() =>
      createOrderAccessCredentials({ ...options, pepperVersions }),
    ).toThrow("Invalid order access key configuration");
});

test("fails closed on failed or mismatched KMS responses without private diagnostics", async () => {
  const { options } = setup();
  for (const kind of ["throw", "version", "failure"] as const) {
    const codec = createOrderAccessCredentials({
      ...options,
      keyManagement: {
        async computeBlindIndex(command) {
          if (kind === "throw") throw new Error("PRIVATE_ORDER_KMS_DIAGNOSTIC");
          if (kind === "failure")
            return {
              schemaVersion: 1,
              operation: "COMPUTE_BLIND_INDEX",
              outcome: "FAILURE",
              error: {
                schemaVersion: 1,
                code: "TEMPORARY_UNAVAILABLE",
                recovery: "RETRY_SAME_COMMAND",
              },
            };
          const result = await options.keyManagement.computeBlindIndex(command);
          return result.outcome === "SUCCESS"
            ? { ...result, value: { ...result.value, keyVersion: "unknown" } }
            : result;
        },
      },
    });
    await expect(codec.issueSession()).rejects.toThrow(
      /^Order access credentials unavailable$/u,
    );
  }
});
