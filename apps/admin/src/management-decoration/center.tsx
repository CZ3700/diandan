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
import { DisplayOrderWorkspace } from "./display-order-workspace";
import type { DisplayOrderApi } from "./display-order-api";
import { displayOrderCopy } from "./display-order-copy";

type DecorationView = "layout" | "theme" | "navigation" | "order";

export function DecorationCenter({
  themeApi,
  navigationApi,
  displayOrderApi,
  onDirtyChange,
  onBusy,
  ...props
}: ComponentProps<typeof DecorationWorkspace> & {
  themeApi?: StorefrontThemeApi | undefined;
  navigationApi?: StorefrontNavigationApi | undefined;
  displayOrderApi?: DisplayOrderApi | undefined;
}) {
  const [view, setView] = useState<DecorationView>("layout");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = {
    ...decorationNavigationCopy(props.locale),
    navigation: navigationCopy(props.locale).title,
    order: displayOrderCopy(props.locale).tab,
  };
  const tabs: DecorationView[] = ["layout"];
  if (themeApi) tabs.push("theme");
  if (navigationApi) tabs.push("navigation");
  if (displayOrderApi) tabs.push("order");
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
  const choose = (next: DecorationView) => {
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
  if (view === "order" && displayOrderApi)
    workspace = (
      <DisplayOrderWorkspace
        api={displayOrderApi}
        locale={props.locale}
        canPublish={props.canPublish}
        onBusy={changeBusy}
        onDirtyChange={changeDirty}
      />
    );
  else if (view === "navigation" && navigationApi)
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
