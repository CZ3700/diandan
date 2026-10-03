"use client";
/* Local decoded originals stay in memory and bypass public image optimization. */
/* eslint-disable @next/next/no-img-element */
import {
  DAILY_MANAGEMENT_IMAGE_ROLES,
  type DailyManagementImageKind,
} from "@fan-support/contracts";
import { planMediaCrop } from "@fan-support/content/media-framing";
import type { ManagementCopy } from "./copy";
import {
  focusAtPointer,
  focusFromKey,
  type MediaFocalPoint,
  type OriginalPreview,
} from "./focal-model";

export function FocalControls({
  copy,
  kind,
  source,
  point,
  onChange,
  onReset,
}: {
  copy: ManagementCopy;
  kind: DailyManagementImageKind;
  source: OriginalPreview;
  point: MediaFocalPoint;
  onChange: (point: MediaFocalPoint) => void;
  onReset: () => void;
}) {
  const labels = {
    PORTRAIT: copy.previewPortrait,
    HERO_DESKTOP: copy.previewDesktop,
    HERO_MOBILE: copy.previewMobile,
    GIFT_PRIMARY: copy.previewGift,
  };
  return (
    <div className="mc-focus-controls">
      <p className="mc-hint" id="management-focus-hint">
        {copy.focusHint}
      </p>
      <button
        type="button"
        className="mc-focus-original"
        data-image-focus-original
        aria-label={copy.adjustFocus}
        aria-describedby="management-focus-hint"
        onClick={(event) => {
          if (event.detail !== 0)
            onChange(
              focusAtPointer(
                event.clientX,
                event.clientY,
                event.currentTarget.getBoundingClientRect(),
              ),
            );
        }}
        onKeyDown={(event) => {
          const next = focusFromKey(point, event.key, event.shiftKey);
          if (next) {
            event.preventDefault();
            onChange(next);
          }
        }}
      >
        <img
          src={source.url}
          alt=""
          draggable={false}
          width={source.width}
          height={source.height}
        />
        <span
          className="mc-focus-marker"
          aria-hidden
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
        />
      </button>
      <div className="mc-focus-ranges">
        {(["x", "y"] as const).map((axis) => (
          <label key={axis} className="mc-field">
            <span>
              {axis === "x" ? copy.focusHorizontal : copy.focusVertical}{" "}
              <output>{Math.round(point[axis] * 100)}%</output>
            </span>
            <input
              data-image-focus-axis={axis}
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={point[axis] * 100}
              onChange={(event) =>
                onChange({
                  ...point,
                  [axis]:
                    Math.round(Number(event.currentTarget.value) * 1000) /
                    100000,
                })
              }
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="mc-focus-reset"
        data-image-focus-reset
        onClick={onReset}
      >
        {copy.resetFocus}
      </button>
      <div className="mc-focus-previews">
        {DAILY_MANAGEMENT_IMAGE_ROLES[kind].map((role) => {
          const plan = planMediaCrop({
            sourceWidth: source.width,
            sourceHeight: source.height,
            role,
            focalPoint: point,
          });
          if (!plan) return null;
          const crop = plan.sourceCrop;
          return (
            <figure
              key={role}
              data-image-crop-role={role}
              data-image-crop={`${crop.x},${crop.y},${crop.width},${crop.height}`}
            >
              <div
                className="mc-focus-crop"
                style={{ aspectRatio: `${crop.width} / ${crop.height}` }}
              >
                <img
                  src={source.url}
                  alt=""
                  style={{
                    width: `${(source.width / crop.width) * 100}%`,
                    height: `${(source.height / crop.height) * 100}%`,
                    left: `${(-crop.x / crop.width) * 100}%`,
                    top: `${(-crop.y / crop.height) * 100}%`,
                  }}
                />
              </div>
              <figcaption>{labels[role]}</figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
