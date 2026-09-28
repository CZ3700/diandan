import type {
  InformationPageFields,
  InformationPageStructure,
  InformationPageWorkspace,
} from "@fan-support/contracts";
export type InformationDraft = {
  structure: InformationPageStructure;
  fields: InformationPageFields;
};
export function sameFields(a: InformationPageFields, b: InformationPageFields) {
  return (
    a.title === b.title &&
    a.summary === b.summary &&
    a.sections.length === b.sections.length &&
    a.sections.every((s, i) => {
      const t = b.sections[i];
      return t?.id === s.id && t.heading === s.heading && t.body === s.body;
    })
  );
}
export function sameDraft(a: InformationDraft, b: InformationDraft) {
  return (
    sameFields(a.fields, b.fields) &&
    a.structure.contactEmail === b.structure.contactEmail &&
    a.structure.sectionIds.length === b.structure.sectionIds.length &&
    a.structure.sectionIds.every((id, i) => id === b.structure.sectionIds[i])
  );
}
export function alignTranslation(
  fields: InformationPageFields,
  structure: InformationPageStructure,
): InformationPageFields {
  return {
    ...fields,
    sections: structure.sectionIds.map((id) => {
      const saved = fields.sections.find(
        (section) => section.id.toLowerCase() === id.toLowerCase(),
      );
      return saved ? { ...saved, id } : { id, heading: "", body: "" };
    }),
  };
}
export function editableInformation(
  workspace: InformationPageWorkspace,
): InformationDraft {
  const structure = workspace.draft?.structure ?? {
    sectionIds: [crypto.randomUUID()],
    contactEmail: null,
  };
  const fields = workspace.selected?.fields ?? {
    title: "",
    summary: "",
    sections: structure.sectionIds.map((id) => ({ id, heading: "", body: "" })),
  };
  return { structure, fields: alignTranslation(fields, structure) };
}
