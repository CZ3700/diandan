"use client";
import { Icon } from "@fan-support/ui";
import type {
  DailyManagementImageKind,
  PublicMediaView,
} from "@fan-support/contracts";
import type { ManagementCopy } from "./copy";
import { imageSizeHint, smallImageWarning } from "./image-size";
import { imageSelectionIssue } from "./inputs";
import { PhotoView } from "./photo-view";
import type { OriginalImage } from "./api";
import { FocalControls } from "./focal-controls";
import type { PhotoEdit } from "./focal-model";
import { usePhotoFocus } from "./use-photo-focus";
import { AdminClientError } from "../workspace/client";
import { managementError } from "./errors";

function originalError(error: unknown, copy: ManagementCopy): string {
  if (!(error instanceof AdminClientError)) return copy.originalUnavailable;
  if (error.code === "REUPLOAD_REQUIRED") return copy.reuploadRequired;
  if (
    [
      "TARGET_CONFLICT",
      "FORBIDDEN",
      "SESSION_EXPIRED",
      "UNAUTHENTICATED",
    ].includes(error.code)
  )
    return managementError(error, copy);
  return copy.originalUnavailable;
}

export function PhotoInput({
  copy,
  current,
  file,
  onChange,
  error,
  onError,
  kind,
  loadOriginal,
  onImageEdit,
}: {
  copy: ManagementCopy;
  current?: PublicMediaView | null | undefined;
  file: File | null;
  onChange: (file: File | null) => void;
  error?: string | undefined;
  onError: (error: keyof ManagementCopy | null) => void;
  kind: DailyManagementImageKind;
  loadOriginal?: (() => Promise<OriginalImage>) | undefined;
  onImageEdit?: ((edit: PhotoEdit | null) => void) | undefined;
}) {
  const {
    preview,
    decoded,
    point,
    sourceLoading,
    sourceError,
    readOriginal,
    changeFocus,
    resetFocus,
  } = usePhotoFocus({ file, kind, loadOriginal, onImageEdit });
  const warning = file ? smallImageWarning(copy, kind, decoded) : null;
  const source = preview ?? current?.url;
  return (
    <div className="mc-photo-field">
      <label
        className="mc-photo-picker"
        data-kind={kind}
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
          onImageEdit?.(null);
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
      {(file || (current && loadOriginal)) && onImageEdit ? (
        <details
          className="mc-options mc-focus-options"
          data-image-focus-options
          onToggle={(event) => {
            if (event.currentTarget.open && !file && !decoded && !sourceError)
              void readOriginal();
          }}
        >
          <summary>{copy.adjustFocus}</summary>
          {sourceLoading ? (
            <p className="mc-hint" role="status">
              {copy.originalLoading}
            </p>
          ) : null}
          {sourceError ? (
            <div role="alert" className="mc-error" data-image-source-error>
              <p>{originalError(sourceError, copy)}</p>
              {!file ? (
                <button
                  className="mc-focus-reset"
                  type="button"
                  data-image-source-retry
                  onClick={() => void readOriginal()}
                >
                  {copy.retry}
                </button>
              ) : null}
            </div>
          ) : null}
          {decoded ? (
            <FocalControls
              copy={copy}
              kind={kind}
              source={decoded}
              point={point}
              onChange={changeFocus}
              onReset={resetFocus}
            />
          ) : null}
        </details>
      ) : null}
      {error ? (
        <p id="management-image-error" className="mc-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
