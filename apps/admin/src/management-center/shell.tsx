import { exceptionsCopy } from "../management-exceptions/copy";
import type { ReactNode } from "react";
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@fan-support/contracts";
import type { ManagementSection } from "./api";
import { managementCopy } from "./copy";
import { paymentCopy } from "../management-payments/copy";
import { ordersCopy } from "../management-orders/copy";
import { informationCopy } from "../management-info-pages/copy";
import { decorationCopy } from "../management-decoration/copy";
import { accountCopy } from "../management-account/copy";
import { staffCopy } from "../management-staff/copy";

export function ManagementShell({
  locale,
  section,
  onSection,
  children,
  disabled = false,
  accountAction,
  contentAllowed = true,
  ordersAvailable = false,
  paymentsAvailable = false,
  exceptionsAvailable = false,
  decorationAvailable = false,
  infoPagesAvailable = false,
  staffAvailable = false,
  accountAvailable = false,
  accountWarning,
  beforeLeave,
  languageDisabled = disabled,
}: {
  locale: SupportedLocale;
  section:
    | ManagementSection
    | "ORDERS"
    | "PAYMENTS"
    | "EXCEPTIONS"
    | "DECORATION"
    | "INFO_PAGES"
    | "STAFF"
    | "ACCOUNT";
  onSection: (
    section:
      | ManagementSection
      | "ORDERS"
      | "PAYMENTS"
      | "EXCEPTIONS"
      | "DECORATION"
      | "INFO_PAGES"
      | "STAFF"
      | "ACCOUNT",
  ) => void;
  children: ReactNode;
  disabled?: boolean;
  accountAction?: ReactNode;
  contentAllowed?: boolean;
  ordersAvailable?: boolean;
  paymentsAvailable?: boolean;
  exceptionsAvailable?: boolean;
  decorationAvailable?: boolean;
  infoPagesAvailable?: boolean;
  /** ADR-021: staff accounts, for holders of staff.manage. */
  staffAvailable?: boolean;
  /** ADR-021: the signed-in built-in account's own settings. */
  accountAvailable?: boolean;
  /** Shown under the entry while two-step verification is off. */
  accountWarning?: string | undefined;
  beforeLeave?: (() => boolean) | undefined;
  languageDisabled?: boolean;
}) {
  const copy = managementCopy(locale);
  return (
    <div className="mc-shell" data-management-center>
      <aside className="mc-sidebar">
        <strong className="mc-brand">{copy.center}</strong>
        <nav aria-label={copy.center}>
          {contentAllowed ? (
            <>
              <button
                type="button"
                data-management-section="ARTISTS"
                aria-current={section === "ARTISTS" ? "page" : undefined}
                disabled={disabled}
                onClick={() => onSection("ARTISTS")}
              >
                {copy.artists}
              </button>
              <button
                type="button"
                data-management-section="GIFTS"
                aria-current={section === "GIFTS" ? "page" : undefined}
                disabled={disabled}
                onClick={() => onSection("GIFTS")}
              >
                {copy.gifts}
              </button>
              <button
                type="button"
                data-management-section="POSTERS"
                aria-current={section === "POSTERS" ? "page" : undefined}
                disabled={disabled}
                onClick={() => onSection("POSTERS")}
              >
                {copy.posters}
              </button>
            </>
          ) : null}
          {infoPagesAvailable && (
            <button
              type="button"
              data-management-section="INFO_PAGES"
              aria-current={section === "INFO_PAGES" ? "page" : undefined}
              disabled={disabled}
              onClick={() => onSection("INFO_PAGES")}
            >
              {informationCopy(locale).title}
            </button>
          )}
          {decorationAvailable && (
            <button
              type="button"
              data-management-section="DECORATION"
              aria-current={section === "DECORATION" ? "page" : undefined}
              disabled={disabled}
              onClick={() => onSection("DECORATION")}
            >
              {decorationCopy(locale).title}
            </button>
          )}
          {ordersAvailable ? (
            <button
              type="button"
              data-management-section="ORDERS"
              aria-current={section === "ORDERS" ? "page" : undefined}
              disabled={disabled}
              onClick={() => onSection("ORDERS")}
            >
              {ordersCopy(locale).orders}
            </button>
          ) : null}
          {paymentsAvailable ? (
            <button
              type="button"
              data-management-section="PAYMENTS"
              aria-current={section === "PAYMENTS" ? "page" : undefined}
              disabled={disabled}
              onClick={() => onSection("PAYMENTS")}
            >
              {paymentCopy(locale).title}
            </button>
          ) : null}
          {exceptionsAvailable ? (
            <button
              type="button"
              data-management-section="EXCEPTIONS"
              aria-current={section === "EXCEPTIONS" ? "page" : undefined}
              disabled={disabled}
              onClick={() => onSection("EXCEPTIONS")}
            >
              {exceptionsCopy(locale).title}
            </button>
          ) : null}
          {staffAvailable ? (
            <button
              type="button"
              data-management-section="STAFF"
              aria-current={section === "STAFF" ? "page" : undefined}
              disabled={disabled}
              onClick={() => onSection("STAFF")}
            >
              {staffCopy(locale).title}
            </button>
          ) : null}
          {accountAvailable ? (
            <button
              type="button"
              data-management-section="ACCOUNT"
              aria-current={section === "ACCOUNT" ? "page" : undefined}
              aria-describedby={
                accountWarning ? "mc-account-warning" : undefined
              }
              disabled={disabled}
              onClick={() => onSection("ACCOUNT")}
            >
              {accountCopy(locale).title}
              {accountWarning ? (
                <span id="mc-account-warning" className="mc-nav-warning">
                  {accountWarning}
                </span>
              ) : null}
            </button>
          ) : null}
        </nav>
        <label className="mc-language mc-field">
          <span>{copy.interfaceLanguage}</span>
          <select
            data-management-language
            value={locale}
            disabled={languageDisabled}
            onChange={(event) => {
              if (
                (!beforeLeave || beforeLeave()) &&
                event.currentTarget.value !== locale
              )
                window.location.assign(`/${event.currentTarget.value}`);
            }}
          >
            {SUPPORTED_LOCALES.map((value) => (
              <option key={value} value={value}>
                {LOCALE_NATIVE_NAMES[value]}
              </option>
            ))}
          </select>
        </label>
        {accountAction}
      </aside>
      <main className="mc-main" id="management-main">
        {children}
      </main>
    </div>
  );
}
