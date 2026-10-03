import { Button } from "@fan-support/ui";
import {
  LOCALE_NATIVE_NAMES,
  type InformationPageWorkspace,
  type SupportedLocale,
} from "@fan-support/contracts";
import type { Translate } from "../workspace/components";
import type { InformationCopy } from "./copy";
export function InformationReview({
  state,
  contentLocale,
  localeScopes,
  busy,
  dirty,
  copy,
  t,
  selectLocale,
  onSubmitReview,
  onApproveReview,
}: {
  state: InformationPageWorkspace;
  contentLocale: SupportedLocale;
  localeScopes: readonly SupportedLocale[];
  busy: boolean;
  dirty: boolean;
  copy: InformationCopy;
  t: Translate;
  selectLocale: (locale: SupportedLocale) => void;
  onSubmitReview: () => void;
  onApproveReview: () => void;
}) {
  return (
    <details
      className="info-review"
      open={contentLocale !== "en" || state.capabilities.canApprove}
    >
      <summary>{copy.translations}</summary>
      <label className="mc-field">
        <span>{t("contentLanguage")}</span>
        <select
          data-info-content-locale
          value={contentLocale}
          disabled={busy}
          onChange={(e) =>
            selectLocale(e.currentTarget.value as SupportedLocale)
          }
        >
          {localeScopes.map((value) => (
            <option key={value} value={value}>
              {LOCALE_NATIVE_NAMES[value]}
            </option>
          ))}
        </select>
      </label>
      {state.source && contentLocale !== "en" && (
        <aside className="info-source" lang="en">
          <h2>{copy.source}</h2>
          <strong>{state.source.title}</strong>
          <p>{state.source.summary}</p>
          {state.source.sections.map((section) => (
            <section key={section.id}>
              <h3>{section.heading}</h3>
              <p>{section.body}</p>
            </section>
          ))}
        </aside>
      )}
      {state.previousSource && state.changedPaths.length > 0 && (
        <details>
          <summary>{t("oldSource")}</summary>
          <div className="info-source" lang="en">
            <strong>{state.previousSource.title}</strong>
            <p>{state.previousSource.summary}</p>
            {state.previousSource.sections.map((section) => (
              <section key={section.id}>
                <h3>{section.heading}</h3>
                <p>{section.body}</p>
              </section>
            ))}
          </div>
        </details>
      )}
      <div className="info-section-actions">
        <Button
          type="button"
          data-info-submit
          variant="secondary"
          disabled={busy || dirty || !state.capabilities.canSubmit}
          onClick={() => {
            onSubmitReview();
          }}
        >
          {copy.reviewSubmit}
        </Button>
        <Button
          type="button"
          data-info-approve
          variant="secondary"
          disabled={busy || dirty || !state.capabilities.canApprove}
          onClick={() => {
            onApproveReview();
          }}
        >
          {copy.approve}
        </Button>
      </div>
    </details>
  );
}
