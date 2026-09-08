"use client";
import { useState } from "react";
import { Button } from "@fan-support/ui";
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type PublicMediaView,
  type SupportedLocale,
} from "@fan-support/contracts";
import { managementCopy } from "./copy";
import { PhotoInput } from "./photo-input";
import { ManagementSelect } from "./form-fields";
export type PosterFormProps = {
  locale: SupportedLocale;
  busy: boolean;
  current?: PublicMediaView | null | undefined;
  onSubmit: (file: File, locale: SupportedLocale) => void;
};
export function PosterForm({
  locale,
  busy,
  current,
  onSubmit,
}: PosterFormProps) {
  const copy = managementCopy(locale);
  const [sourceLocale, setSourceLocale] = useState(locale);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<keyof typeof copy | null>(null);
  return (
    <form
      data-management-form="poster"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (!file) {
          setError(error ?? "imageRequired");
          document.getElementById("management-image")?.focus();
          return;
        }
        onSubmit(file, sourceLocale);
      }}
    >
      <fieldset className="mc-poster-form" disabled={busy}>
        <PhotoInput
          copy={copy}
          current={current}
          file={file}
          onChange={setFile}
          onError={setError}
          error={error ? copy[error] : undefined}
          poster
        />
        <details className="mc-options">
          <summary>{copy.options}</summary>
          <div className="mc-options-body">
            <ManagementSelect
              name="sourceLocale"
              label={copy.sourceLanguage}
              value={sourceLocale}
              onChange={(value) => setSourceLocale(value as SupportedLocale)}
            >
              {SUPPORTED_LOCALES.map((value) => (
                <option key={value} value={value}>
                  {LOCALE_NATIVE_NAMES[value]}
                </option>
              ))}
            </ManagementSelect>
          </div>
        </details>
        <div className="mc-submit">
          <p className="mc-hint">{copy.rightsNotice}</p>
          <Button data-management-submit type="submit" disabled={busy}>
            {copy.replacePoster}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
