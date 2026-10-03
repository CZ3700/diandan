import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type WishGiftSummary,
} from "@fan-support/contracts";
import type { ReactNode } from "react";
import type { ManagementContext } from "./api";
import type { ManagementCopy } from "./copy";
import type { ContentDraft, FormErrors } from "./form-model";

export function ManagementSelect({
  name,
  label,
  value,
  onChange,
  children,
  error,
  disabled,
  description,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  error?: string;
  disabled?: boolean;
  description?: string | undefined;
}) {
  return (
    <div className="mc-field">
      <label htmlFor={`management-${name}`}>{label}</label>
      <select
        id={`management-${name}`}
        data-management-field={name}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={
          [
            error ? `management-${name}-error` : "",
            description ? `management-${name}-description` : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
      >
        {children}
      </select>
      {description ? (
        <p id={`management-${name}-description`} className="mc-hint">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`management-${name}-error`} className="mc-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function giftKindLabel(
  kind: ContentDraft["giftKind"],
  copy: ManagementCopy,
) {
  switch (kind) {
    case "VIRTUAL":
      return copy.virtual;
    case "PHYSICAL":
      return copy.physical;
    case "WISH":
      return copy.wish;
    case "MERCHANDISE":
      return copy.merchandise;
    case "OTHER":
      return copy.other;
  }
}
export function wishStatusLabel(
  status: WishGiftSummary["status"],
  copy: ManagementCopy,
) {
  const keys = {
    AVAILABLE: "wishAvailable",
    RESERVED: "wishReserved",
    SUPPORTED: "wishSupported",
    UNAVAILABLE: "wishUnavailable",
  } as const;
  return copy[keys[status]];
}
function categoryLabel(
  category: ContentDraft["category"],
  copy: ManagementCopy,
) {
  switch (category) {
    case "FLOWERS":
      return copy.flowers;
    case "FOOD":
      return copy.food;
    case "BEAUTY":
      return copy.beauty;
    case "ACCESSORY":
      return copy.accessory;
    case "OTHER":
      return copy.other;
  }
}
export function ContentOptions({
  draft,
  update,
  copy,
  context,
  gift,
  errors,
  inventoryPolicyLocked,
  commerceScopeLocked = false,
}: {
  draft: ContentDraft;
  update: (patch: Partial<ContentDraft>) => void;
  copy: ManagementCopy;
  context: ManagementContext;
  gift: boolean;
  errors: FormErrors;
  inventoryPolicyLocked: boolean;
  commerceScopeLocked?: boolean;
}) {
  return (
    <details
      className="mc-options"
      open={
        Boolean(
          errors.quantity || errors.locationId || errors.price === "noMarket",
        ) || undefined
      }
    >
      <summary>{copy.options}</summary>
      <div className="mc-options-body">
        <ManagementSelect
          name="sourceLocale"
          label={copy.sourceLanguage}
          value={draft.sourceLocale}
          onChange={(value) =>
            update({ sourceLocale: value as ContentDraft["sourceLocale"] })
          }
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {LOCALE_NATIVE_NAMES[locale]}
            </option>
          ))}
        </ManagementSelect>
        {gift ? (
          <>
            <div className="mc-field-pair">
              <ManagementSelect
                name="market"
                label={copy.market}
                value={draft.market}
                disabled={commerceScopeLocked}
                onChange={(value) =>
                  update({
                    market: value,
                    currency:
                      context.markets.find((entry) => entry.market === value)
                        ?.currencies[0] ?? "",
                    price: "",
                  })
                }
              >
                <option value="">—</option>
                {commerceScopeLocked &&
                !context.markets.some(
                  (entry) => entry.market === draft.market,
                ) ? (
                  <option value={draft.market}>{draft.market}</option>
                ) : null}
                {context.markets.map((entry) => (
                  <option key={entry.market} value={entry.market}>
                    {entry.market}
                  </option>
                ))}
              </ManagementSelect>
              <ManagementSelect
                name="currency"
                label={copy.currency}
                value={draft.currency}
                disabled={commerceScopeLocked}
                onChange={(value) => update({ currency: value, price: "" })}
              >
                <option value="">—</option>
                {commerceScopeLocked &&
                !context.markets
                  .find((entry) => entry.market === draft.market)
                  ?.currencies.some(
                    (currency) => currency === draft.currency,
                  ) ? (
                  <option value={draft.currency}>{draft.currency}</option>
                ) : null}
                {context.markets
                  .find((entry) => entry.market === draft.market)
                  ?.currencies.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
              </ManagementSelect>
            </div>
            <ManagementSelect
              name="category"
              label={copy.category}
              value={draft.category}
              onChange={(value) =>
                update({ category: value as ContentDraft["category"] })
              }
            >
              {context.categories.map((category) => (
                <option key={category} value={category}>
                  {categoryLabel(category, copy)}
                </option>
              ))}
            </ManagementSelect>
            {draft.giftKind !== "WISH" ? (
              <ManagementSelect
                name="policy"
                label={copy.inventory}
                value={draft.policy}
                disabled={inventoryPolicyLocked}
                description={
                  inventoryPolicyLocked ? copy.inventoryPolicyLocked : undefined
                }
                onChange={(value) =>
                  update({ policy: value as ContentDraft["policy"] })
                }
              >
                <option value="PROCURE_ON_DEMAND">{copy.madeToOrder}</option>
                <option value="TRACKED">{copy.tracked}</option>
                <option value="PREORDER">{copy.preorder}</option>
              </ManagementSelect>
            ) : null}
            {draft.giftKind !== "WISH" && draft.policy === "TRACKED" ? (
              <div className="mc-field">
                <label htmlFor="management-quantity">{copy.quantity}</label>
                <input
                  id="management-quantity"
                  data-management-field="quantity"
                  value={draft.quantity}
                  inputMode="numeric"
                  onChange={(event) =>
                    update({ quantity: event.currentTarget.value })
                  }
                  aria-invalid={Boolean(errors.quantity || errors.locationId)}
                  aria-describedby={
                    errors.quantity || errors.locationId
                      ? "management-quantity-error"
                      : undefined
                  }
                />
                {errors.quantity || errors.locationId ? (
                  <p
                    id="management-quantity-error"
                    role="alert"
                    className="mc-error"
                  >
                    {copy[errors.quantity ?? errors.locationId!]}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
