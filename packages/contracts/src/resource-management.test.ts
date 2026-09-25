import { describe, expect, it } from "vitest";
import {
  adminResourceCommandSchema,
  mediaSourceInspectionResponseSchema,
} from "./resource-management.js";
const base = {
  schemaVersion: 1,
  action: "BEGIN_UPLOAD",
  checksumSha256: "a".repeat(64),
  byteSize: 128,
  mimeType: "image/png",
  rightsReference: "evidence-ref:v1:fixture",
  expectedVersion: 0,
  idempotencyKey: "resource-test-0001",
  reasonCode: "MEDIA_UPLOAD",
};
describe("resource management trust boundaries", () => {
  it("accepts only bounded upload identity without client authority", () => {
    expect(adminResourceCommandSchema.safeParse(base).success).toBe(true);
    for (const field of [
      "objectKey",
      "assetId",
      "actorId",
      "sessionId",
      "width",
      "height",
      "receipt",
      "rightsStatus",
      "url",
    ])
      expect(
        adminResourceCommandSchema.safeParse({ ...base, [field]: "injected" })
          .success,
      ).toBe(false);
    expect(
      adminResourceCommandSchema.safeParse({
        ...base,
        byteSize: 25 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
    expect(
      adminResourceCommandSchema.safeParse({
        ...base,
        mimeType: "image/svg+xml",
      }).success,
    ).toBe(false);
  });
  it("requires the policy kind and creation version", () => {
    const command = {
      schemaVersion: 1,
      action: "REGISTER_POLICY",
      policyKey: "refund-policy",
      kind: "REFUND",
      expectedVersion: 0,
      idempotencyKey: "resource-policy-0001",
      reasonCode: "POLICY_REGISTER",
    };
    expect(adminResourceCommandSchema.safeParse(command).success).toBe(true);
    expect(
      adminResourceCommandSchema.safeParse({
        ...command,
        policyKey: "1-policy",
      }).success,
    ).toBe(false);
    expect(
      adminResourceCommandSchema.safeParse({ ...command, kind: "ARBITRARY" })
        .success,
    ).toBe(false);
    expect(
      adminResourceCommandSchema.safeParse({ ...command, expectedVersion: 1 })
        .success,
    ).toBe(false);
  });
  it("bounds trusted inspection receipts by actual pixels and encoded dimensions", () => {
    const result = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      receipt: {
        schemaVersion: 1,
        profileVersion: 1,
        source: {
          objectKey: "uploads/v1/test.png",
          checksumSha256: "a".repeat(64),
          byteSize: 128,
          mimeType: "image/png",
        },
        width: 640,
        height: 480,
        orientation: 1,
      },
    };
    expect(mediaSourceInspectionResponseSchema.safeParse(result).success).toBe(
      true,
    );
    expect(
      mediaSourceInspectionResponseSchema.safeParse({
        ...result,
        receipt: { ...result.receipt, width: 10000, height: 10000 },
      }).success,
    ).toBe(false);
    expect(
      mediaSourceInspectionResponseSchema.safeParse({
        ...result,
        receipt: { ...result.receipt, orientation: 9 },
      }).success,
    ).toBe(false);
  });
});
