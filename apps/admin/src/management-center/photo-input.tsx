"use client";
import { useEffect, useState } from "react";
import { Icon } from "@fan-support/ui";
import type {
  DailyManagementImageKind,
  PublicMediaView,
} from "@fan-support/contracts";
import type { ManagementCopy } from "./copy";
import { imageSizeHint, measureImage, smallImageWarning } from "./image-size";
import { imageSelectionIssue } from "./inputs";
import { PhotoView } from "./photo-view";

export function PhotoInput({
  copy,
  current,
  file,
  onChange,
  error,
  onError,
  kind,
}: {
  copy: ManagementCopy;
  current?: PublicMediaView | null | undefined;
  file: File | null;
  onChange: (file: File | null) => void;
  error?: string | undefined;
  onError: (error: keyof ManagementCopy | null) => void;
  kind: DailyManagementImageKind;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // A small image still uploads; the note explains why it may look soft once enlarged.
  const [warning, setWarning] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setWarning(null);
    if (file)
      void measureImage(file).then((size) => {
        if (current) setWarning(smallImageWarning(copy, kind, size));
      });
    return () => {
      current = false;
    };
  }, [copy, file, kind]);
  const source = preview ?? current?.url;
  return (
    <div className="mc-photo-field">
      <label
        className="mc-photo-picker"
        data-poster={kind === "REPLACE_POSTER" || undefined}
        htmlFor="management-image"
      >
        {source ? (
          <PhotoView
            src={source}
            alt={current?.alt ?? copy.upload}
            unavailable={copy.imageUnavailable}
          />
        ) : (
          <span className="mc-photo-empty">
            <Icon name="plus" decorative />
            <span>{copy.upload}</span>
          </span>
        )}
      </label>
      <span className="mc-file-label" id="management-image-label">
        {source ? copy.changeImage : copy.upload}
      </span>
      <input
        id="management-image"
        data-management-field="image"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-labelledby="management-image-label"
        aria-invalid={Boolean(error)}
        aria-describedby={`management-image-hint${error ? " management-image-error" : ""}`}
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0] ?? null;
          if (!selected) return;
          const issue = imageSelectionIssue(selected);
          onError(issue);
          onChange(issue ? null : selected);
        }}
      />
      <p id="management-image-hint" className="mc-hint">
        {imageSizeHint(copy, kind)}
      </p>
      {warning ? (
        <p className="mc-hint" data-image-size-warning role="status">
          {warning}
        </p>
      ) : null}
      {error ? (
        <p id="management-image-error" className="mc-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
