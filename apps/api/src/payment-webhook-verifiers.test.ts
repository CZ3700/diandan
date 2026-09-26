import { expect, test, vi } from "vitest";

import { createPaymentWebhookVerifierDirectory } from "./payment-webhook-verifiers.js";

const endpointId = "20000000-0000-4000-8000-000000000002";
const verifier = { verifyPaymentWebhook: vi.fn() };
const command = {
  schemaVersion: 1,
  endpointId,
  receivedAt: "2026-09-26T00:00:00.000Z",
} as never;

function route() {
  return {
    receiver: { receive: vi.fn() },
    endpointPreflight: vi.fn(async () => ({
      schemaVersion: 1 as const,
      outcome: "ELIGIBLE" as const,
    })),
  };
}

test("an endpoint without deployed verification code is unavailable without a database preflight", async () => {
  const directory = createPaymentWebhookVerifierDirectory([]);
  const original = route();
  await expect(
    directory.gate(original).endpointPreflight(command),
  ).resolves.toEqual({ schemaVersion: 1, outcome: "UNAVAILABLE" });
  expect(original.endpointPreflight).not.toHaveBeenCalled();
  expect(
    directory.verifierForEndpoint("sandbox-gateway", endpointId),
  ).toBeUndefined();
});

test("a deployed endpoint still defers eligibility to PostgreSQL and only its own adapter may verify it", async () => {
  const directory = createPaymentWebhookVerifierDirectory([
    {
      adapterKey: "sandbox-gateway",
      endpointId,
      verifier,
      headerNames: ["webhook-signature", "webhook-id"],
    },
  ]);
  const original = route();
  const gated = directory.gate(original);
  expect(gated.receiver).toBe(original.receiver);
  // Only the declared signature headers reach the verifier, in a stable order.
  expect(gated.verificationHeaderNames).toEqual([
    "webhook-id",
    "webhook-signature",
  ]);
  await expect(gated.endpointPreflight(command)).resolves.toEqual({
    schemaVersion: 1,
    outcome: "ELIGIBLE",
  });
  expect(original.endpointPreflight).toHaveBeenCalledWith(command);
  expect(directory.verifierForEndpoint("sandbox-gateway", endpointId)).toBe(
    verifier,
  );
  expect(
    directory.verifierForEndpoint("other-gateway", endpointId),
  ).toBeUndefined();
});

test("duplicate, malformed or incomplete verifier registrations stop startup", () => {
  for (const registrations of [
    [
      { adapterKey: "a", endpointId, verifier, headerNames: ["x-sig"] },
      { adapterKey: "b", endpointId, verifier, headerNames: ["x-sig"] },
    ],
    [
      {
        adapterKey: "a",
        endpointId: "not-a-uuid",
        verifier,
        headerNames: ["x-sig"],
      },
    ],
    [{ adapterKey: "a", endpointId, verifier: {}, headerNames: ["x-sig"] }],
    [{ adapterKey: "a", endpointId, verifier, headerNames: [] }],
  ])
    expect(() =>
      createPaymentWebhookVerifierDirectory(registrations as never),
    ).toThrow();
});
