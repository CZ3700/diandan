import { describe, expect, it } from "vitest";
import * as contracts from "./media-processing.js";

const source = {
  assetId: "11111111-1111-4111-8111-111111111111",
  metadataRevisionId: "22222222-2222-4222-8222-222222222222",
  checksumSha256: "a".repeat(64),
  objectKey: "originals/source.jpg",
  mimeType: "image/jpeg",
  byteSize: 1024,
  width: 3000,
  height: 4000,
};
const command = {
  schemaVersion: 1,
  profileVersion: 1,
  source,
  role: "PORTRAIT",
  fit: "COVER",
  focalPoint: { x: 0.5, y: 0.5 },
};

describe("media processing contracts", () => {
  it("requires a bounded versioned source identity and configured processing profile", () => {
    expect(
      contracts.mediaImageProcessingCommandSchema?.safeParse(command).success,
    ).toBe(true);
    for (const value of [
      { ...command, schemaVersion: undefined },
      { ...command, profileVersion: 2 },
      { ...command, source: { ...source, byteSize: 26_214_401 } },
      { ...command, source: { ...source, width: 0 } },
      { ...command, source: { ...source, objectKey: "../escape.jpg" } },
      { ...command, signedUrl: "https://invalid.example/token" },
    ])
      expect(
        contracts.mediaImageProcessingCommandSchema.safeParse(value).success,
      ).toBe(false);
  });
  it("allows transient retries only for explicit infrastructure failures", () => {
    for (const code of [
      "STORAGE_UNAVAILABLE",
      "PROCESSING_TIMEOUT",
      "UNEXPECTED_PROCESSING_FAILURE",
    ]) {
      expect(
        contracts.mediaImageProcessingResultSchema.safeParse({
          schemaVersion: 1,
          outcome: "FAILURE",
          error: { code, retryable: true },
        }).success,
      ).toBe(true);
    }
    expect(
      contracts.mediaImageProcessingResultSchema.safeParse({
        schemaVersion: 1,
        outcome: "FAILURE",
        error: { code: "INVALID_IMAGE", retryable: true },
      }).success,
    ).toBe(false);
    expect(
      contracts.mediaImageProcessingResultSchema.safeParse({
        schemaVersion: 1,
        outcome: "FAILURE",
        error: {
          code: "INVALID_IMAGE",
          retryable: false,
          detail: "raw decoder exception",
        },
      }).success,
    ).toBe(false);
  });
  it("requires identity, reason and finite leases at the persistence boundary", () => {
    const input = {
      schemaVersion: 1,
      jobId: "33333333-3333-4333-8333-333333333333",
      sourceAssetId: source.assetId,
      metadataRevisionId: source.metadataRevisionId,
      role: "PORTRAIT",
      fit: "COVER",
      requestedBy: "44444444-4444-4444-8444-444444444444",
      reason: "Prepare portrait master",
    };
    expect(
      contracts.mediaProcessingEnqueueCommandSchema.safeParse(input).success,
    ).toBe(true);
    expect(
      contracts.mediaProcessingEnqueueCommandSchema.safeParse({
        ...input,
        reason: "",
      }).success,
    ).toBe(false);
    expect(
      contracts.mediaProcessingClaimCommandSchema.safeParse({
        schemaVersion: 1,
        leaseToken: input.jobId,
        leaseSeconds: 900,
      }).success,
    ).toBe(true);
    expect(
      contracts.mediaProcessingClaimCommandSchema.safeParse({
        schemaVersion: 1,
        leaseToken: input.jobId,
        leaseSeconds: 3601,
      }).success,
    ).toBe(false);
  });
});
