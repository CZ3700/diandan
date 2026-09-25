"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from "react";
import {
  LOCALE_NATIVE_NAMES,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Icon } from "@fan-support/ui";
import type { LanguageControlProps } from "@fan-support/ui/interactions";

type Opening = "first" | "last" | undefined;
type Pending = { sequence: number; trigger: HTMLButtonElement; edge: Opening };

export function HeaderLanguage({
  locale,
  label,
  loadingLabel,
  errorLabel,
  retryLabel,
  onValueChange,
  cancelRef,
}: Readonly<{
  locale: SupportedLocale;
  label: string;
  loadingLabel: string;
  errorLabel: string;
  retryLabel: string;
  onValueChange: (locale: SupportedLocale) => void;
  cancelRef?: RefObject<(() => void) | null>;
}>) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pending = useRef<Pending | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const [Control, setControl] =
    useState<ComponentType<LanguageControlProps> | null>(null);
  const [loading, setLoading] = useState(false);
  const [failures, setFailures] = useState(0);
  const [open, setOpen] = useState(false);
  const [edge, setEdge] = useState<Opening>(undefined);
  const [hydrated, setHydrated] = useState(false);
  const cancel = useCallback(() => {
    sequence.current++;
    if (pending.current) setControl(null);
    pending.current = null;
    setLoading(false);
    setOpen(false);
    setEdge(undefined);
  }, []);

  useEffect(() => {
    mounted.current = true;
    setHydrated(true);
    if (cancelRef) cancelRef.current = cancel;
    const focus = (event: FocusEvent) => {
      if (pending.current && event.target !== pending.current.trigger) cancel();
    };
    const pointer = (event: PointerEvent) => {
      if (
        pending.current &&
        event.target !== pending.current.trigger &&
        !pending.current.trigger.contains(event.target as Node | null)
      )
        cancel();
    };
    const key = (event: KeyboardEvent) => {
      if (pending.current && (event.key === "Escape" || event.key === "Tab"))
        cancel();
    };
    document.addEventListener("focusin", focus, true);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("pagehide", cancel);
    return () => {
      mounted.current = false;
      sequence.current++;
      pending.current = null;
      if (cancelRef?.current === cancel) cancelRef.current = null;
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("pagehide", cancel);
    };
  }, [cancel, cancelRef, locale]);

  useLayoutEffect(() => {
    const request = pending.current;
    const nextTrigger = trigger.current;
    if (
      !Control ||
      !request ||
      !nextTrigger ||
      request.sequence !== sequence.current
    )
      return;
    const active = document.activeElement;
    const ownsFocus =
      active === request.trigger ||
      (active === document.body && !request.trigger.isConnected);
    pending.current = null;
    if (!ownsFocus) return;
    // The old button was replaced by the loaded primitive; verify focus again at commit.
    nextTrigger.focus();
    setEdge(request.edge);
    setOpen(true);
  }, [Control]);

  async function activate(opening: Opening) {
    if (pending.current || !trigger.current) return;
    trigger.current.focus();
    const request = {
      sequence: ++sequence.current,
      trigger: trigger.current,
      edge: opening,
    };
    pending.current = request;
    setLoading(true);
    try {
      const loaded = await import("./site-header-language-menu");
      if (!mounted.current) return;
      const current = pending.current;
      if (
        current?.sequence === request.sequence &&
        document.activeElement !== request.trigger
      ) {
        cancel();
      }
      // A cancelled activation must not replace a still-focused native button.
      // The module loader retains the successful download for the next activation.
      if (pending.current?.sequence === request.sequence) {
        setControl(() => loaded.HeaderLanguageMenu);
        setFailures(0);
      }
    } catch {
      if (mounted.current && pending.current?.sequence === request.sequence) {
        pending.current = null;
        setFailures((value) => value + 1);
      }
    } finally {
      if (mounted.current && request.sequence === sequence.current)
        setLoading(false);
    }
  }

  return (
    <div
      data-storefront-language
      data-language-state={
        Control
          ? open
            ? "open"
            : "ready"
          : loading
            ? "loading"
            : failures
              ? "error"
              : "idle"
      }
    >
      {Control ? (
        <Control
          label={label}
          value={locale}
          onValueChange={onValueChange}
          open={open}
          triggerRef={trigger}
          {...(edge ? { initialFocus: edge } : {})}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setEdge(undefined);
          }}
        />
      ) : (
        <button
          ref={trigger}
          type="button"
          tabIndex={0}
          aria-haspopup="menu"
          aria-expanded={hydrated ? false : undefined}
          className="fs-menu__trigger"
          aria-busy={loading || undefined}
          onClick={() => {
            void activate(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              void activate(event.key === "ArrowUp" ? "last" : "first");
            }
          }}
        >
          <span className="fs-menu__trigger-copy">
            <span className="fs-menu__label">{label}</span>
            <span className="fs-menu__value">
              {LOCALE_NATIVE_NAMES[locale]}
            </span>
          </span>
          <span aria-hidden="true" className="fs-menu__chevron">
            <Icon
              className="fs-interaction-icon"
              decorative
              name="chevron-down"
            />
          </span>
        </button>
      )}
      {loading && (
        <span role="status" className="storefront-sr-only">
          {loadingLabel}
        </span>
      )}
      {!loading && failures > 0 && (
        <div role="status">
          <p>{errorLabel}</p>
          {failures > 1 ? (
            <a href={window.location.href}>{retryLabel}</a>
          ) : (
            <button
              type="button"
              onClick={() => {
                void activate(undefined);
              }}
            >
              {retryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
