import {
  SUPPORTED_LOCALES,
  type AdminContentCommand,
  type ContentReviewContext,
  type ContentReviewTarget,
  type IdolAlias,
  type SupportedLocale,
} from "@fan-support/contracts";
import { rejectAdminContent } from "./admin-content-results.js";

export type ReviewCommand = Extract<
  AdminContentCommand,
  { action: "SUBMIT_REVIEW" | "APPROVE_REVIEW" }
>;

export function sameContentReviewTarget(
  left: ContentReviewTarget,
  right: ContentReviewTarget,
): boolean {
  return (
    left.kind === right.kind &&
    left.revisionId.toLowerCase() === right.revisionId.toLowerCase() &&
    (left.kind !== "GIFT_DETAILS" ||
      (right.kind === "GIFT_DETAILS" && left.locale === right.locale))
  );
}

export function orderedContentLocales(
  locales: readonly SupportedLocale[],
): SupportedLocale[] {
  return SUPPORTED_LOCALES.filter((locale) => locales.includes(locale));
}

export function aliasContentLocales(
  aliases: readonly IdolAlias[],
): SupportedLocale[] {
  if (aliases.length === 0 || aliases.some((alias) => alias.locale === null)) {
    return [...SUPPORTED_LOCALES];
  }
  return orderedContentLocales(
    aliases.flatMap((alias) => (alias.locale === null ? [] : [alias.locale])),
  );
}

export function validateContentReviewAction(
  command: ReviewCommand,
  context: ContentReviewContext,
  actorId: string,
): void {
  if (command.expectedVersion !== context.sequence) {
    rejectAdminContent("STALE_VERSION");
  }
  if (
    command.expectedContentHash !== context.contentHash ||
    command.expectedSourceHash !== context.sourceHash
  ) {
    rejectAdminContent("STALE_CONTENT");
  }
  const expectedStatus =
    command.action === "SUBMIT_REVIEW" ? "DRAFT" : "IN_REVIEW";
  if (context.status !== expectedStatus) {
    rejectAdminContent("INVALID_REVIEW_STATE");
  }
  const actor = actorId.toLowerCase();
  if (command.action === "SUBMIT_REVIEW") {
    if (context.editorId.toLowerCase() !== actor) {
      rejectAdminContent("FORBIDDEN");
    }
    return;
  }
  if (
    context.editorId.toLowerCase() === actor ||
    context.structureEditorId.toLowerCase() === actor
  ) {
    rejectAdminContent("SELF_REVIEW");
  }
}
