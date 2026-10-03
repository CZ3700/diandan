import { useId } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import {
  emptyPolicyFields,
  replacePolicyTranslation,
  type PolicyDraft,
} from "./model";
import type { PoliciesCopy } from "./copy";
export function PolicyEditor({
  copy,
  locale,
  draft,
  disabled,
  canStructure,
  onChange,
}: {
  copy: PoliciesCopy;
  locale: SupportedLocale;
  draft: PolicyDraft;
  disabled: boolean;
  canStructure: boolean;
  onChange: (draft: PolicyDraft) => void;
}) {
  const id = useId();
  const translation = draft.translations.find((row) => row.locale === locale);
  const fields = translation?.fields ?? emptyPolicyFields();
  const field = (name: keyof typeof fields, value: string) =>
    onChange(
      replacePolicyTranslation(draft, locale, {
        fields: { ...fields, [name]: value },
      }),
    );
  return (
    <div className="policy-editor">
      <label className="mc-field" htmlFor={`${id}-title`}>
        <span>{copy.policyTitle}</span>
        <input
          id={`${id}-title`}
          lang={locale}
          value={fields.title}
          maxLength={160}
          required
          disabled={disabled}
          onChange={(event) => field("title", event.currentTarget.value)}
          data-policy-field="title"
        />
      </label>
      <label className="mc-field" htmlFor={`${id}-summary`}>
        <span>{copy.summary}</span>
        <textarea
          id={`${id}-summary`}
          lang={locale}
          value={fields.summary}
          maxLength={300}
          rows={3}
          required
          disabled={disabled}
          onChange={(event) => field("summary", event.currentTarget.value)}
          data-policy-field="summary"
        />
      </label>
      <label className="mc-field" htmlFor={`${id}-body`}>
        <span>{copy.body}</span>
        <textarea
          id={`${id}-body`}
          lang={locale}
          value={fields.body}
          maxLength={20000}
          rows={18}
          required
          disabled={disabled}
          aria-describedby={`${id}-markup`}
          onChange={(event) => field("body", event.currentTarget.value)}
          data-policy-field="body"
        />
        <small id={`${id}-markup`}>{copy.markupHint}</small>
      </label>
      <label className="mc-field" htmlFor={`${id}-origin`}>
        <span>{copy.provenance}</span>
        <select
          id={`${id}-origin`}
          value={translation?.origin ?? "MACHINE"}
          disabled={disabled}
          onChange={(event) => {
            const origin = event.currentTarget.value;
            if (origin === "HUMAN" || origin === "MACHINE")
              onChange(replacePolicyTranslation(draft, locale, { origin }));
          }}
        >
          <option value="MACHINE">{copy.machine}</option>
          <option value="HUMAN">{copy.human}</option>
          {translation?.origin === "IMPORT" && (
            <option value="IMPORT">{copy.imported}</option>
          )}
        </select>
      </label>
      <label className="mc-field" htmlFor={`${id}-effective`}>
        <span>{copy.effectiveAt}</span>
        <input
          id={`${id}-effective`}
          type="datetime-local"
          value={draft.effectiveAt.replace(/(?:\.\d+)?Z$/, "").slice(0, 16)}
          disabled={disabled || !canStructure}
          required
          aria-describedby={`${id}-effective-hint`}
          onChange={(event) =>
            onChange({
              ...draft,
              effectiveAt: event.currentTarget.value
                ? `${event.currentTarget.value}:00.000Z`
                : "",
            })
          }
          data-policy-effective
        />
        <small id={`${id}-effective-hint`}>{copy.effectiveHint}</small>
      </label>
    </div>
  );
}
