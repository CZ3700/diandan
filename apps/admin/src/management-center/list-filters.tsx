import { Button, Field, Icon } from "@fan-support/ui";
import type { ManagementContext, ManagementListOptions } from "./api";
import type { ManagementCopy } from "./copy";
import { giftKindLabel } from "./form-fields";

type GiftKind = NonNullable<ManagementListOptions["giftKind"]>;
type GiftSort = NonNullable<ManagementListOptions["sort"]>;

export function ManagementGiftFilters({
  copy,
  kind,
  sort,
  priceScope,
  disabled,
  onKind,
  onSort,
}: {
  copy: ManagementCopy;
  kind: GiftKind | null;
  sort: GiftSort;
  priceScope: NonNullable<ManagementContext["defaults"]>["priceScope"];
  disabled: boolean;
  onKind: (kind: GiftKind | null) => void;
  onSort: (sort: GiftSort) => void;
}) {
  const kinds = [null, "VIRTUAL", "PHYSICAL", "WISH", "MERCHANDISE"] as const;
  return (
    <div className="mc-gift-filters">
      <div className="mc-gift-kinds" role="group" aria-label={copy.kind}>
        {kinds.map((value) => (
          <button
            key={value ?? "ALL"}
            type="button"
            data-management-gift-kind={value ?? "ALL"}
            aria-pressed={kind === value}
            disabled={disabled}
            onClick={() => onKind(value)}
          >
            {value === null ? copy.allGifts : giftKindLabel(value, copy)}
          </button>
        ))}
      </div>
      {priceScope ? (
        <div
          className="mc-gift-sort"
          role="group"
          aria-label={copy.priceOrder}
          data-management-gift-sort
        >
          <span>
            {copy.price} · {priceScope.currency}
          </span>
          {(["PRICE_ASC", "PRICE_DESC"] as const).map((value) => (
            <button
              key={value}
              type="button"
              data-management-price-sort={value}
              aria-label={
                value === "PRICE_ASC"
                  ? copy.priceAscending
                  : copy.priceDescending
              }
              title={
                value === "PRICE_ASC"
                  ? copy.priceAscending
                  : copy.priceDescending
              }
              aria-pressed={sort === value}
              disabled={disabled}
              onClick={() => onSort(sort === value ? "NEWEST" : value)}
            >
              <Icon
                name={
                  value === "PRICE_ASC" ? "sort-ascending" : "sort-descending"
                }
                decorative
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Name search applies on submit; composing a name never submits an incomplete word. */
export function ManagementArtistSearch({
  copy,
  value,
  disabled,
  onChange,
  onSearch,
}: {
  copy: ManagementCopy;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
}) {
  return (
    <form
      className="mc-artist-search"
      role="search"
      data-management-artist-search
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onSearch(value.trim());
      }}
    >
      <Field
        id="management-artist-search"
        name="search"
        type="search"
        label={copy.search}
        placeholder={copy.searchPlaceholder}
        value={value}
        maxLength={80}
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.nativeEvent.isComposing)
            event.preventDefault();
        }}
      />
      <Button type="submit" variant="secondary" disabled={disabled}>
        {copy.search}
      </Button>
    </form>
  );
}
