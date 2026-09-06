/// <reference types="node" />
import {
  contentAuthoringCommandSchema,
  contentAuthoringSnapshotSchema,
  adminPrincipalSchema,
  sourceHashSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import {
  prepareContentAuthoring,
  computeContentAuthoringSnapshotHash,
} from "@fan-support/content";
export const translationTestId = (n: number) =>
  `72000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const translationTestPrincipal = adminPrincipalSchema.parse({
  schemaVersion: 1,
  actorId: translationTestId(1),
  sessionId: translationTestId(2),
  authorizedAt: "2026-09-07T00:00:00.000000Z",
  expiresAt: "2026-09-07T01:00:00.000000Z",
});
export const translationTestEnvelope = {
  schemaVersion: 1,
  requestId: translationTestId(9),
  sessionToken: Buffer.alloc(32, 6).toString("base64url"),
  csrfToken: Buffer.alloc(32, 7).toString("base64url"),
};
export function translationTestSnapshot() {
  const command = contentAuthoringCommandSchema.parse({
    schemaVersion: 1,
    action: "CREATE",
    target: { kind: "POLICY", policyKey: "test-terms" },
    expectedVersion: 0,
    reasonCode: "TEST_CREATE",
    idempotencyKey: "fixture-create-001",
    content: {
      kind: "POLICY",
      structure: { kind: "TERMS", effectiveAt: "2026-09-01T00:00:00.000000Z" },
      translations: SUPPORTED_LOCALES.map((locale) => ({
        locale,
        origin: "HUMAN",
        fields: {
          title: `Terms ${locale}`,
          summary: `Summary ${locale}`,
          body: `<p>Terms ${locale}</p>`,
        },
      })),
    },
  });
  if (command.action !== "CREATE") throw new Error("fixture");
  const plan = prepareContentAuthoring(command, null, {
    actorId: translationTestPrincipal.actorId,
    createdAt: translationTestPrincipal.authorizedAt,
  });
  const snapshot = contentAuthoringSnapshotSchema.parse({
    schemaVersion: 1,
    target: command.target,
    revisionId: translationTestId(10),
    revisionNumber: 1,
    headVersion: 1,
    lifecycle: { status: "DRAFT" },
    createdBy: translationTestPrincipal.actorId,
    createdAt: translationTestPrincipal.authorizedAt,
    contentHash: "0".repeat(64),
    content: plan.content,
    translationAudits: plan.translationAudits.map((row, n) => ({
      ...row,
      id: translationTestId(20 + n),
      reviewId: translationTestId(40 + n),
      reviewSequence: 1,
    })),
    extensions: {},
  });
  snapshot.contentHash = sourceHashSchema.parse(
    computeContentAuthoringSnapshotHash(snapshot),
  );
  return snapshot;
}
