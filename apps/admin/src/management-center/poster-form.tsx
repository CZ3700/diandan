"use client";
import { useLayoutEffect, useState } from "react";
import { Button } from "@fan-support/ui";
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type PublicMediaView,
  type SupportedLocale,
} from "@fan-support/contracts";
import { managementCopy } from "./copy";
import type { OriginalImage } from "./api";
import type { PhotoEdit } from "./focal-model";
import { PhotoInput } from "./photo-input";
import { ManagementSelect } from "./form-fields";
export type PosterFormProps = {
  locale: SupportedLocale;
  busy: boolean;
  current?: PublicMediaView | null | undefined;
  onSubmit: (
    file: File | null,
    locale: SupportedLocale,
    image: PhotoEdit | null,
  ) => void;
  loadOriginal?: (() => Promise<OriginalImage>) | undefined;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
};
export function PosterForm({
  locale,
  busy,
  current,
  onSubmit,
  loadOriginal,
  onDirtyChange,
}: PosterFormProps) {
  const copy = managementCopy(locale);
  const [sourceLocale, setSourceLocale] = useState(locale);
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<PhotoEdit | null>(null);
  const dirty = file !== null || image !== null || sourceLocale !== locale;
  useLayoutEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const [error, setError] = useState<keyof typeof copy | null>(null);
  return (
    <form
      data-management-form="poster"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (!file && !image?.currentImage) {
          setError(error ?? (current ? "imageUnchanged" : "imageRequired"));
          document.getElementById("management-image")?.focus();
          return;
        }
        onSubmit(file, sourceLocale, image);
      }}
    >
      <fieldset className="mc-poster-form" disabled={busy}>
        <PhotoInput
          copy={copy}
          current={current}
          loadOriginal={loadOriginal}
          onImageEdit={setImage}
          file={file}
          onChange={setFile}
          onError={setError}
          error={error ? copy[error] : undefined}
          kind="REPLACE_POSTER"
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
