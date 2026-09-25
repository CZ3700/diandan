import { expect, test } from "vitest";
import {
  adminSessionCommandSchema,
  adminSessionRequestSchema,
  adminSessionReadCommandSchema,
  adminSessionResponseSchema,
  adminSessionBootstrapResponseSchema,
} from "./admin-session.js";

const token = "a".repeat(42) + "A";
const session = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "ADMIN_SESSION",
  actorId: "10000000-0000-4000-8000-000000000001",
  permissions: ["content.read", "content.publish", "content.media.upload"],
  localeScopes: ["en", "ja"],
};

test("session discovery accepts no client identity or requested privilege", () => {
  const command = { schemaVersion: 1, action: "READ_SESSION" };
  expect(adminSessionCommandSchema.safeParse(command).success).toBe(true);
  expect(
    adminSessionCommandSchema.safeParse({
      ...command,
      actorId: session.actorId,
    }).success,
  ).toBe(false);
  expect(
    adminSessionRequestSchema.safeParse({
      schemaVersion: 1,
      requestId: session.actorId,
      sessionToken: token,
      csrfToken: token,
      command,
    }).success,
  ).toBe(true);
  expect(
    adminSessionReadCommandSchema.safeParse({
      schemaVersion: 1,
      sessionTokenDigest: "a".repeat(64),
      csrfTokenDigest: "b".repeat(64),
    }).success,
  ).toBe(true);
});

test("session context contains only the current known permission and locale sets", () => {
  expect(adminSessionResponseSchema.safeParse(session).success).toBe(true);
  expect(
    adminSessionResponseSchema.safeParse({
      ...session,
      permissions: [],
      localeScopes: [],
    }).success,
  ).toBe(true);
  for (const extra of [
    { sessionToken: token },
    { sessionId: session.actorId },
    { issuer: "private-issuer" },
    { email: "private@example.invalid" },
  ])
    expect(
      adminSessionResponseSchema.safeParse({ ...session, ...extra }).success,
    ).toBe(false);
  for (const change of [
    { permissions: ["content.read", "content.read"] },
    { permissions: ["payments.refund"] },
    { localeScopes: ["ja", "ja"] },
    { localeScopes: ["fr"] },
  ])
    expect(
      adminSessionResponseSchema.safeParse({ ...session, ...change }).success,
    ).toBe(false);
});

test("only the BFF bootstrap response may carry the CSRF token", () => {
  expect(
    adminSessionBootstrapResponseSchema.safeParse({
      ...session,
      csrfToken: token,
    }).success,
  ).toBe(true);
  expect(
    adminSessionBootstrapResponseSchema.safeParse({
      ...session,
      csrfToken: token,
      sessionToken: token,
    }).success,
  ).toBe(false);
  expect(adminSessionBootstrapResponseSchema.safeParse(session).success).toBe(
    false,
  );
  expect(
    adminSessionResponseSchema.safeParse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "UNAUTHENTICATED",
    }).success,
  ).toBe(true);
});
