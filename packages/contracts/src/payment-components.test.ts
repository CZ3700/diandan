import { expect, test } from "vitest";

import {
  AIRWALLEX_HPP_COMPONENT_KEY,
  decodeAirwallexHppClientToken,
  encodeAirwallexHppClientToken,
  type AirwallexHppLaunch,
} from "./payment-components.js";
import { paymentActionSchema } from "./payment.js";

const launch = {
  v: 1,
  env: "sandbox",
  intentId: "int_hkpdskz7vg1xc7uscdj",
  clientSecret: [
    "eyJhbGciOiJIUzI1NiJ9",
    "eyJ0eXBlIjoiY2xpZW50In0",
    "c2ln_-x",
  ].join("."),
  currency: "USD",
  locale: "zh",
  cancelUrl:
    "https://shop.example.com/zh-CN/checkout/return?session=10000000-0000-4000-8000-000000000001&attempt=20000000-0000-4000-8000-000000000002",
} as AirwallexHppLaunch;

test("the client token round-trips through the platform token alphabet", () => {
  const token = encodeAirwallexHppClientToken(launch);
  expect(token).toMatch(/^[A-Za-z0-9+/=]+$/u);
  expect(decodeAirwallexHppClientToken(token)).toEqual(launch);
  expect(
    paymentActionSchema.parse({
      schemaVersion: 1,
      type: "PROVIDER_COMPONENT",
      componentKey: AIRWALLEX_HPP_COMPONENT_KEY,
      clientToken: token,
    }),
  ).toMatchObject({ componentKey: "airwallex-hpp" });
});

test("tokens that are tampered, extended or not ours never decode", () => {
  const token = encodeAirwallexHppClientToken(launch);
  const encode = (value: unknown) => btoa(JSON.stringify(value));
  for (const candidate of [
    token.slice(0, -4),
    `${token}AAAA`,
    `${token.slice(0, 8)}-${token.slice(9)}`,
    encode({ ...launch, extra: true }),
    encode({ ...launch, env: "staging" }),
    encode({ ...launch, locale: "th" }),
    encode({ ...launch, intentId: "pi_3MtwBw" }),
    encode({ ...launch, cancelUrl: "http://shop.example.com/return" }),
    encode({ ...launch, clientSecret: "has spaces in it!!" }),
    "not a token",
  ])
    expect(decodeAirwallexHppClientToken(candidate)).toBeUndefined();
});

test("an oversized launch cannot become a client token", () => {
  expect(() =>
    encodeAirwallexHppClientToken({
      ...launch,
      cancelUrl: `https://shop.example.com/${"x".repeat(3_500)}` as never,
    }),
  ).toThrow();
});
