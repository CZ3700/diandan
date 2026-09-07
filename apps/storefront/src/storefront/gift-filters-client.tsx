"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Field } from "@fan-support/ui";
import { Drawer } from "@fan-support/ui/interactions";
import type { GiftDiscoveryQuery } from "@fan-support/contracts";
import type {
  GiftFilterDraft,
  GiftFilterClientProps,
} from "./gift-filter-types";

export function GiftFiltersClient({
  locale,
  copy,
  query,
  contextQuery,
  basePath,
  initialDraft,
  resetHref,
  recoveryHref,
  hint,
}: GiftFilterClientProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState<{ minimum?: string; maximum?: string }>(
    {},
  );
  const composing = useRef(false);
  const operation = useRef(0);
  const pending = useRef(false);
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState(false);
  const cancelApply = () => {
    operation.current += 1;
    pending.current = false;
    setApplying(false);
    setFailure(false);
  };
  const updateDraft = (next: GiftFilterDraft) => {
    cancelApply();
    setDraft(next);
  };
  useEffect(
    () => () => {
      operation.current += 1;
      pending.current = false;
    },
    [],
  );
  useEffect(() => {
    const navigation = window.performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    let frame: number | undefined;
    const restore = () => {
      // Invalidate before yielding: a pending chunk may finish before the frame.
      operation.current += 1;
      pending.current = false;
      setApplying(false);
      setFailure(false);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      // History can restore native select values after pageshow, even without
      // BFCache. Reapply the URL's filters after that browser restoration.
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        setDraft(initialDraft);
        setErrors({});
        setOpen(false);
        composing.current = false;
      });
    };
    const pageShow = (event: PageTransitionEvent) => {
      if (event.persisted || navigation?.type === "back_forward") restore();
    };
    window.addEventListener("pageshow", pageShow);
    // Hydration can subscribe after this document's pageshow event.
    if (navigation?.type === "back_forward") restore();
    return () => {
      window.removeEventListener("pageshow", pageShow);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [initialDraft]);
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composing.current || pending.current) return;
    const form = event.currentTarget;
    const request = ++operation.current;
    pending.current = true;
    setApplying(true);
    setFailure(false);
    try {
      const { validateGiftFilterDraft } =
        await import("./gift-filter-validation");
      if (request !== operation.current) return;
      const result = validateGiftFilterDraft(
        draft,
        locale,
        query,
        basePath,
        contextQuery,
      );
      if (result.kind === "INVALID") {
        const nextErrors = {
          ...(result.minimum ? { minimum: copy.giftPriceInvalid } : {}),
          ...(result.maximum
            ? {
                maximum:
                  result.maximum === "RANGE"
                    ? copy.giftPriceRangeInvalid
                    : copy.giftPriceInvalid,
              }
            : {}),
        };
        setErrors(nextErrors);
        const input = form.elements.namedItem(
          nextErrors.minimum ? "priceMinimum" : "priceMaximum",
        );
        if (input instanceof HTMLInputElement) input.focus();
        return;
      }
      setErrors({});
      window.location.assign(result.href);
    } catch {
      if (request === operation.current) setFailure(true);
    } finally {
      if (request === operation.current) {
        pending.current = false;
        setApplying(false);
      }
    }
  }

  function form(surface: "desktop" | "mobile") {
    const prefix = `${id}-${surface}`;
    return (
      <form
        className={`gift-filter-form gift-filter-form--${surface}`}
        data-gift-filters={surface}
        onSubmit={(event) => {
          void apply(event);
        }}
        onCompositionStart={() => {
          cancelApply();
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (composing.current ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229)
          )
            event.preventDefault();
        }}
      >
        <div className="gift-filter-selects">
          <label className="gift-filter-select" htmlFor={`${prefix}-sort`}>
            <span>{copy.giftSortLabel}</span>
            <select
              id={`${prefix}-sort`}
              data-gift-sort
              value={draft.sort}
              onChange={(event) =>
                updateDraft({
                  ...draft,
                  sort: event.target.value as GiftDiscoveryQuery["sort"],
                })
              }
            >
              <option value="RECOMMENDED">{copy.giftSortRecommended}</option>
              <option value="PRICE_ASC">{copy.giftSortPriceAsc}</option>
              <option value="PRICE_DESC">{copy.giftSortPriceDesc}</option>
            </select>
          </label>
          <label className="gift-filter-select" htmlFor={`${prefix}-category`}>
            <span>{copy.giftCategoryLabel}</span>
            <select
              id={`${prefix}-category`}
              data-gift-category
              value={draft.category}
              onChange={(event) =>
                updateDraft({ ...draft, category: event.target.value })
              }
            >
              <option value="">{copy.giftCategoryAll}</option>
              <option value="FLOWERS">{copy.giftCategoryFlowers}</option>
              <option value="FOOD">{copy.giftCategoryFood}</option>
              <option value="BEAUTY">{copy.giftCategoryBeauty}</option>
              <option value="ACCESSORY">{copy.giftCategoryAccessory}</option>
              <option value="OTHER">{copy.giftCategoryOther}</option>
            </select>
          </label>
          <label
            className="gift-filter-select"
            htmlFor={`${prefix}-availability`}
          >
            <span>{copy.giftAvailabilityLabel}</span>
            <select
              id={`${prefix}-availability`}
              data-gift-availability
              value={draft.availability}
              onChange={(event) =>
                updateDraft({
                  ...draft,
                  availability: event.target
                    .value as GiftDiscoveryQuery["availability"],
                })
              }
            >
              <option value="ALL">{copy.giftAvailabilityAll}</option>
              <option value="PURCHASABLE">
                {copy.giftAvailabilityPurchasable}
              </option>
              <option value="UNAVAILABLE">
                {copy.giftAvailabilityUnavailable}
              </option>
            </select>
          </label>
        </div>
        <fieldset className="gift-filter-prices">
          <legend>
            {copy.giftPriceRangeLabel} <span>({query.currency})</span>
          </legend>
          <p className="gift-filter-hint" id={`${prefix}-price-hint`}>
            {hint}
          </p>
          <div className="gift-filter-price-inputs">
            <Field
              id={`${prefix}-minimum`}
              name="priceMinimum"
              label={copy.giftPriceMinimum}
              inputMode="decimal"
              autoComplete="off"
              value={draft.minimum}
              data-gift-price-min
              data-amount-minor={query.priceMinMinor}
              aria-describedby={`${prefix}-price-hint`}
              error={errors.minimum}
              onChange={(event) =>
                updateDraft({ ...draft, minimum: event.target.value })
              }
            />
            <Field
              id={`${prefix}-maximum`}
              name="priceMaximum"
              label={copy.giftPriceMaximum}
              inputMode="decimal"
              autoComplete="off"
              value={draft.maximum}
              data-gift-price-max
              data-amount-minor={query.priceMaxMinor}
              aria-describedby={`${prefix}-price-hint`}
              error={errors.maximum}
              onChange={(event) =>
                updateDraft({ ...draft, maximum: event.target.value })
              }
            />
          </div>
        </fieldset>
        {failure && (
          <div data-gift-filter-recovery>
            <p role="alert">
              {copy.contentError} {copy.contentErrorBody}
            </p>
            <a className="storefront-text-link" href={recoveryHref}>
              {copy.artistRetry}
            </a>
          </div>
        )}
        <div className="gift-filter-actions">
          <Button
            type="submit"
            data-gift-apply
            disabled={applying}
            aria-busy={applying || undefined}
          >
            {copy.giftApplyFilters}
          </Button>
          <a
            className="storefront-text-link"
            href={resetHref}
            onClick={cancelApply}
            data-gift-reset
          >
            {copy.giftResetFilters}
          </a>
        </div>
      </form>
    );
  }

  return (
    <div className="gift-filters">
      <div className="gift-filters__desktop">{form("desktop")}</div>
      <div className="gift-filters__mobile">
        <Drawer
          title={copy.giftFilters}
          description={copy.giftFiltersDescription}
          triggerLabel={copy.giftFilters}
          closeLabel={copy.close}
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            cancelApply();
            setDraft(initialDraft);
            setErrors({});
            composing.current = false;
          }}
        >
          {form("mobile")}
        </Drawer>
      </div>
    </div>
  );
}
