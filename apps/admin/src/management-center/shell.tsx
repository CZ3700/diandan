import type { ReactNode } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import type { ManagementSection } from "./api";
import { managementCopy } from "./copy";

export function ManagementShell({
  locale,
  section,
  onSection,
  children,
  disabled = false,
  accountAction,
}: {
  locale: SupportedLocale;
  section: ManagementSection;
  onSection: (section: ManagementSection) => void;
  children: ReactNode;
  disabled?: boolean;
  accountAction?: ReactNode;
}) {
  const copy = managementCopy(locale);
  return (
    <div className="mc-shell" data-management-center>
      <aside className="mc-sidebar">
        <strong className="mc-brand">{copy.center}</strong>
        <nav aria-label={copy.center}>
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
        </nav>
        {accountAction}
      </aside>
      <main className="mc-main" id="management-main">
        {children}
      </main>
    </div>
  );
}
