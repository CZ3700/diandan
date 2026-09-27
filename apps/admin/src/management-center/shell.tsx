import { exceptionsCopy } from "../management-exceptions/copy";
import type { ReactNode } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import type { ManagementSection } from "./api";
import { managementCopy } from "./copy";
import { paymentCopy } from "../management-payments/copy";
import { ordersCopy } from "../management-orders/copy";
import { decorationCopy } from "../management-decoration/copy";

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
}: {
  locale: SupportedLocale;
  section:
    ManagementSection | "ORDERS" | "PAYMENTS" | "EXCEPTIONS" | "DECORATION";
  onSection: (
    section:
      ManagementSection | "ORDERS" | "PAYMENTS" | "EXCEPTIONS" | "DECORATION",
  ) => void;
  children: ReactNode;
  disabled?: boolean;
  accountAction?: ReactNode;
  contentAllowed?: boolean;
  ordersAvailable?: boolean;
  paymentsAvailable?: boolean;
  exceptionsAvailable?: boolean;
  decorationAvailable?: boolean;
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
        </nav>
        {accountAction}
      </aside>
      <main className="mc-main" id="management-main">
        {children}
      </main>
    </div>
  );
}
