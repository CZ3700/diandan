import assert from "node:assert/strict";
import { test } from "node:test";
import { orderReadRoute } from "./order-storefront-recovery.mjs";

test("network fault targets the same canonical order for lower and uppercase UUID paths", () => {
  const id = "12345678-abcd-4abc-8abc-123456789abc";
  const match = orderReadRoute(id);
  assert.equal(
    match.test(
      `https://storefront.example.invalid/api/storefront/orders/${id}`,
    ),
    true,
  );
  assert.equal(
    match.test(
      `https://storefront.example.invalid/api/storefront/orders/${id.toUpperCase()}`,
    ),
    true,
  );
  assert.equal(
    match.test(
      `https://storefront.example.invalid/api/storefront/orders/${id}?extra=1`,
    ),
    false,
  );
  assert.equal(
    match.test(
      "https://storefront.example.invalid/api/storefront/orders/12345678-abcd-4abc-8abc-123456789abd",
    ),
    false,
  );
});
