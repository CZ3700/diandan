import {
  adminAuthorizationCommandSchema,
  adminAuthorizationResponseSchema,
  contentAuthoringCommandSchema,
  contentAuthoringReadResponseSchema,
  DEFAULT_LOCALE,
  type AdminPrincipal,
  type GiftCommerceAccessContextCommand,
  type GiftCommerceRequest,
  type ContentAuthoringContent,
  type ContentAuthoringSnapshot,
  type ContentAuthoringPlan,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  computeContentAuthoringSnapshotHash,
  computeTranslationContentHash,
  prepareContentAuthoring,
} from "@fan-support/content";
import type { GiftCommerceRepositories } from "@fan-support/persistence-port";
import { orderedContentLocales } from "./admin-content-review-validation.js";
import {
  rejectCommerce,
  requireCommerceSuccess,
  requireSameCommercePrincipal,
  sameCommerceId,
} from "./gift-commerce-results.js";

function detailLocales(content: ContentAuthoringContent): SupportedLocale[] {
  return content.kind === "GIFT"
    ? (content.details?.translations.map((row) => row.locale) ?? [])
    : [];
}
function allLocales(content: ContentAuthoringContent) {
  return orderedContentLocales([
    ...content.translations.map((row) => row.locale),
    ...detailLocales(content),
  ]);
}
function structureHash(content: ContentAuthoringContent) {
  return computeTranslationContentHash("content-authoring-structure-scope-v1", {
    kind: content.kind,
    structure: content.structure,
    ...("media" in content ? { media: content.media } : {}),
  });
}
function copyLocales(
  source: ContentAuthoringSnapshot,
  plan: ContentAuthoringPlan,
  changedLocales: SupportedLocale[],
) {
  const englishBefore = source.translationAudits.find(
    (row) => row.locale === DEFAULT_LOCALE,
  )?.sourceHash;
  const englishAfter = plan.translationAudits.find(
    (row) => row.locale === DEFAULT_LOCALE,
  )?.sourceHash;
  const allBase =
    englishBefore !== englishAfter ||
    structureHash(source.content) !== structureHash(plan.content);
  // Copying even unchanged details creates new authorship/review; replacing them also removes the old locales.
  return orderedContentLocales([
    ...(allBase
      ? [
          ...source.content.translations.map((row) => row.locale),
          ...plan.content.translations.map((row) => row.locale),
        ]
      : changedLocales),
    ...detailLocales(source.content),
    ...detailLocales(plan.content),
  ]);
}
export async function authorizeGiftContent(
  repositories: GiftCommerceRepositories,
  request: GiftCommerceRequest,
  authorization: GiftCommerceAccessContextCommand,
  prior: AdminPrincipal,
): Promise<AdminPrincipal> {
  if (request.command.action !== "SAVE_GIFT_CONTENT")
    rejectCommerce("INVALID_COMMAND");
  const outer = request.command;
  const command = contentAuthoringCommandSchema.parse({
    ...outer.authoring,
    reasonCode: outer.reasonCode,
    idempotencyKey: outer.idempotencyKey,
  });
  if (command.action !== "CREATE" && command.action !== "COPY")
    rejectCommerce("INVALID_COMMAND");
  async function authorize(locales: SupportedLocale[]) {
    return requireSameCommercePrincipal(
      requireCommerceSuccess(
        adminAuthorizationResponseSchema.parse(
          await repositories.contentAuthorization.authorize(
            adminAuthorizationCommandSchema.parse({
              ...authorization,
              permission: "content.edit",
              locales,
            }),
          ),
        ),
      ).principal,
      prior,
    );
  }
  const principal = await authorize(
    command.action === "CREATE" ? allLocales(command.content) : [],
  );
  let source: ContentAuthoringSnapshot | null = null;
  if (command.action === "COPY") {
    const response = requireCommerceSuccess(
      contentAuthoringReadResponseSchema.parse(
        await repositories.contentAuthoring.read({
          schemaVersion: 1,
          action: "READ",
          target: command.target,
          revisionId: command.sourceRevisionId,
        }),
      ),
    );
    source = response.snapshot;
    if (
      source.target.kind !== "GIFT" ||
      command.target.kind !== "GIFT" ||
      !sameCommerceId(source.target.giftId, command.target.giftId) ||
      !sameCommerceId(source.revisionId, command.sourceRevisionId) ||
      computeContentAuthoringSnapshotHash(source) !== source.contentHash
    )
      rejectCommerce("COMMERCE_UNAVAILABLE");
  }
  let plan: ContentAuthoringPlan;
  try {
    // A historical replay still authorizes against canonical current scope. The unchanged submitted hash is validated by the write repository for new commands.
    plan = prepareContentAuthoring(
      command.action === "COPY" && source
        ? { ...command, expectedSourceHash: source.contentHash }
        : command,
      source,
      { actorId: principal.actorId, createdAt: principal.authorizedAt },
    );
  } catch {
    return rejectCommerce("INVALID_COMMAND");
  }
  if (command.action === "CREATE") return principal;
  if (!source) return rejectCommerce("COMMERCE_UNAVAILABLE");
  return authorize(
    copyLocales(
      source,
      plan,
      command.changes.translations?.map((row) => row.locale) ?? [],
    ),
  );
}
