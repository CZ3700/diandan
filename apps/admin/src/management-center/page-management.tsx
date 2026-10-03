"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { pageManagementCopy } from "./page-management-copy";
import "./page-management.css";

export type PageManagementSection = "INFO_PAGES" | "POLICIES";
export function PageManagement({
  locale,
  active,
  infoPagesAvailable,
  policiesAvailable,
  busy,
  onSection,
  children,
}: {
  locale: SupportedLocale;
  active: PageManagementSection;
  infoPagesAvailable: boolean;
  policiesAvailable: boolean;
  busy: boolean;
  onSection: (section: PageManagementSection) => void;
  children: ReactNode;
}) {
  const copy = pageManagementCopy(locale),
    prefix = useId();
  const [focused, setFocused] = useState(active);
  const buttons = useRef<
    Partial<Record<PageManagementSection, HTMLButtonElement | null>>
  >({});
  useEffect(() => setFocused(active), [active]);
  const tabs: { section: PageManagementSection; label: string }[] = [];
  if (infoPagesAvailable)
    tabs.push({ section: "INFO_PAGES", label: copy.information });
  if (policiesAvailable)
    tabs.push({ section: "POLICIES", label: copy.policies });
  if (!tabs.length) return null;
  return (
    <section className="page-management" data-page-management>
      <header className="mc-workspace-header">
        <h1>{copy.title}</h1>
      </header>
      <div
        className="page-management-tabs"
        role="tablist"
        aria-label={copy.title}
      >
        {tabs.map(({ section, label }, index) => (
          <button
            key={section}
            ref={(node) => {
              buttons.current[section] = node;
            }}
            type="button"
            role="tab"
            id={`${prefix}-${section}-tab`}
            aria-controls={`${prefix}-${section}-panel`}
            aria-selected={active === section}
            tabIndex={focused === section ? 0 : -1}
            disabled={busy}
            onFocus={() => setFocused(section)}
            onClick={() => {
              if (!busy && section !== active) onSection(section);
            }}
            onKeyDown={(event) => {
              if (busy) return;
              let target: number;
              switch (event.key) {
                case "ArrowRight":
                  target = (index + 1) % tabs.length;
                  break;
                case "ArrowLeft":
                  target = (index + tabs.length - 1) % tabs.length;
                  break;
                case "Home":
                  target = 0;
                  break;
                case "End":
                  target = tabs.length - 1;
                  break;
                default:
                  return;
              }
              event.preventDefault();
              const next = tabs[target]!.section;
              setFocused(next);
              buttons.current[next]?.focus();
            }}
            data-page-management-tab={section}
          >
            {label}
          </button>
        ))}
      </div>
      {tabs.map(({ section }) => (
        <div
          key={section}
          className="page-management-panel"
          role="tabpanel"
          id={`${prefix}-${section}-panel`}
          aria-labelledby={`${prefix}-${section}-tab`}
          hidden={active !== section}
          tabIndex={0}
        >
          {active === section ? children : null}
        </div>
      ))}
    </section>
  );
}
