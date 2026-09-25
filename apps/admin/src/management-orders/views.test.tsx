import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import * as views from "./list-view";
import * as messages from "./copy";
test("order lists offer semantic search, independent filters and bounded pagination in every language", () => {
  expect(views.OrdersListView).toBeTypeOf("function");
  for (const locale of SUPPORTED_LOCALES) {
    const html = renderToStaticMarkup(
      <views.OrdersListView
        locale={locale}
        list={{
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "LIST",
          page: 1,
          pageSize: 12,
          totalItems: 13,
          items: [],
        }}
        filters={{
          page: 1,
          pageSize: 12,
          query: "",
          fulfillment: "ALL",
          moderation: "ALL",
        }}
        busy={false}
        onFilters={() => {}}
        onSelect={() => {}}
        onPage={() => {}}
      />,
    );
    expect(html).toContain("data-orders-search");
    expect(html).toContain("data-orders-next");
    expect(html).toContain("data-orders-fulfillment");
    expect(html).not.toContain("supportIntentId");
  }
});
test("seven order vocabularies contain equal complete keys", () => {
  expect(messages.ordersCopy).toBeTypeOf("function");
  const keys = Object.keys(messages.ordersCopy("en")).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const copy = messages.ordersCopy(locale);
    expect(Object.keys(copy).sort()).toEqual(keys);
    expect(
      Object.values(copy).every(
        (value) => typeof value === "string" && value.length > 0,
      ),
    ).toBe(true);
  }
});
