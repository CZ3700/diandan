"use client";
import { useCallback, useState, type ComponentProps } from "react";
import { DecorationWorkspace } from "./workspace";
import { NavigationWorkspace } from "./navigation-workspace";
import type { StorefrontNavigationApi } from "./navigation-api";
import { navigationCopy } from "./navigation-copy";
import { ThemeWorkspace } from "./theme-workspace";
import { decorationNavigationCopy } from "./theme-copy";
import type { StorefrontThemeApi } from "./theme-api";
import { canLeaveDecoration } from "./navigation";
import { decorationCopy } from "./copy";

export function DecorationCenter({
  themeApi,
  navigationApi,
  onDirtyChange,
  onBusy,
  ...props
}: ComponentProps<typeof DecorationWorkspace> & {
  themeApi?: StorefrontThemeApi | undefined;
  navigationApi?: StorefrontNavigationApi | undefined;
}) {
  const [view, setView] = useState<"layout" | "theme" | "navigation">("layout");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = {
    ...decorationNavigationCopy(props.locale),
    navigation: navigationCopy(props.locale).title,
  };
  const tabs: ("layout" | "theme" | "navigation")[] = ["layout"];
  if (themeApi) tabs.push("theme");
  if (navigationApi) tabs.push("navigation");
  const changeDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirtyChange(value);
    },
    [onDirtyChange],
  );
  const changeBusy = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusy(value);
    },
    [onBusy],
  );
  const choose = (next: "layout" | "theme" | "navigation") => {
    if (
      view !== next &&
      canLeaveDecoration({ busy, dirty }, () => window.confirm(copy.discard))
    )
      setView(next);
  };
  const sharedProps = {
    ...props,
    onDirtyChange: changeDirty,
    onBusy: changeBusy,
  };
  let workspace = <DecorationWorkspace {...sharedProps} />;
  if (view === "navigation" && navigationApi)
    workspace = <NavigationWorkspace {...sharedProps} api={navigationApi} />;
  else if (view === "theme" && themeApi)
    workspace = <ThemeWorkspace {...sharedProps} api={themeApi} />;
  return (
    <>
      {tabs.length > 1 && (
        <nav
          className="decoration-tabs"
          aria-label={decorationCopy(props.locale).title}
        >
          {tabs.map((value) => (
            <button
              key={value}
              type="button"
              data-decoration-tab={value}
              aria-pressed={view === value}
              disabled={busy}
              onClick={() => choose(value)}
            >
              {copy[value]}
            </button>
          ))}
        </nav>
      )}
      {workspace}
    </>
  );
}
