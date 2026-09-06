import {
  adminAuthorizationCommandSchema,
  adminAuthorizationResponseSchema,
  adminMutationResponseSchema,
  contentAuthoringReadResponseSchema,
  contentAuthoringRequestSchema,
  contentAuthoringResponseSchema,
  contentAuthoringWriteCommandSchema,
  DEFAULT_LOCALE,
  type AdminAuthorizationCommand,
  type AdminPrincipal,
  type ContentAuthoringContent,
  type ContentAuthoringPlan,
  type ContentAuthoringRequest,
  type ContentAuthoringResponse,
  type ContentAuthoringSnapshot,
  type ContentAuthoringTarget,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  computeContentAuthoringSnapshotHash,
  computeTranslationContentHash,
  prepareContentAuthoring,
} from "@fan-support/content";
import type {
  ContentAuthoringRepositories,
  ContentAuthoringTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import {
  beginContentAuthoringIdempotency,
  completeContentAuthoringIdempotency,
} from "./content-authoring-idempotency.js";
import {
  adminContentErrorResult,
  adminContentFailure,
  rejectAdminContent,
  requireAdminSuccess,
} from "./admin-content-results.js";
import {
  aliasContentLocales,
  orderedContentLocales,
} from "./admin-content-review-validation.js";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";

export type ContentAuthoringDependencies = Readonly<{
  transactions: ContentAuthoringTransactionManager;
  tokenPepper: string;
}>;
export type ContentAuthoringUseCases = Readonly<{
  execute(input: unknown): Promise<ContentAuthoringResponse>;
}>;
type Authorization = Omit<AdminAuthorizationCommand, "permission" | "locales">;

function sameTarget(
  left: ContentAuthoringTarget,
  right: ContentAuthoringTarget,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "IDOL":
      return (
        right.kind === "IDOL" &&
        left.idolId.toLowerCase() === right.idolId.toLowerCase()
      );
    case "GIFT":
      return (
        right.kind === "GIFT" &&
        left.giftId.toLowerCase() === right.giftId.toLowerCase()
      );
    case "HOMEPAGE":
      return true;
    case "POLICY":
      return right.kind === "POLICY" && left.policyKey === right.policyKey;
    case "MEDIA_METADATA":
      return (
        right.kind === "MEDIA_METADATA" &&
        left.mediaAssetId.toLowerCase() === right.mediaAssetId.toLowerCase()
      );
  }
}
function extensionLocales(content: ContentAuthoringContent): SupportedLocale[] {
  if (content.kind === "IDOL" && content.aliases !== undefined)
    return aliasContentLocales(content.aliases);
  if (content.kind === "GIFT" && content.details !== undefined)
    return orderedContentLocales(
      content.details.translations.map((row) => row.locale),
    );
  return [];
}
function allLocales(content: ContentAuthoringContent): SupportedLocale[] {
  return orderedContentLocales([
    ...content.translations.map((row) => row.locale),
    ...extensionLocales(content),
  ]);
}
function structuralHash(content: ContentAuthoringContent): string {
  return computeTranslationContentHash("content-authoring-structure-scope-v1", {
    kind: content.kind,
    structure: content.structure,
    ...("media" in content ? { media: content.media } : {}),
  });
}
function copyLocales(
  command: Extract<ContentAuthoringRequest["command"], { action: "COPY" }>,
  source: ContentAuthoringSnapshot,
  plan: ContentAuthoringPlan,
): SupportedLocale[] {
  const englishBefore = source.translationAudits.find(
    (row) => row.locale === DEFAULT_LOCALE,
  )!.sourceHash;
  const englishAfter = plan.translationAudits.find(
    (row) => row.locale === DEFAULT_LOCALE,
  )!.sourceHash;
  const allBase =
    englishBefore !== englishAfter ||
    structuralHash(source.content) !== structuralHash(plan.content);
  // Every copied extension starts with a new author and review, including verbatim copies.
  // Include the old scope too: replacing a multilingual extension also removes content.
  return orderedContentLocales([
    ...(allBase
      ? [
          ...source.content.translations.map((row) => row.locale),
          ...plan.content.translations.map((row) => row.locale),
        ]
      : (command.changes.translations?.map((row) => row.locale) ?? [])),
    ...extensionLocales(source.content),
    ...extensionLocales(plan.content),
  ]);
}
async function authorize(
  repositories: ContentAuthoringRepositories,
  authorization: Authorization,
  permission: "content.read" | "content.edit",
  locales: SupportedLocale[],
  prior?: AdminPrincipal,
): Promise<AdminPrincipal> {
  const response = requireAdminSuccess(
    adminAuthorizationResponseSchema.parse(
      await repositories.authorization.authorize(
        adminAuthorizationCommandSchema.parse({
          ...authorization,
          permission,
          locales: orderedContentLocales(locales),
        }),
      ),
    ),
  );
  const principal = response.principal;
  if (
    prior !== undefined &&
    (prior.actorId.toLowerCase() !== principal.actorId.toLowerCase() ||
      prior.sessionId.toLowerCase() !== principal.sessionId.toLowerCase() ||
      prior.expiresAt !== principal.expiresAt)
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  // Canonical wall time can move backward; each authorization independently checks expiry.
  if (Date.parse(principal.expiresAt) <= Date.parse(principal.authorizedAt))
    rejectAdminContent("UNAUTHENTICATED");
  return principal;
}
async function loadSnapshot(
  repositories: ContentAuthoringRepositories,
  target: ContentAuthoringTarget,
  revisionId: string,
): Promise<ContentAuthoringSnapshot> {
  const response = requireAdminSuccess(
    contentAuthoringReadResponseSchema.parse(
      await repositories.contentAuthoring.read({
        schemaVersion: 1,
        action: "READ",
        target,
        revisionId,
      }),
    ),
  );
  const snapshot = response.snapshot;
  if (
    !sameTarget(snapshot.target, target) ||
    snapshot.revisionId.toLowerCase() !== revisionId.toLowerCase() ||
    computeContentAuthoringSnapshotHash(snapshot) !== snapshot.contentHash
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  return snapshot;
}
function prepare(
  command: Extract<
    ContentAuthoringRequest["command"],
    { action: "CREATE" | "COPY" }
  >,
  source: ContentAuthoringSnapshot | null,
  principal: AdminPrincipal,
): ContentAuthoringPlan {
  try {
    return prepareContentAuthoring(command, source, {
      actorId: principal.actorId,
      createdAt: principal.authorizedAt,
    });
  } catch {
    return rejectAdminContent("INVALID_COMMAND");
  }
}
async function runCommand(
  repositories: ContentAuthoringRepositories,
  request: ContentAuthoringRequest,
  authorization: Authorization,
): Promise<ContentAuthoringResponse> {
  const { command } = request;
  const permission =
    command.action === "READ" ? "content.read" : "content.edit";
  let principal = await authorize(
    repositories,
    authorization,
    permission,
    command.action === "CREATE" ? allLocales(command.content) : [],
  );
  if (command.action === "READ") {
    const snapshot = await loadSnapshot(
      repositories,
      command.target,
      command.revisionId,
    );
    await authorize(
      repositories,
      authorization,
      permission,
      allLocales(snapshot.content),
      principal,
    );
    return { schemaVersion: 1, outcome: "SUCCESS", kind: "REVISION", snapshot };
  }
  let source: ContentAuthoringSnapshot | null = null;
  if (command.action === "CREATE") prepare(command, null, principal);
  else {
    source = await loadSnapshot(
      repositories,
      command.target,
      command.sourceRevisionId,
    );
    // Review events can advance after a successful request. Derive current authorization
    // from the canonical source before replay; validate the client's old snapshot only
    // for a new operation. The original command is always passed unchanged to the write.
    const plan = prepare(
      { ...command, expectedSourceHash: source.contentHash },
      source,
      principal,
    );
    principal = await authorize(
      repositories,
      authorization,
      permission,
      copyLocales(command, source, plan),
      principal,
    );
  }
  const reservation = await beginContentAuthoringIdempotency(
    repositories.idempotency,
    command,
    principal,
  );
  if (reservation.replay !== undefined) return reservation.replay;
  if (command.action === "COPY") {
    if (source === null) rejectAdminContent("CONTENT_UNAVAILABLE");
    if (command.expectedSourceHash !== source.contentHash)
      rejectAdminContent("STALE_CONTENT");
    if (command.expectedVersion !== source.headVersion)
      rejectAdminContent("STALE_VERSION");
  }
  const written = requireAdminSuccess(
    adminMutationResponseSchema.parse(
      await repositories.contentAuthoring.write(
        contentAuthoringWriteCommandSchema.parse({
          schemaVersion: 1,
          command,
          actorId: principal.actorId,
          requestId: request.requestId,
        }),
      ),
    ),
  );
  if (written.replayed) rejectAdminContent("CONTENT_UNAVAILABLE");
  return completeContentAuthoringIdempotency(
    repositories.idempotency,
    reservation,
    written.resultId,
  );
}
export function createContentAuthoringUseCases(
  dependencies: ContentAuthoringDependencies,
): ContentAuthoringUseCases {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown): Promise<ContentAuthoringResponse> {
      const parsed = contentAuthoringRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data;
      const authorization = adminAuthorizationCommandSchema
        .omit({ permission: true, locales: true })
        .parse({
          schemaVersion: 1,
          sessionTokenDigest: digestAdminContentToken({
            tokenPepper: dependencies.tokenPepper,
            purpose: "admin-session",
            token: request.sessionToken,
          }),
          csrfTokenDigest: digestAdminContentToken({
            tokenPepper: dependencies.tokenPepper,
            purpose: "admin-csrf",
            token: request.csrfToken,
          }),
        });
      try {
        const result =
          await dependencies.transactions.runInContentAuthoringTransaction(
            async (repositories) =>
              JSON.parse(
                JSON.stringify(
                  contentAuthoringResponseSchema.parse(
                    await runCommand(repositories, request, authorization),
                  ),
                ),
              ) as JsonValue,
          );
        return contentAuthoringResponseSchema.parse(result);
      } catch (error: unknown) {
        return adminContentErrorResult(error);
      }
    },
  });
}
