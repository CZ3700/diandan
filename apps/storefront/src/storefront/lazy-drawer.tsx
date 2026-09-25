"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import type { DrawerProps } from "@fan-support/ui/interactions";

type Pending = { sequence: number; trigger: HTMLButtonElement; touch: boolean };
type LazyDrawerProps = Omit<
  DrawerProps,
  "defaultOpen" | "triggerRef" | "initialFocus" | "open" | "onOpenChange"
> &
  Readonly<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    loadingLabel: string;
    errorLabel: string;
    retryLabel: string;
  }>;

/** The three storefront drawers start closed; the shared primitive keeps all modal behavior. */
export function LazyDrawer({
  open,
  onOpenChange,
  loadingLabel,
  errorLabel,
  retryLabel,
  ...props
}: LazyDrawerProps) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pending = useRef<Pending | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const change = useRef(onOpenChange);
  const pointer = useRef<string | undefined>(undefined);
  const [Control, setControl] = useState<ComponentType<DrawerProps> | null>(
    null,
  );
  const [committed, setCommitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failures, setFailures] = useState(0);
  const [touch, setTouch] = useState(false);
  useLayoutEffect(() => {
    change.current = onOpenChange;
  }, [onOpenChange]);
  const cancel = useCallback((notify = true) => {
    if (!pending.current) return;
    sequence.current++;
    pending.current = null;
    setControl(null);
    setCommitted(false);
    setLoading(false);
    setTouch(false);
    if (notify) change.current(false);
  }, []);
  useLayoutEffect(() => {
    if (!open) {
      cancel(false);
      setTouch(false);
    }
  }, [open, cancel]);
  useEffect(() => {
    mounted.current = true;
    const focus = (event: FocusEvent) => {
      if (pending.current && event.target !== pending.current.trigger) cancel();
    };
    const outside = (event: PointerEvent) => {
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
    const hide = () => cancel();
    document.addEventListener("focusin", focus, true);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("pagehide", hide);
    return () => {
      mounted.current = false;
      sequence.current++;
      pending.current = null;
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("pagehide", hide);
    };
  }, [cancel]);
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
    if (!ownsFocus) {
      change.current(false);
      setCommitted(true);
      return;
    }
    nextTrigger.focus();
    setTouch(request.touch);
    setCommitted(true);
  }, [Control]);

  async function activate(isTouch: boolean) {
    if (pending.current || !trigger.current) return;
    trigger.current.focus();
    const request = {
      sequence: ++sequence.current,
      trigger: trigger.current,
      touch: isTouch,
    };
    pending.current = request;
    setLoading(true);
    change.current(true);
    try {
      const loaded = await import("./lazy-drawer-module");
      if (!mounted.current) return;
      if (
        pending.current?.sequence === request.sequence &&
        document.activeElement !== request.trigger
      )
        cancel();
      if (pending.current?.sequence === request.sequence) {
        setControl(() => loaded.StorefrontDrawer);
        setFailures(0);
      }
    } catch {
      if (mounted.current && pending.current?.sequence === request.sequence) {
        pending.current = null;
        setFailures((value) => value + 1);
        change.current(false);
      }
    } finally {
      if (mounted.current && request.sequence === sequence.current)
        setLoading(false);
    }
  }

  return (
    <>
      {Control && (committed || open) ? (
        <Control
          {...props}
          open={open && committed}
          onOpenChange={(next) => {
            if (!next) setTouch(false);
            change.current(next);
          }}
          triggerRef={trigger}
          {...(touch ? { initialFocus: "popup" } : {})}
        />
      ) : (
        <button
          ref={trigger}
          className="fs-overlay-trigger"
          data-overlay-trigger="drawer"
          data-drawer-load-state={
            loading ? "loading" : failures ? "error" : "idle"
          }
          type="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-expanded={false}
          aria-busy={loading || undefined}
          onPointerDown={(event) => {
            pointer.current = event.pointerType;
          }}
          onKeyDown={() => {
            pointer.current = undefined;
          }}
          onClick={(event) => {
            const touch = event.detail !== 0 && pointer.current === "touch";
            pointer.current = undefined;
            void activate(touch);
          }}
        >
          {props.triggerLabel}
        </button>
      )}
      {loading && (
        <span role="status" className="storefront-sr-only">
          {loadingLabel}
        </span>
      )}
      {!loading && failures > 0 && (
        <div data-drawer-load-failure role="status">
          <p>{errorLabel}</p>
          {failures > 1 ? (
            <a href={window.location.href}>{retryLabel}</a>
          ) : (
            <button
              type="button"
              onClick={() => {
                void activate(false);
              }}
            >
              {retryLabel}
            </button>
          )}
        </div>
      )}
    </>
  );
}
