import type { PolicyState } from "./api";
import type { PolicyDraft, PolicyTranslation } from "./model";
export type PolicyEditBuffer = { state: PolicyState; draft: PolicyDraft };
const merge = (base: PolicyTranslation[], overrides: PolicyTranslation[]) => [
  ...new Map([...base, ...overrides].map((row) => [row.locale, row])).values(),
];
/** A language switch can reuse local edits only against the exact same saved authority. */
export function continuePolicyDraft(
  previous: PolicyEditBuffer,
  next: PolicyState,
): { state: PolicyState; draft: PolicyDraft | null; conflict: boolean } {
  const prior = previous.state.workspace,
    current = next.workspace;
  if (
    JSON.stringify(previous.state.owner.target) !==
    JSON.stringify(next.owner.target)
  )
    return { state: next, draft: next.draft, conflict: false };
  if (
    !next.draft ||
    !previous.state.draft ||
    previous.state.owner.authoringVersion !== next.owner.authoringVersion ||
    Boolean(prior) !== Boolean(current) ||
    (prior &&
      current &&
      (prior.target.revisionId.toLowerCase() !==
        current.target.revisionId.toLowerCase() ||
        prior.contentHash !== current.contentHash ||
        prior.authoringHeadVersion !== current.authoringHeadVersion))
  )
    return { state: next, draft: previous.draft, conflict: true };
  const kind = next.draft.kind ?? previous.state.draft.kind;
  const effectiveAt =
    next.draft.effectiveAt || previous.state.draft.effectiveAt;
  return {
    state: {
      ...next,
      draft: {
        ...next.draft,
        kind,
        effectiveAt,
        translations: merge(
          previous.state.draft.translations,
          next.draft.translations,
        ),
      },
    },
    draft: {
      ...previous.draft,
      kind: previous.draft.kind ?? kind,
      effectiveAt:
        previous.state.draft.effectiveAt === "" &&
        previous.draft.effectiveAt === ""
          ? effectiveAt
          : previous.draft.effectiveAt,
      translations: merge(next.draft.translations, previous.draft.translations),
    },
    conflict: false,
  };
}
