"use client";
import { useId } from "react";
import type { WishGalleryPreference } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";

/** Public attribution is deliberately independent of private personalization. */
export function WishGalleryChoice({
  value,
  onChange,
  copy,
  disabled = false,
  invalid = false,
}: Readonly<{
  value: WishGalleryPreference;
  onChange(value: WishGalleryPreference): void;
  copy: StorefrontCopy;
  disabled?: boolean;
  invalid?: boolean;
}>) {
  const id = useId();
  const shared = value.visibility !== "PRIVATE";
  return (
    <fieldset className="wish-gallery-choice" disabled={disabled}>
      <legend>{copy.wishRecordTitle}</legend>
      <label className="wish-checkbox">
        <input
          type="checkbox"
          checked={shared}
          onChange={(event) =>
            onChange({
              visibility: event.target.checked ? "PUBLIC_ANONYMOUS" : "PRIVATE",
            })
          }
        />
        {copy.wishDisplayOptIn}
      </label>
      {shared && (
        <>
          <label htmlFor={`${id}-mode`}>{copy.wishDisplayAlias}</label>
          <select
            id={`${id}-mode`}
            value={value.visibility}
            onChange={(event) =>
              onChange(
                event.target.value === "PUBLIC_NAMED"
                  ? { visibility: "PUBLIC_NAMED", publicAlias: "" }
                  : { visibility: "PUBLIC_ANONYMOUS" },
              )
            }
          >
            <option value="PUBLIC_ANONYMOUS">
              {copy.wishDisplayAnonymous}
            </option>
            <option value="PUBLIC_NAMED">{copy.wishDisplayAlias}</option>
          </select>
          {value.visibility === "PUBLIC_NAMED" && (
            <>
              <label htmlFor={`${id}-alias`}>{copy.wishAliasLabel}</label>
              <input
                id={`${id}-alias`}
                value={value.publicAlias}
                maxLength={80}
                autoComplete="off"
                aria-invalid={invalid || undefined}
                aria-describedby={`${id}-hint`}
                onChange={(event) =>
                  onChange({
                    visibility: "PUBLIC_NAMED",
                    publicAlias: event.target.value,
                  })
                }
              />
            </>
          )}
          <p id={`${id}-hint`} className="wish-fine-print">
            {copy.wishAliasHint}
          </p>
          <p className="wish-fine-print">{copy.wishPrivacyWithdrawHint}</p>
        </>
      )}
    </fieldset>
  );
}
