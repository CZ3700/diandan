import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";

const source = readFileSync(
  new URL("../infra/opentofu/modules/edge/main.tf", import.meta.url),
  "utf8",
);
function routes() {
  const match =
    /operation_rate_routes\s*=\s*jsondecode\(<<-ROUTES\n([\s\S]*?)\n\s*ROUTES\s*\)/u.exec(
      source,
    );
  assert.ok(match, "edge must define operation-specific request scopes");
  return JSON.parse(match[1]);
}
const cases = {
  LOGIN: [
    ["POST", "/api/admin/auth/begin"],
    ["GET", "/api/admin/auth/callback"],
    ["POST", "/api/v1/admin/access/begin"],
    ["POST", "/api/v1/admin/access/callback"],
    ["POST", "/api/admin/local-auth/login"],
    ["POST", "/api/admin/local-auth/step"],
    ["POST", "/api/v1/admin/local-access/login"],
    ["POST", "/api/v1/admin/local-access/step"],
    ["POST", "/api/v1/admin/local-access/logout"],
  ],
  ORDER_ACCESS: [
    ["POST", "/api/storefront/order-access/exchange"],
    ["POST", "/api/v1/order-access/revoke"],
    ["POST", "/api/storefront/checkout/sessions/test-id/order-access"],
    ["GET", "/api/v1/orders/test-order"],
    ["POST", "/api/v1/order-access/locate"],
    [
      "GET",
      "/api/storefront/orders/test-order/delivery-proofs/test-proof/thumbnail",
    ],
    ["GET", "/api/v1/orders/test-order/delivery-proofs/test-proof/display"],
  ],
  CART: [
    ["POST", "/api/storefront/cart"],
    ["POST", "/api/v1/carts"],
    ["GET", "/api/v1/cart"],
    ["POST", "/api/storefront/cart/items"],
    ["POST", "/api/v1/cart/items/test-item/editor"],
    ["PATCH", "/api/storefront/cart/items/test-item"],
    ["DELETE", "/api/v1/cart/items/test-item"],
    ["POST", "/api/storefront/cart/validate"],
  ],
  PAYMENT_CREATE: [
    ["POST", "/api/storefront/checkout/sessions"],
    ["POST", "/api/v1/checkout/sessions/test-id/attempts"],
    [
      "POST",
      "/api/storefront/checkout/sessions/test-id/attempts/test-attempt/recover",
    ],
  ],
  REFUND: [
    ["POST", "/api/admin/finance-refund"],
    ["POST", "/api/v1/admin/finance/refund"],
  ],
  WEBHOOK: [["POST", "/api/v1/webhooks/payments/test-endpoint"]],
};

test("all six sensitive operations cover actual BFF and API paths without grouping by object ID", () => {
  const definitions = routes();
  assert.deepEqual(Object.keys(definitions).sort(), Object.keys(cases).sort());
  for (const [operation, examples] of Object.entries(cases)) {
    const matches = (method, path) =>
      definitions[operation].some(
        (route) => route.method === method && new RegExp(route.path).test(path),
      );
    for (const [method, path] of examples) {
      for (const variant of [
        path,
        `${path}/`,
        path.replaceAll("test-", "another-"),
      ])
        assert.ok(
          matches(method, variant),
          `${operation}: ${method} ${variant}`,
        );
      assert.equal(matches("OPTIONS", path), false);
      assert.equal(matches(method, `/unrelated${path}`), false);
      assert.equal(matches(method, `${path}/unrelated`), false);
    }
    assert.equal(matches("GET", "/healthz"), false);
    assert.equal(matches("GET", "/en/idols"), false);
    assert.equal(matches("GET", "/_next/static/file.js"), false);
  }
});

test("built-in account sign-in shares the LOGIN bucket without catching neighbouring admin routes", () => {
  const login = routes().LOGIN;
  const matches = (method, path) =>
    login.some(
      (route) => route.method === method && new RegExp(route.path).test(path),
    );
  for (const path of [
    "/api/admin/local-authority",
    "/api/admin/local-auth/session",
    "/api/v1/admin/local-access/staff",
    "/api/v1/admin/local-access",
  ])
    assert.equal(matches("POST", path), false, path);
  for (const path of [
    "/api/admin/local-auth/login",
    "/api/v1/admin/local-access/step",
  ])
    assert.equal(matches("GET", path), false, `GET ${path}`);
});

test("write scopes exclude safe reads and WAF uses source IP instead of spoofable forwarded headers", () => {
  const definitions = routes();
  for (const operation of ["PAYMENT_CREATE", "REFUND", "WEBHOOK"])
    assert.ok(definitions[operation].every((route) => route.method === "POST"));
  assert.doesNotMatch(
    source,
    /aggregate_key_type\s*=\s*"(?:FORWARDED_IP|CUSTOM_KEYS)"/u,
  );
  assert.doesNotMatch(source, /sampled_requests_enabled\s*=\s*true/u);
});
