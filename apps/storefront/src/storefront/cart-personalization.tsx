"use client";
import { useId } from "react";
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  type CartEditorContent,
} from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
export type CartDraft = Readonly<{
  displayMode: "anonymous" | "nickname";
  displayName: string;
  fanMessage: string;
  fanMessageLocale: CartEditorContent["fanMessageLocale"];
}>;
export function emptyCartDraft(locale: SupportedLocale): CartDraft {
  return {
    displayMode: "anonymous",
    displayName: "",
    fanMessage: "",
    fanMessageLocale: locale,
  };
}
export function validCartDraft(draft: CartDraft) {
  return (
    draft.fanMessage.isWellFormed() &&
    [...draft.fanMessage].length <= 280 &&
    (draft.displayMode === "anonymous" ||
      (draft.displayName.isWellFormed() &&
        draft.displayName.trim().length > 0 &&
        [...draft.displayName].length <= 40))
  );
}
export function cartPersonalization(draft: CartDraft) {
  const message =
    draft.fanMessage === "" ? {} : { fanMessage: draft.fanMessage };
  return draft.displayMode === "anonymous"
    ? {
        displayMode: "anonymous" as const,
        fanMessageLocale: draft.fanMessageLocale,
        ...message,
      }
    : {
        displayMode: "nickname" as const,
        displayName: draft.displayName,
        fanMessageLocale: draft.fanMessageLocale,
        ...message,
      };
}
export function CartPersonalization({
  draft,
  onChange,
  copy,
  disabled = false,
}: Readonly<{
  draft: CartDraft;
  onChange: (draft: CartDraft) => void;
  copy: StorefrontCopy;
  disabled?: boolean;
}>) {
  const id = useId();
  return (
    <fieldset
      className="cart-personalization"
      disabled={disabled}
      data-cart-personalization
    >
      <legend>{copy.cartPrivateTitle}</legend>
      <div className="cart-name-choice">
        <label>
          <input
            type="radio"
            name={`${id}-display`}
            checked={draft.displayMode === "anonymous"}
            onChange={() =>
              onChange({ ...draft, displayMode: "anonymous", displayName: "" })
            }
          />
          {copy.cartAnonymous}
        </label>
        <label>
          <input
            type="radio"
            name={`${id}-display`}
            checked={draft.displayMode === "nickname"}
            onChange={() => onChange({ ...draft, displayMode: "nickname" })}
          />
          {copy.cartNickname}
        </label>
      </div>
      {draft.displayMode === "nickname" && (
        <div className="cart-field">
          <label htmlFor={`${id}-name`}>{copy.cartDisplayName}</label>
          <input
            id={`${id}-name`}
            data-cart-name
            autoComplete="off"
            value={draft.displayName}
            onChange={(event) =>
              onChange({ ...draft, displayName: event.target.value })
            }
            aria-describedby={`${id}-name-count`}
          />
          <small id={`${id}-name-count`}>
            {copy.cartCharacters}: {[...draft.displayName].length}/40
          </small>
        </div>
      )}
      <div className="cart-field">
        <label htmlFor={`${id}-message`}>{copy.cartMessage}</label>
        <textarea
          id={`${id}-message`}
          data-cart-message
          rows={3}
          autoComplete="off"
          value={draft.fanMessage}
          onChange={(event) =>
            onChange({ ...draft, fanMessage: event.target.value })
          }
          aria-describedby={`${id}-hint ${id}-count`}
        />
        <small id={`${id}-hint`}>{copy.cartMessageHint}</small>
        <small id={`${id}-count`}>
          {copy.cartCharacters}: {[...draft.fanMessage].length}/280
        </small>
      </div>
      <div className="cart-field">
        <label htmlFor={`${id}-locale`}>{copy.cartMessageLanguage}</label>
        <select
          id={`${id}-locale`}
          data-cart-message-locale
          value={draft.fanMessageLocale}
          onChange={(event) => {
            if (event.target.value === "und") {
              onChange({ ...draft, fanMessageLocale: "und" });
              return;
            }
            const locale = SUPPORTED_LOCALES.find(
              (value) => value === event.target.value,
            );
            if (locale) onChange({ ...draft, fanMessageLocale: locale });
          }}
        >
          <option value="und">{copy.cartLanguageUnknown}</option>
          {SUPPORTED_LOCALES.map((locale) => (
            <option key={locale} value={locale} lang={locale}>
              {LOCALE_NATIVE_NAMES[locale]}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}
