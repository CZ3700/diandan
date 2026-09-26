import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SUPPORTED_LOCALES,
  adminOrdersListItemSchema,
} from "@fan-support/contracts";
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
test("order rows show the public number support hears, not the UUID", () => {
  const html = renderToStaticMarkup(
    <views.OrdersListView
      locale="en"
      list={{
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "LIST",
        page: 1,
        pageSize: 12,
        totalItems: 1,
        items: [
          adminOrdersListItemSchema.parse({
            orderId: "10000000-0000-4000-8000-000000000001",
            publicOrderId: "20000000-0000-4000-8000-000000000002",
            publicOrderNo: "FS-7K3M9C",
            version: 1,
            presentationLocale: "en",
            orderStatus: "OPEN",
            paymentStatus: "PAID",
            disputeStatus: "NONE",
            fulfillmentStatus: "PREPARING",
            currency: "USD",
            totalAmountMinor: 1200,
            itemCount: 1,
            pendingReviewCount: 0,
            createdAt: "2026-09-26T00:00:00.000Z",
            updatedAt: "2026-09-26T00:00:00.000Z",
          }),
        ],
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
  expect(html).toContain("<strong>FS-7K3M9C</strong>");
  expect(html).not.toContain("20000000-0000-4000-8000-000000000002");
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
