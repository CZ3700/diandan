import { expect, test, vi } from "vitest";
import {
  giftDiscoveryQuerySchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import copy from "../../../../packages/i18n/src/storefront/en";
import { GiftFilters } from "./gift-filters";
import { formatGiftPriceInput, giftResetHref } from "./gift-query";

vi.mock("server-only", () => ({}));

test.each(SUPPORTED_LOCALES)(
  "%s filters prepare their initial presentation on the server",
  (locale) => {
    const query = giftDiscoveryQuerySchema.parse({
      schemaVersion: 1,
      locale,
      market: "TEST",
      currency: "USD",
      priceMinMinor: 1234,
      priceMaxMinor: 4321,
      page: 3,
    });
    const contextQuery = "market=TEST&currency=USD&cart=one&cart=two&page=3";
    // RSC invokes the server wrapper without a client hook dispatcher. The
    // returned client boundary only needs serializable presentation and query.
    const boundary = GiftFilters({
      locale,
      copy,
      query,
      contextQuery,
      basePath: "/gifts",
    });
    expect(boundary.props.initialDraft).toEqual({
      sort: query.sort,
      category: "",
      availability: query.availability,
      minimum: formatGiftPriceInput(
        query.priceMinMinor,
        locale,
        query.currency,
      ),
      maximum: formatGiftPriceInput(
        query.priceMaxMinor,
        locale,
        query.currency,
      ),
    });
    expect(boundary.props.resetHref).toBe(
      giftResetHref(query, "/gifts", contextQuery),
    );
    expect(boundary.props.hint).toContain("USD");
    expect(JSON.parse(JSON.stringify(boundary.props))).toEqual(boundary.props);
  },
);
