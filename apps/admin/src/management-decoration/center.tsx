"use client";
import { useCallback, useState, type ComponentProps } from "react";
import { DecorationWorkspace } from "./workspace";
import { ThemeWorkspace } from "./theme-workspace";
import { decorationNavigationCopy } from "./theme-copy";
import type { StorefrontThemeApi } from "./theme-api";
import { canLeaveDecoration } from "./navigation";
import { decorationCopy } from "./copy";

export function DecorationCenter({
  themeApi,
  onDirtyChange,
  onBusy,
  ...props
}: ComponentProps<typeof DecorationWorkspace> & {
  themeApi?: StorefrontThemeApi | undefined;
}) {
  const [view, setView] = useState<"layout" | "theme">("layout");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = decorationNavigationCopy(props.locale);
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
  const choose = (next: "layout" | "theme") => {
    if (
      view !== next &&
      canLeaveDecoration({ busy, dirty }, () => window.confirm(copy.discard))
    )
      setView(next);
  };
  return (
    <>
      {themeApi && (
        <nav
          className="decoration-tabs"
          aria-label={decorationCopy(props.locale).title}
        >
          {(["layout", "theme"] as const).map((value) => (
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
      {view === "theme" && themeApi ? (
        <ThemeWorkspace
          {...props}
          api={themeApi}
          onDirtyChange={changeDirty}
          onBusy={changeBusy}
        />
      ) : (
        <DecorationWorkspace
          {...props}
          onDirtyChange={changeDirty}
          onBusy={changeBusy}
        />
      )}
    </>
  );
}
