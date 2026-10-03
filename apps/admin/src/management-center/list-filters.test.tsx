import { expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SUPPORTED_LOCALES,
  currencySchema,
  marketSchema,
} from "@fan-support/contracts";
import { Field } from "@fan-support/ui";
import { ManagementWorkspace } from "./workspace";
import type { ManagementApi } from "./api";
import { ManagementArtistSearch, ManagementGiftFilters } from "./list-filters";
import { managementCopy } from "./copy";

const priceScope = {
  market: marketSchema.parse("US"),
  currency: currencySchema.parse("USD"),
};

function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props["children"])];
}

it("keeps the five gift type controls available while the initial list loads", () => {
  const html = renderToStaticMarkup(
    <ManagementWorkspace
      api={{} as ManagementApi}
      locale="zh-CN"
      initialSection="GIFTS"
    />,
  );
  for (const kind of ["ALL", "VIRTUAL", "PHYSICAL", "WISH", "MERCHANDISE"])
    expect(html).toContain(`data-management-gift-kind="${kind}"`);
  expect(html).not.toContain("data-management-gift-sort");
});
it("offers name search to a broker without adding an assignment selector", () => {
  const html = renderToStaticMarkup(
    <ManagementWorkspace
      api={{} as ManagementApi}
      locale="zh-CN"
      artistsOnly
    />,
  );
  expect(html).toContain('data-management-artist-search="true"');
  expect(html).toContain("按名称搜索");
  expect(html).not.toContain('data-management-field="assignment-filter"');
});
it.each(SUPPORTED_LOCALES)(
  "labels all controls and the comparison currency in %s",
  (locale) => {
    const copy = managementCopy(locale);
    const html = renderToStaticMarkup(
      <ManagementGiftFilters
        copy={copy}
        kind="WISH"
        sort="PRICE_ASC"
        disabled={false}
        priceScope={priceScope}
        onKind={() => {}}
        onSort={() => {}}
      />,
    );
    for (const label of [
      copy.allGifts,
      copy.virtual,
      copy.physical,
      copy.wish,
      copy.merchandise,
      copy.priceAscending,
      copy.priceDescending,
    ])
      expect(html).toContain(label);
    expect(html).toContain("USD");
    expect(html.match(/aria-pressed="true"/gu)).toHaveLength(2);
    expect(html).not.toContain('type="submit"');
  },
);
it("toggles a chosen price order back to newest without changing the gift kind", () => {
  const onSort = vi.fn(),
    onKind = vi.fn();
  const nodes = elements(
    ManagementGiftFilters({
      copy: managementCopy("en"),
      kind: "WISH",
      sort: "PRICE_ASC",
      disabled: false,
      priceScope,
      onSort,
      onKind,
    }),
  );
  const ascending = nodes.find(
    (node) => node.props["data-management-price-sort"] === "PRICE_ASC",
  )!;
  (ascending.props["onClick"] as () => void)();
  expect(onSort).toHaveBeenCalledWith("NEWEST");
  expect(onKind).not.toHaveBeenCalled();
  const descending = nodes.find(
    (node) => node.props["data-management-price-sort"] === "PRICE_DESC",
  )!;
  (descending.props["onClick"] as () => void)();
  expect(onSort).toHaveBeenLastCalledWith("PRICE_DESC");
});
it("submits a trimmed name, clears on an empty search, and does not submit during IME composition", () => {
  const onSearch = vi.fn(),
    preventDefault = vi.fn();
  for (const value of ["  Mira  ", "  "]) {
    const nodes = elements(
      ManagementArtistSearch({
        copy: managementCopy("zh-CN"),
        value,
        disabled: false,
        onChange: () => {},
        onSearch,
      }),
    );
    const form = nodes.find((node) => node.type === "form")!;
    (form.props["onSubmit"] as (event: unknown) => void)({ preventDefault });
    expect(onSearch).toHaveBeenLastCalledWith(value.trim());
    const field = nodes.find((node) => node.type === Field)!;
    onSearch.mockClear();
    (field.props["onKeyDown"] as (event: unknown) => void)({
      key: "Enter",
      nativeEvent: { isComposing: true },
      preventDefault,
    });
    expect(onSearch).not.toHaveBeenCalled();
  }
  expect(preventDefault).toHaveBeenCalledTimes(4);
});
