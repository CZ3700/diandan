"use client";
import { useId, type ReactNode } from "react";
import { adminMessage, type AdminMessageKey } from "@fan-support/i18n";
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@fan-support/contracts";
import { AdminClientError } from "./client";

export type Translate = (
  key: AdminMessageKey,
  values?: Record<string, string | number>,
) => string;
export const translator =
  (locale: SupportedLocale): Translate =>
  (key, values) =>
    adminMessage(locale, key, values);
export function Select({
  label,
  value,
  onChange,
  children,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label className="admin-field" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}
export function LocaleSelect({
  label,
  value,
  onChange,
  allowed = SUPPORTED_LOCALES,
}: {
  label: string;
  value: SupportedLocale;
  onChange: (value: SupportedLocale) => void;
  allowed?: readonly SupportedLocale[];
}) {
  return (
    <Select
      label={label}
      value={value}
      onChange={(next) => onChange(next as SupportedLocale)}
    >
      {SUPPORTED_LOCALES.map((locale) => (
        <option
          value={locale}
          key={locale}
          disabled={!allowed.includes(locale)}
        >
          {LOCALE_NATIVE_NAMES[locale]}
        </option>
      ))}
    </Select>
  );
}
export function TextArea({
  label,
  value,
  onChange,
  maxLength,
  disabled = false,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number | undefined;
  disabled?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const id = useId();
  return (
    <div className="admin-field">
      <label htmlFor={id}>{label}</label>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      <textarea
        id={id}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        }
        rows={3}
      />
      <small>
        {maxLength === undefined ? null : `${value.length} / ${maxLength}`}
      </small>
      {error && (
        <span className="admin-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}
const statusKeys: Record<string, AdminMessageKey> = {
  DRAFT: "draft",
  draft: "draft",
  IN_REVIEW: "inReview",
  APPROVED: "approved",
  STALE: "stale",
  MISSING: "missing",
  RESTRICTED: "restricted",
  active: "active",
  paused: "paused",
  archived: "archived",
  PENDING: "pending",
  PROCESSING: "processing",
  FAILED: "failed",
  SUCCEEDED: "succeeded",
  PROCESSING_COMPLETE: "succeeded",
};
export function Status({ value, t }: { value: string; t: Translate }) {
  return (
    <span className="admin-status" data-state={value}>
      {statusKeys[value] ? t(statusKeys[value]) : value}
    </span>
  );
}
export function errorText(error: unknown, t: Translate) {
  if (!(error instanceof AdminClientError)) return t("error");
  if (/CONFLICT|VERSION|STALE|SOURCE_CHANGED/.test(error.code))
    return t("conflict");
  if (/FORBIDDEN|CSRF|PERMISSION/.test(error.code)) return t("forbidden");
  if (/UNAUTHENTICATED|SESSION/.test(error.code)) return t("sessionRequired");
  if (/INVALID/.test(error.code)) return t("invalid");
  return t("error");
}
