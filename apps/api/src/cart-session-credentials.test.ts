import { Buffer } from "node:buffer";
import { createHmac, randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import type {
  ComputeBlindIndexCommand,
  ComputeBlindIndexResponse,
} from "@fan-support/contracts";
import { createCartSessionCredentials } from "./cart-session-credentials.js";

const versions = ["current", "previous"];
function setup() {
  const calls: ComputeBlindIndexCommand[] = [];
  return {
    calls,
    options: {
      activePepperVersion: "current",
      pepperVersions: versions,
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
              digestBase64: createHmac("sha256", `TEST_${command.keyVersion}`)
                .update(command.purpose)
                .update(command.valueBase64)
                .digest("base64url"),
            },
          };
        },
      },
    },
  };
}

test("issues 256-bit opaque random credentials and purpose-separated versioned proofs", async () => {
  const { options, calls } = setup();
  const codec = createCartSessionCredentials(options);
  const first = await codec.issue();
  const second = await codec.issue();
  expect(Buffer.from(first.token, "base64url").length).toBe(32);
  expect(first.token).not.toBe(second.token);
  expect(first.accessCandidates.map((access) => access.pepperVersion)).toEqual(
    versions,
  );
  expect(JSON.stringify(first.accessCandidates)).not.toContain(first.token);
  expect(
    first.accessCandidates.every((access) =>
      /^[a-f0-9]{64}$/u.test(access.tokenDigest),
    ),
  ).toBe(true);
  expect(calls.map((call) => call.purpose)).toContain("CART_ACCESS_TOKEN");
  expect(calls.map((call) => call.purpose)).toContain("CSRF_TOKEN");
  expect(Buffer.from(first.csrfToken, "base64url").length).toBe(32);
  expect(
    first.accessCandidates.some(
      (a) =>
        a.tokenDigest ===
        Buffer.from(first.csrfToken, "base64url").toString("hex"),
    ),
  ).toBe(false);
});

test("retains previous CSRF proof after rotation but rejects a different session and malformed input", async () => {
  const { options } = setup();
  const previous = createCartSessionCredentials({
    ...options,
    activePepperVersion: "previous",
  });
  const issued = await previous.issue();
  const current = createCartSessionCredentials(options);
  const proof = await current.resolve(issued.token, issued.csrfToken);
  expect(proof.csrfValid).toBe(true);
  expect(
    (
      await current.resolve(
        randomBytes(32).toString("base64url"),
        issued.csrfToken,
      )
    ).csrfValid,
  ).toBe(false);
  expect((await current.resolve(issued.token, "bad")).csrfValid).toBe(false);
  await expect(current.resolve("A".repeat(42) + "B")).rejects.toThrow(
    "Invalid cart session token",
  );
});

test("fails closed for KMS errors or mismatched version without disclosing provider detail", async () => {
  const { options } = setup();
  for (const kind of ["throw", "version", "failure"] as const) {
    const codec = createCartSessionCredentials({
      ...options,
      keyManagement: {
        async computeBlindIndex(command) {
          if (kind === "throw") throw new Error("PRIVATE_PROVIDER_DIAGNOSTIC");
          const result = await options.keyManagement.computeBlindIndex(command);
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
          return result.outcome === "SUCCESS"
            ? { ...result, value: { ...result.value, keyVersion: "wrong" } }
            : result;
        },
      },
    });
    await expect(codec.issue()).rejects.toThrow(
      /^Cart session credentials unavailable$/u,
    );
  }
});

test("rejects unbounded, repeated or missing active key versions before KMS use", () => {
  const { options } = setup();
  for (const pepperVersions of [
    [],
    ["current", "current"],
    ["previous"],
    ["current", "1", "2", "3", "4"],
  ]) {
    expect(() =>
      createCartSessionCredentials({ ...options, pepperVersions }),
    ).toThrow("Invalid cart session key configuration");
  }
});
