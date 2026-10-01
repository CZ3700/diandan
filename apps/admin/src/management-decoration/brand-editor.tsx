"use client";
import { useEffect, useState } from "react";
import { Button } from "@fan-support/ui";
import { STOREFRONT_THEME_PALETTES } from "@fan-support/design-tokens";
import type {
  StorefrontBrandView,
  StorefrontBrand,
} from "@fan-support/contracts";
import { PhotoView } from "../management-center/photo-view";
import type { BrandCopy } from "./brand-copy";
import type { BrandSlot } from "./brand-model";

type Props = {
  view: StorefrontBrandView;
  brand?: StorefrontBrand;
  copy: BrandCopy;
  disabled: boolean;
  canUpload?: boolean;
  files?: Partial<Record<BrandSlot, File>>;
  errors?: Partial<Record<BrandSlot, string>>;
  uploading?: BrandSlot | null;
  onUpload: (slot: BrandSlot, file: File) => void;
  onRemove: (slot: BrandSlot) => void;
  onCancelUpload: (slot: BrandSlot) => void;
};
function LogoSlot({
  slot,
  brand,
  view,
  copy,
  disabled,
  canUpload = true,
  files = {},
  errors = {},
  uploading,
  onUpload,
  onRemove,
  onCancelUpload,
}: Props & { slot: BrandSlot }) {
  const file = files[slot];
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
  const source = preview ?? view[slot]?.url;
  const inputId = `brand-${slot}-file`;
  const palette =
    STOREFRONT_THEME_PALETTES[
      slot === "lightLogo" ? "IVORY_GOLD" : "BLACK_GOLD"
    ];
  return (
    <section
      className="brand-logo-slot"
      data-brand-slot={slot}
      aria-labelledby={`${inputId}-title`}
    >
      <h2 id={`${inputId}-title`}>{copy[slot]}</h2>
      <div
        className="brand-logo-preview"
        data-background={slot === "lightLogo" ? "light" : "dark"}
        style={{
          backgroundColor: palette["--color-bg"],
          color: palette["--color-text-muted"],
        }}
      >
        {source ? (
          <PhotoView
            src={source}
            alt={copy[slot]}
            unavailable={copy.imageUnavailable}
          />
        ) : (
          <span>{copy.empty}</span>
        )}
      </div>
      <label htmlFor={inputId}>{source ? copy.replace : copy.upload}</label>
      <input
        id={inputId}
        data-brand-file={slot}
        type="file"
        accept="image/png,image/webp,image/jpeg,image/avif"
        disabled={disabled || !canUpload}
        aria-describedby={`brand-image-hint${errors[slot] ? ` ${inputId}-error` : ""}`}
        aria-invalid={Boolean(errors[slot])}
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0];
          if (selected) onUpload(slot, selected);
          event.currentTarget.value = "";
        }}
      />
      {uploading === slot && <p role="status">{copy.uploading}</p>}
      {errors[slot] && (
        <p id={`${inputId}-error`} role="alert" className="mc-error">
          {errors[slot]}
        </p>
      )}
      <div className="brand-logo-actions">
        {file && errors[slot] && (
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || !canUpload}
            onClick={() => onUpload(slot, file)}
          >
            {copy.retry}
          </Button>
        )}
        {file && (
          <Button
            type="button"
            variant="quiet"
            disabled={disabled}
            onClick={() => onCancelUpload(slot)}
          >
            {copy.cancelUpload}
          </Button>
        )}
        <Button
          type="button"
          variant="quiet"
          data-brand-remove={slot}
          disabled={
            disabled ||
            (!file &&
              !view[slot] &&
              !brand?.[
                slot === "lightLogo" ? "lightLogoAssetId" : "darkLogoAssetId"
              ])
          }
          onClick={() => onRemove(slot)}
        >
          {copy.remove}
        </Button>
      </div>
    </section>
  );
}
export function BrandEditor(props: Props) {
  return (
    <div data-brand-editor>
      <p id="brand-image-hint" className="mc-hint">
        {props.copy.imageHint}
      </p>
      {props.canUpload === false && (
        <p className="mc-hint">{props.copy.uploadPermission}</p>
      )}
      {(["lightLogo", "darkLogo"] as const).map((slot) => (
        <LogoSlot key={slot} {...props} slot={slot} />
      ))}
    </div>
  );
}
