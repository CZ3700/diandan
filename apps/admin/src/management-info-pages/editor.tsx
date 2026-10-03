import { useId } from "react";
import { Button } from "@fan-support/ui";
import type {
  InformationPageKey,
  SupportedLocale,
} from "@fan-support/contracts";
import type { InformationDraft } from "./model";
import type { InformationCopy } from "./copy";
export function InformationEditor({
  pageKey,
  contentLocale,
  draft,
  onChange,
  disabled,
  copy,
}: {
  pageKey: InformationPageKey;
  contentLocale: SupportedLocale;
  draft: InformationDraft;
  onChange: (draft: InformationDraft) => void;
  disabled: boolean;
  copy: InformationCopy;
}) {
  const prefix = useId();
  const source = contentLocale === "en";
  const changeField = (key: "title" | "summary", value: string) =>
    onChange({ ...draft, fields: { ...draft.fields, [key]: value } });
  return (
    <div className="info-editor" data-info-editor>
      <label className="mc-field" htmlFor={`${prefix}-title`}>
        <span>{copy.pageTitle}</span>
        <input
          id={`${prefix}-title`}
          lang={contentLocale}
          data-info-field="title"
          required
          maxLength={120}
          value={draft.fields.title}
          disabled={disabled}
          onChange={(e) => changeField("title", e.currentTarget.value)}
        />
      </label>
      <label className="mc-field" htmlFor={`${prefix}-summary`}>
        <span>{copy.summary}</span>
        <textarea
          id={`${prefix}-summary`}
          lang={contentLocale}
          data-info-field="summary"
          maxLength={500}
          rows={3}
          value={draft.fields.summary}
          disabled={disabled}
          onChange={(e) => changeField("summary", e.currentTarget.value)}
        />
      </label>
      {draft.fields.sections.map((section, index) => (
        <section
          className="info-section"
          data-info-section={section.id}
          key={section.id}
        >
          {!source && !section.body && (
            <p className="mc-hint">{copy.newTranslation}</p>
          )}
          <label
            className="mc-field"
            htmlFor={`${prefix}-${section.id}-heading`}
          >
            <span>
              {pageKey === "FAQ" ? copy.question : copy.heading} {index + 1}
            </span>
            <input
              id={`${prefix}-${section.id}-heading`}
              lang={contentLocale}
              data-info-heading={section.id}
              required={pageKey === "FAQ"}
              maxLength={160}
              value={section.heading}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...draft,
                  fields: {
                    ...draft.fields,
                    sections: draft.fields.sections.map((s) =>
                      s.id === section.id
                        ? { ...s, heading: e.currentTarget.value }
                        : s,
                    ),
                  },
                })
              }
            />
          </label>
          <label className="mc-field" htmlFor={`${prefix}-${section.id}-body`}>
            <span>
              {pageKey === "FAQ" ? copy.answer : copy.body} {index + 1}
            </span>
            <textarea
              id={`${prefix}-${section.id}-body`}
              lang={contentLocale}
              data-info-body={section.id}
              required
              maxLength={4000}
              rows={6}
              value={section.body}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...draft,
                  fields: {
                    ...draft.fields,
                    sections: draft.fields.sections.map((s) =>
                      s.id === section.id
                        ? { ...s, body: e.currentTarget.value }
                        : s,
                    ),
                  },
                })
              }
            />
          </label>
          {source && (
            <div className="info-section-actions">
              {([-1, 1] as const).map((direction) => (
                <Button
                  key={direction}
                  type="button"
                  variant="quiet"
                  disabled={
                    disabled ||
                    (direction === -1
                      ? index === 0
                      : index === draft.fields.sections.length - 1)
                  }
                  onClick={() => {
                    const sections = [...draft.fields.sections];
                    const [item] = sections.splice(index, 1);
                    if (!item) return;
                    sections.splice(index + direction, 0, item);
                    onChange({
                      ...draft,
                      structure: {
                        ...draft.structure,
                        sectionIds: sections.map((s) => s.id),
                      },
                      fields: { ...draft.fields, sections },
                    });
                  }}
                >
                  {direction === -1 ? copy.moveUp : copy.moveDown}
                </Button>
              ))}
              <Button
                type="button"
                variant="quiet"
                disabled={disabled || draft.fields.sections.length === 1}
                onClick={() =>
                  onChange({
                    ...draft,
                    structure: {
                      ...draft.structure,
                      sectionIds: draft.structure.sectionIds.filter(
                        (id) => id !== section.id,
                      ),
                    },
                    fields: {
                      ...draft.fields,
                      sections: draft.fields.sections.filter(
                        (s) => s.id !== section.id,
                      ),
                    },
                  })
                }
              >
                {copy.removeSection}
              </Button>
            </div>
          )}
        </section>
      ))}
      {source && (
        <Button
          type="button"
          variant="secondary"
          data-info-add-section
          disabled={disabled || draft.fields.sections.length >= 12}
          onClick={() => {
            const id = crypto.randomUUID();
            onChange({
              ...draft,
              structure: {
                ...draft.structure,
                sectionIds: [...draft.structure.sectionIds, id],
              },
              fields: {
                ...draft.fields,
                sections: [
                  ...draft.fields.sections,
                  { id, heading: "", body: "" },
                ],
              },
            });
          }}
        >
          {copy.addSection}
        </Button>
      )}
      {pageKey === "SUPPORT" && (
        <label className="mc-field" htmlFor={`${prefix}-email`}>
          <span>{copy.contactEmail}</span>
          <input
            id={`${prefix}-email`}
            data-info-contact
            type="email"
            maxLength={254}
            value={draft.structure.contactEmail ?? ""}
            disabled={disabled || !source}
            onChange={(e) =>
              onChange({
                ...draft,
                structure: {
                  ...draft.structure,
                  contactEmail: e.currentTarget.value || null,
                },
              })
            }
          />
        </label>
      )}
    </div>
  );
}
