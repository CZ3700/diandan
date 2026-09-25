"use client";
import { useEffect, useState } from "react";
import { Icon } from "@fan-support/ui";
import type { PublicMediaView } from "@fan-support/contracts";
import type { ManagementCopy } from "./copy";
import { imageSelectionIssue } from "./inputs";
import { PhotoView } from "./photo-view";

export function PhotoInput({
  copy,
  current,
  file,
  onChange,
  error,
  onError,
  poster = false,
}: {
  copy: ManagementCopy;
  current?: PublicMediaView | null | undefined;
  file: File | null;
  onChange: (file: File | null) => void;
  error?: string | undefined;
  onError: (error: keyof ManagementCopy | null) => void;
  poster?: boolean;
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
  const source = preview ?? current?.url;
  return (
    <div className="mc-photo-field">
      <label
        className="mc-photo-picker"
        data-poster={poster || undefined}
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
        {copy.imageHint}
      </p>
      {error ? (
        <p id="management-image-error" className="mc-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
