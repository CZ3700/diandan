import { expect, test } from "vitest";
import { matchesConfiguredRequestOrigin } from "./request-origin";

const siteOrigin = "https://shop.example.invalid:8443";
const proxyHeaders = {
  host: "shop.example.invalid:8443",
  "x-forwarded-host": "shop.example.invalid:8443",
  "x-forwarded-proto": "https",
};
const incoming = (headers: HeadersInit = proxyHeaders) =>
  new Request("http://application.internal:3100/api/storefront/cart", {
    headers,
  });

test("public URL keeps the direct-request behavior without trusting forwarding headers", () => {
  expect(
    matchesConfiguredRequestOrigin(
      new Request(siteOrigin + "/api/storefront/cart", {
        headers: { "x-forwarded-host": "attacker.invalid" },
      }),
      siteOrigin,
    ),
  ).toBe(true);
});

test("a proxy may present only the exact configured public host, port and protocol", () => {
  expect(matchesConfiguredRequestOrigin(incoming(), siteOrigin)).toBe(true);
  expect(
    matchesConfiguredRequestOrigin(
      new Request("https://application.internal:3100/api/storefront/cart", {
        headers: proxyHeaders,
      }),
      siteOrigin,
    ),
  ).toBe(true);
});

test.each([
  ["host", ""],
  ["host", "attacker.invalid"],
  ["host", "shop.example.invalid"],
  ["host", "shop.example.invalid:8443, attacker.invalid"],
  ["x-forwarded-host", ""],
  ["x-forwarded-host", "attacker.invalid"],
  ["x-forwarded-host", "shop.example.invalid:8443, shop.example.invalid:8443"],
  ["x-forwarded-host", "https://shop.example.invalid:8443"],
  ["x-forwarded-proto", ""],
  ["x-forwarded-proto", "http"],
  ["x-forwarded-proto", "https, https"],
  ["x-forwarded-proto", "https:"],
])(
  "rejects a missing, different or multi-valued proxy header: %s=%s",
  (name, value) => {
    const headers = new Headers(proxyHeaders);
    if (value) headers.set(name, value);
    else headers.delete(name);
    expect(matchesConfiguredRequestOrigin(incoming(headers), siteOrigin)).toBe(
      false,
    );
  },
);

test("Origin and Forwarded never supply authority for a mismatched request URL", () => {
  expect(
    matchesConfiguredRequestOrigin(
      incoming({
        origin: siteOrigin,
        forwarded: "host=shop.example.invalid:8443;proto=https",
      }),
      siteOrigin,
    ),
  ).toBe(false);
});

test.each([
  "not-an-origin",
  siteOrigin + "/path",
  "ftp://shop.example.invalid:8443",
  "https://user:password@shop.example.invalid:8443",
])("rejects invalid configured origin %s", (origin) => {
  expect(matchesConfiguredRequestOrigin(incoming(), origin)).toBe(false);
});
