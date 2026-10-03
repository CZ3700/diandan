import { expect, test } from "vitest";
import { navigationTargetHref } from "./navigation-target";

test("global browsing carries only valid public scope and never private or item-specific context", () => {
  const idol = "00000000-0000-4000-8000-000000000007";
  const query = `market=TEST_MARKET&currency=USD&idol=${idol}&variant=secret-variant&page=8&sort=PRICE_DESC&token=private&channel=private&attempt=private`;
  expect(navigationTargetHref("zh-CN", "GIFTS", query)).toBe(
    `/zh-CN/gifts?market=TEST_MARKET&currency=USD&idol=${idol}`,
  );
  expect(navigationTargetHref("zh-CN", "ORDER_LOOKUP", query)).toBe(
    "/zh-CN/orders/lookup",
  );
  expect(
    navigationTargetHref(
      "en",
      "HOME",
      "market=BAD%20VALUE&currency=invalid&idol=not-id",
    ),
  ).toBe("/en");
  expect(
    navigationTargetHref(
      "en",
      "ARTISTS",
      "market=TEST_MARKET&market=OTHER&currency=USD&currency=EUR",
    ),
  ).toBe("/en/idols");
});
