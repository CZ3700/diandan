import { expect, it } from "vitest";
import * as contracts from "./index.js";

const id = "10000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const command = {
  schemaVersion: 1,
  action: "PUBLISH",
  target: { owner: { kind: "IDOL", idolId: id }, revisionId: id },
  expectedVersion: 0,
  expectedContentHash: hash,
  reasonCode: "CONTENT_APPROVED",
  idempotencyKey: "publication-fixture",
};
it("exposes distinct versioned publication and durable purge boundaries", () => {
  for (const name of [
    "publicationRuntimeCommandSchema",
    "publicationRuntimeRequestSchema",
    "publicationRuntimeResponseSchema",
    "publicationAuthorizationCommandSchema",
    "publicationRuntimeContextResponseSchema",
    "publicationRuntimeWriteCommandSchema",
    "publicationPurgeJobSchema",
    "publicationPurgeClaimResponseSchema",
    "publicationPurgeRecordCommandSchema",
  ])
    expect(contracts).toHaveProperty(name);
});
it("requires head version, stable request hash and reason while rejecting client evidence", () => {
  const schema = contracts.publicationRuntimeCommandSchema;
  expect(schema.safeParse(command).success).toBe(true);
  for (const action of ["VALIDATE", "PUBLISH", "ROLLBACK"])
    expect(schema.safeParse({ ...command, action }).success).toBe(true);
  for (const extra of [
    { expectedVersion: -1 },
    { expectedVersion: 0.5 },
    { expectedContentHash: "" },
    { reasonCode: "" },
    { actorId: id },
    { manifest: {} },
    { evaluatedAt: "2026-09-06T00:00:00Z" },
    { ready: true },
    { publicationId: id },
  ])
    expect(schema.safeParse({ ...command, ...extra }).success).toBe(false);
});
it("separates read and retry commands and requires all seven publish locale grants", () => {
  const schema = contracts.publicationRuntimeCommandSchema;
  expect(
    schema.safeParse({ schemaVersion: 1, action: "STATUS", publicationId: id })
      .success,
  ).toBe(true);
  const retry = {
    schemaVersion: 1,
    action: "RETRY_PURGE",
    publicationId: id,
    purgeJobId: id,
    expectedVersion: 6,
    reasonCode: "CACHE_RETRY",
    idempotencyKey: "publication-retry",
  };
  expect(schema.safeParse(retry).success).toBe(true);
  expect(schema.safeParse({ ...retry, paths: ["/*"] }).success).toBe(false);
  const authorization = {
    schemaVersion: 1,
    permission: "content.publish",
    sessionTokenDigest: hash,
    csrfTokenDigest: hash,
    locales: ["en", "zh-CN", "th", "vi", "ja", "es", "pt"],
  };
  expect(
    contracts.publicationAuthorizationCommandSchema.safeParse(authorization)
      .success,
  ).toBe(true);
  expect(
    contracts.publicationAuthorizationCommandSchema.safeParse({
      ...authorization,
      locales: ["en"],
    }).success,
  ).toBe(false);
  expect(
    contracts.adminAuthorizationCommandSchema.safeParse(authorization).success,
  ).toBe(false);
});
