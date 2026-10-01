import assert from "node:assert/strict";
import test from "node:test";
import * as browserGate from "./management-center-browser.mjs";

function expected(input) {
  assert.equal(typeof browserGate.expectedManagementSections, "function");
  return browserGate.expectedManagementSections(input).join();
}
function grant(area, body) {
  assert.equal(typeof browserGate.managementAreaGrant, "function");
  return browserGate.managementAreaGrant(area, body);
}

test("the entry follows the admin shell for the operator's actual access", () => {
  // The TEST runtime: an identity-provider session with every permission on an
  // API that serves content, information pages and layout only.
  assert.equal(
    expected({
      content: true,
      artistsOnly: false,
      granted: new Set(["content-read"]),
    }),
    "ARTISTS,GIFTS,POSTERS,INFO_PAGES,DECORATION",
  );
  // A super administrator signed in with a built-in account on the full API;
  // the ledger is reached inside orders.
  assert.equal(
    expected({
      content: true,
      artistsOnly: false,
      granted: new Set([
        "content-read",
        "orders-context",
        "ledger-context",
        "payment-config-read",
        "exceptions-context",
        "staff-context",
        "account-context",
      ]),
    }),
    "ARTISTS,GIFTS,POSTERS,INFO_PAGES,DECORATION,ORDERS,PAYMENTS,EXCEPTIONS,STAFF,ACCOUNT",
  );
  // A broker: own artists, its ledger and its account only.
  assert.equal(
    expected({
      content: true,
      artistsOnly: true,
      granted: new Set(["ledger-context", "account-context"]),
    }),
    "ARTISTS,LEDGER,ACCOUNT",
  );
  assert.equal(
    expected({ content: false, artistsOnly: false, granted: new Set() }),
    "",
  );
});

test("an area is granted only by a successful read the admin itself accepts", () => {
  assert.equal(
    grant("session", { outcome: "SUCCESS", permissions: ["content.read"] }),
    true,
  );
  assert.equal(
    grant("session", { outcome: "SUCCESS", permissions: ["orders.read"] }),
    false,
  );
  assert.equal(
    grant("orders-context", {
      outcome: "SUCCESS",
      kind: "CONTEXT",
      permissions: ["orders.read"],
    }),
    true,
  );
  assert.equal(
    grant("orders-context", {
      outcome: "SUCCESS",
      kind: "CONTEXT",
      permissions: [],
    }),
    false,
  );
  assert.equal(
    grant("exceptions-context", {
      outcome: "SUCCESS",
      kind: "CONTEXT",
      permissions: { canRead: false },
    }),
    false,
  );
  assert.equal(
    grant("payment-config-read", { outcome: "SUCCESS", kind: "WORKSPACE" }),
    true,
  );
  for (const area of [
    "ledger-context",
    "staff-context",
    "account-context",
    "payment-config-read",
  ])
    assert.equal(grant(area, { outcome: "FAILURE", code: "NOT_FOUND" }), false);
  assert.equal(grant("unknown-area", { outcome: "SUCCESS" }), false);
});
