import { expect, it } from "vitest";

import { soleCommerceScope, withSoleScope } from "./commerce-scope";

const context = (markets: { market: string; currencies: string[] }[]) =>
  ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_CONTEXT",
    markets,
    policies: [],
  }) as never;

it("only exactly one published market with exactly one currency is a scope", () => {
  expect(
    soleCommerceScope(context([{ market: "US", currencies: ["USD"] }])),
  ).toEqual({ market: "US", currency: "USD" });
  for (const markets of [
    [],
    [
      { market: "US", currencies: ["USD"] },
      { market: "JAPAN", currencies: ["JPY"] },
    ],
    [{ market: "GLOBAL", currencies: ["USD", "EUR"] }],
  ])
    expect(soleCommerceScope(context(markets))).toBeUndefined();
  expect(
    soleCommerceScope({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "COMMERCE_UNAVAILABLE",
    } as never),
  ).toBeUndefined();
});

it("a sole scope fills only an unscoped request and never overrides a fan's choice", () => {
  const scope = { market: "US", currency: "USD" } as never;
  expect(withSoleScope({ idol: "a", page: "2" }, scope)).toEqual({
    idol: "a",
    page: "2",
    market: "US",
    currency: "USD",
  });
  for (const values of [
    { market: "JAPAN", currency: "JPY" },
    { market: "US" },
    { currency: "EUR" },
    { market: "not a market!" },
  ])
    expect(withSoleScope(values, scope)).toBe(values);
  const unscoped = { idol: "a" };
  expect(withSoleScope(unscoped, undefined)).toBe(unscoped);
});
