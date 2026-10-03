import { expect, test } from "vitest";
import { policyFixture, owner, fields } from "./fixture";
import type { PolicyState } from "./api";
import type { PolicyDraft } from "./model";
import { policyChanges } from "./model";
const subject = await import("./draft-session").catch(() => undefined);
test("switching language keeps unsaved text only while the canonical revision and hash are unchanged", () => {
  expect(subject?.continuePolicyDraft).toBeTypeOf("function");
  const workspace = policyFixture();
  if (workspace.outcome !== "SUCCESS") throw new Error("fixture");
  const draft = {
    kind: "DELIVERY" as const,
    effectiveAt: "2027-01-01T00:00:00Z",
    translations: [
      { locale: "en" as const, origin: "MACHINE" as const, fields },
    ],
  };
  const state = { owner, workspace, draft };
  const edited = {
    ...draft,
    translations: [
      {
        ...draft.translations[0]!,
        fields: { ...fields, title: "Edited English" },
      },
    ],
  };
  const next = {
    ...state,
    workspace: {
      ...workspace,
      target: { ...workspace.target, locale: "ja" as const },
    },
    draft: {
      ...draft,
      translations: [
        {
          locale: "ja" as const,
          origin: "MACHINE" as const,
          fields: { ...fields, title: "日本語" },
        },
      ],
    },
  };
  const continued = subject!.continuePolicyDraft(
    { state, draft: edited },
    next,
  );
  expect(continued.conflict).toBe(false);
  expect(
    continued.draft?.translations.find((row) => row.locale === "en")?.fields
      .title,
  ).toBe("Edited English");
  expect(
    continued.draft?.translations.find((row) => row.locale === "ja")?.fields
      .title,
  ).toBe("日本語");
  const conflict = subject!.continuePolicyDraft(
    { state, draft: edited },
    {
      ...next,
      workspace: {
        ...next.workspace,
        contentHash: "c".repeat(64) as typeof workspace.contentHash,
      },
    },
  );
  expect(conflict.conflict).toBe(true);
  expect(conflict.draft).toBe(edited);
});

function bufferFixture() {
  const workspace = policyFixture();
  if (workspace.outcome !== "SUCCESS") throw new Error("fixture");
  const draft: PolicyDraft = {
    kind: "DELIVERY",
    effectiveAt: "2027-01-01T00:00:00Z",
    translations: [{ locale: "en", origin: "MACHINE", fields }],
  };
  return {
    state: { owner, workspace, draft },
    draft: {
      ...draft,
      translations: [
        {
          ...draft.translations[0]!,
          fields: { ...fields, title: "Local text" },
        },
      ],
    },
  };
}

test.each(["revision", "revision and hash", "authoring head"])(
  "a changed %s preserves local text and requires explicit conflict recovery",
  (change) => {
    const previous = bufferFixture();
    const workspace = previous.state.workspace;
    const next: PolicyState = {
      ...previous.state,
      workspace: {
        ...workspace,
        target: {
          ...workspace.target,
          ...(change.startsWith("revision")
            ? {
                revisionId:
                  "10000000-0000-4000-8000-000000000003" as typeof workspace.target.revisionId,
              }
            : {}),
        },
        ...(change === "revision and hash"
          ? { contentHash: "c".repeat(64) as typeof workspace.contentHash }
          : {}),
        ...(change === "authoring head"
          ? { authoringHeadVersion: workspace.authoringHeadVersion + 1 }
          : {}),
      },
    };
    const result = subject!.continuePolicyDraft(previous, next);
    expect(result.conflict).toBe(true);
    expect(result.draft).toBe(previous.draft);
  },
);

test("an unsaved first revision survives a language switch under the same owner version", () => {
  const previous = bufferFixture();
  const state = { ...previous.state, workspace: null };
  const result = subject!.continuePolicyDraft({ ...previous, state }, state);
  expect(result.conflict).toBe(false);
  expect(result.draft?.translations[0]?.fields.title).toBe("Local text");
});

test.each(["first revision", "owner version"])(
  "initial local text remains protected when another editor changes the %s",
  (change) => {
    const previous = bufferFixture();
    const state = { ...previous.state, workspace: null };
    const next =
      change === "first revision"
        ? previous.state
        : {
            ...state,
            owner: { ...owner, authoringVersion: owner.authoringVersion + 1 },
          };
    const result = subject!.continuePolicyDraft({ ...previous, state }, next);
    expect(result.conflict).toBe(true);
    expect(result.draft).toBe(previous.draft);
  },
);

test.each(["missing to existing", "existing to missing"])(
  "%s scoped translations merge known structure without losing edits or inventing structure changes",
  (direction) => {
    const fixture = bufferFixture();
    const known = {
      ...fixture.state,
      draft: {
        ...fixture.state.draft,
        translations: [
          { locale: "pt" as const, origin: "MACHINE" as const, fields },
        ],
      },
    };
    const unknown = {
      ...fixture.state,
      draft: { kind: null, effectiveAt: "", translations: [] },
    };
    const state = direction === "missing to existing" ? unknown : known;
    const locale =
      direction === "missing to existing" ? ("es" as const) : ("pt" as const);
    const draft = {
      ...state.draft,
      translations: [
        {
          locale,
          origin: "MACHINE" as const,
          fields: { ...fields, title: "Local text" },
        },
      ],
    };
    const result = subject!.continuePolicyDraft(
      { state, draft },
      direction === "missing to existing" ? known : unknown,
    );
    expect(result.conflict).toBe(false);
    expect(result.state.draft?.kind).toBe("DELIVERY");
    expect(result.draft?.kind).toBe("DELIVERY");
    expect(result.state.draft?.effectiveAt).toBe("2027-01-01T00:00:00Z");
    expect(result.draft?.effectiveAt).toBe("2027-01-01T00:00:00Z");
    expect(policyChanges(result.state.draft!, result.draft!)).toEqual({
      kind: "POLICY",
      translations: draft.translations,
    });
  },
);

test.each(["2027-02-01T00:00:00Z", ""])(
  "known structure enrichment preserves an explicitly edited effective time %s",
  (effectiveAt) => {
    const previous = bufferFixture();
    previous.draft.effectiveAt = effectiveAt;
    const next = {
      ...previous.state,
      draft: { kind: null, effectiveAt: "", translations: [] },
    };
    const result = subject!.continuePolicyDraft(previous, next);
    expect(result.state.draft?.effectiveAt).toBe("2027-01-01T00:00:00Z");
    expect(result.draft?.effectiveAt).toBe(effectiveAt);
  },
);
