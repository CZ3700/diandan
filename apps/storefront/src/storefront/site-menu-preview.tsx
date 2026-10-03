import type { ReactNode } from "react";
import { Icon } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";

/** Reuses the drawer's visual surface inside the inert preview, without a portal or focus trap. */
export function SiteMenuPreview({
  copy,
  children,
}: Readonly<{ copy: StorefrontCopy; children: ReactNode }>) {
  return (
    <div
      className="storefront-navigation-preview"
      data-navigation-preview="menu"
    >
      <div className="fs-overlay__backdrop" />
      <div
        className="fs-overlay__viewport"
        data-overlay-kind="drawer"
        data-side="inline-end"
      >
        <aside
          className="fs-drawer__popup"
          data-side="inline-end"
          aria-label={copy.navMenu}
        >
          <header className="fs-overlay__header">
            <div className="fs-overlay__intro">
              <h2 className="fs-overlay__title">{copy.navMenu}</h2>
              <p className="fs-overlay__description">{copy.navLabel}</p>
            </div>
            <button
              type="button"
              className="fs-overlay__close"
              aria-label={copy.close}
            >
              <Icon className="fs-interaction-icon" decorative name="close" />
            </button>
          </header>
          <div className="fs-overlay__body">{children}</div>
        </aside>
      </div>
    </div>
  );
}
