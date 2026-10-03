import { expect, test } from "vitest";
const subject = await import("./model").catch(() => undefined);
const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";
const fields = {
  title: "About",
  summary: "Summary",
  sections: [{ id: a, heading: "Story", body: "Original story" }],
};
test("draft comparison includes stable section order, fields and support contact without serialization shortcuts", () => {
  expect(subject?.sameDraft).toBeTypeOf("function");
  const draft = { fields, structure: { sectionIds: [a], contactEmail: null } };
  expect(subject!.sameDraft(draft, structuredClone(draft))).toBe(true);
  expect(
    subject!.sameDraft(draft, {
      ...draft,
      fields: { ...fields, title: "Changed" },
    }),
  ).toBe(false);
  expect(
    subject!.sameDraft(draft, {
      ...draft,
      structure: { ...draft.structure, contactEmail: "help@example.invalid" },
    }),
  ).toBe(false);
  expect(
    subject!.sameDraft(draft, {
      ...draft,
      fields: {
        ...fields,
        sections: [...fields.sections, { id: b, heading: "", body: "Next" }],
      },
      structure: { sectionIds: [a, b], contactEmail: null },
    }),
  ).toBe(false);
});
test("aligning a stale translation retains surviving text and leaves new sections visibly untranslated", () => {
  expect(subject?.alignTranslation).toBeTypeOf("function");
  const stale = {
    title: "关于",
    summary: "简介",
    sections: [{ id: a, heading: "故事", body: "旧译文" }],
  };
  const next = subject!.alignTranslation(stale, {
    sectionIds: [b, a],
    contactEmail: null,
  });
  expect(next.sections).toEqual([
    { id: b, heading: "", body: "" },
    { id: a, heading: "故事", body: "旧译文" },
  ]);
  expect(stale.sections).toHaveLength(1);
});
test("aligning a valid translation matches UUIDs case insensitively and preserves the structure IDs", () => {
  const id = "abcdef00-0000-4000-8000-000000000001";
  const saved = {
    ...fields,
    sections: [{ id, heading: "Saved heading", body: "Saved translation" }],
  };
  const aligned = subject!.alignTranslation(saved, {
    sectionIds: [id.toUpperCase()],
    contactEmail: null,
  });
  expect(aligned.sections).toEqual([
    {
      id: id.toUpperCase(),
      heading: "Saved heading",
      body: "Saved translation",
    },
  ]);
  expect(saved.sections[0]?.id).toBe(id);
});
