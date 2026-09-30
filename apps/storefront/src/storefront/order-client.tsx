"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  normalizePublicOrderNo,
  publicOrderIdSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { createOrderController } from "./order-controller";
import { parseOrderFragment } from "./order-fragment";
import { OrderDetail } from "./order-detail";
import { OrderFeedback } from "./order-feedback";
import { storefrontHref } from "./navigation";
export type OrderPageMode = "lookup" | "exchange" | "detail" | "thank-you";
type EntryWindow = Window & { __fanOrderEntry?: () => string | null };
export function OrderClient({
  locale,
  copy,
  mode,
  publicOrderId,
  invalid = false,
}: {
  locale: SupportedLocale;
  copy: StorefrontCopy;
  mode: OrderPageMode;
  publicOrderId?: string;
  invalid?: boolean;
}) {
  const [controller] = useState(() => createOrderController());
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  const knownId = useRef(publicOrderId);
  const [lookupId, setLookupId] = useState("");
  const [invalidId, setInvalidId] = useState(false);
  useEffect(() => {
    let live = true;
    async function initialize() {
      if (!live) return;
      if (invalid) {
        controller.invalidate();
        return;
      }
      if (knownId.current) {
        await controller.read(knownId.current);
        return;
      }
      if (mode === "exchange") {
        const entryWindow = window as EntryWindow;
        const entry = parseOrderFragment(
          entryWindow.__fanOrderEntry?.() ?? null,
        );
        delete entryWindow.__fanOrderEntry;
        if (!entry) {
          controller.invalidate();
          return;
        }
        knownId.current = entry.publicOrderId;
        await controller.exchange(entry);
      }
    }
    const hide = () => {
      controller.suspend();
    };
    const visible = () => {
      if (document.visibilityState === "hidden") hide();
      else void controller.resume();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) void controller.resume();
    };
    const focus = () => {
      if (document.visibilityState === "visible" && knownId.current)
        void controller.retry();
    };
    void Promise.resolve().then(initialize);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(focus, 60_000);
    return () => {
      live = false;
      controller.dispose();
      window.clearInterval(timer);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [controller, invalid, locale, mode]);
  useEffect(() => {
    if (mode === "exchange" && state.order)
      window.location.replace(
        storefrontHref(locale, `/orders/${state.order.publicOrderId}`),
      );
  }, [locale, mode, state.order]);
  return (
    <div
      className="storefront-section order-page"
      data-order-root
      data-order-id={state.order?.publicOrderId}
    >
      <h1>
        {mode === "lookup"
          ? copy.orderLookupTitle
          : mode === "thank-you" && state.order
            ? copy.orderThankYou
            : copy.orderTitle}
      </h1>
      {mode === "lookup" && (
        <>
          <p>{copy.orderLookupHelp}</p>
          <form
            className="order-lookup"
            data-order-lookup
            onSubmit={(event) => {
              event.preventDefault();
              const typed = lookupId.trim();
              const id = publicOrderIdSchema.safeParse(typed);
              if (id.success) {
                window.location.assign(
                  storefrontHref(locale, `/orders/${id.data}`),
                );
                return;
              }
              // A public number is resolved through this browser's order session only.
              const number = normalizePublicOrderNo(typed);
              if (!number) {
                setInvalidId(true);
                return;
              }
              void controller.locate(number).then((located) => {
                if (located)
                  window.location.assign(
                    storefrontHref(locale, `/orders/${located}`),
                  );
              });
            }}
          >
            <label htmlFor="order-id">{copy.orderIdLabel}</label>
            <input
              id="order-id"
              name="orderId"
              value={lookupId}
              onChange={(event) => {
                setLookupId(event.currentTarget.value);
                setInvalidId(false);
              }}
              autoComplete="off"
              spellCheck={false}
              required
              maxLength={100}
              aria-invalid={invalidId}
              aria-describedby={invalidId ? "order-id-error" : undefined}
            />
            {invalidId && (
              <p id="order-id-error" role="alert">
                {copy.orderLinkInvalid}
              </p>
            )}
            <button
              type="submit"
              className="storefront-primary"
              data-order-open
              disabled={state.busy}
            >
              {copy.orderOpen}
            </button>
          </form>
          <a
            className="storefront-secondary"
            href={storefrontHref(locale, "/checkout")}
          >
            {copy.orderView}
          </a>
        </>
      )}
      <OrderFeedback
        state={state}
        locale={locale}
        copy={copy}
        onRetry={() => {
          void controller.retry();
        }}
      />
      {state.order && (
        <>
          <OrderDetail
            order={state.order}
            locale={locale}
            copy={copy}
            onWithdrawWish={(id) => controller.withdrawWish(id)}
          />
          <div className="order-actions">
            <button
              type="button"
              className="storefront-secondary"
              data-order-retry
              disabled={state.busy}
              onClick={() => {
                void controller.retry();
              }}
            >
              {copy.checkoutRefresh}
            </button>
            <button
              type="button"
              className="storefront-secondary"
              data-order-revoke
              disabled={state.busy}
              onClick={() => {
                void controller.revoke();
              }}
            >
              {copy.orderRevoke}
            </button>
          </div>
        </>
      )}
      <a
        className="storefront-secondary"
        href={storefrontHref(locale, "/gifts")}
      >
        {copy.orderBack}
      </a>
    </div>
  );
}
