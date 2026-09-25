import { expect, test } from "vitest";

const schemas = await import("./order-access.js").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
const proof = {
  schemaVersion: 1,
  tokenDigest: "a".repeat(64),
  pepperVersion: "v1",
};
const trace = { requestId: id, correlationId: id, taskName: "order-access" };

test("access authority contains bounded versioned digests and never raw credentials", () => {
  expect(schemas).toBeDefined();
  expect(
    schemas!.orderAccessExchangeCommandSchema.safeParse({
      schemaVersion: 1,
      tokenCandidates: [proof],
      sessionCredential: proof,
      sessionTtlSeconds: 3600,
      ...trace,
    }).success,
  ).toBe(true);
  for (const extra of [
    { token: "x".repeat(43) },
    { orderId: id },
    { paid: true },
  ]) {
    expect(
      schemas!.orderAccessExchangeCommandSchema.safeParse({
        schemaVersion: 1,
        tokenCandidates: [proof],
        sessionCredential: proof,
        sessionTtlSeconds: 3600,
        ...trace,
        ...extra,
      }).success,
    ).toBe(false);
  }
  expect(
    schemas!.orderAccessCandidatesSchema.safeParse([proof, proof]).success,
  ).toBe(false);
  expect(schemas!.orderAccessCandidatesSchema.safeParse([]).success).toBe(
    false,
  );
});

test("link request accepts only a canonical 32-byte base64url token", () => {
  expect(schemas).toBeDefined();
  expect(
    schemas!.orderAccessExchangeRequestSchema.safeParse({
      schemaVersion: 1,
      token: "A".repeat(43),
    }).success,
  ).toBe(true);
  for (const token of [
    "A".repeat(42),
    "A".repeat(44),
    "A".repeat(42) + "B",
    "x\n" + "A".repeat(41),
  ]) {
    expect(
      schemas!.orderAccessExchangeRequestSchema.safeParse({
        schemaVersion: 1,
        token,
      }).success,
    ).toBe(false);
  }
});

test("original-language provenance stays distinct from approved English fallback", () => {
  expect(schemas).toBeDefined();
  const locale = {
    schemaVersion: 1,
    mode: "DAILY",
    requestedLocale: "en",
    resolvedLocale: "zh-CN",
    sourceLocale: "zh-CN",
    fallbackUsed: true,
  };
  expect(schemas!.orderAccessLocaleSchema.safeParse(locale).success).toBe(true);
  expect(
    schemas!.orderAccessLocaleSchema.safeParse({
      ...locale,
      resolvedLocale: "en",
    }).success,
  ).toBe(false);
  expect(
    schemas!.orderAccessLocaleSchema.safeParse({ ...locale, mode: "APPROVED" })
      .success,
  ).toBe(false);
  expect(
    schemas!.orderAccessLocaleSchema.safeParse({
      schemaVersion: 1,
      mode: "APPROVED",
      requestedLocale: "ja",
      resolvedLocale: "en",
      fallbackUsed: true,
    }).success,
  ).toBe(true);
});

test("limits and grant results fail closed on contradictory values", () => {
  expect(schemas).toBeDefined();
  expect(
    schemas!.orderAccessRateResultSchema.safeParse({
      schemaVersion: 1,
      allowed: true,
      retryAfterSeconds: 0,
    }).success,
  ).toBe(true);
  expect(
    schemas!.orderAccessRateResultSchema.safeParse({
      schemaVersion: 1,
      allowed: false,
      retryAfterSeconds: 0,
    }).success,
  ).toBe(false);
  expect(
    schemas!.orderAccessGrantSchema.safeParse({
      schemaVersion: 1,
      publicOrderId: id,
      expiresAt: "2026-09-15T00:00:00Z",
      token: "secret",
    }).success,
  ).toBe(false);
});
