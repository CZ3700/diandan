import { expect, test } from "vitest";

import {
  capabilityId,
  supportsAmount,
  toMajorAmount,
  toMinorAmount,
} from "./amounts.js";
import { parseAirwallexTimestamp } from "./airwallex-objects.js";
import {
  fromPlatformReference,
  isAirwallexId,
  toPlatformReference,
} from "./references.js";

test("Airwallex identifiers map losslessly into the platform reference alphabet", () => {
  for (const [id, kind] of [
    ["int_hkpdskz7vg1xc7uscdj", "paymentIntent"],
    ["rfd_hkpdbybkch3ovunwjy1_1raukh", "refund"],
    ["dst_ch4cfk4lsdEmmgNc3gzyXz7g27n", "dispute"],
    ["evt_100_2019102201540902013102020043_8321220011893766", "event"],
  ] as const) {
    const reference = toPlatformReference(id, kind);
    expect(reference).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
    expect(reference).not.toContain("_");
    expect(fromPlatformReference(reference, kind)).toBe(id);
  }
});

test("identifiers of another kind, with dots or foreign shapes are rejected", () => {
  expect(isAirwallexId("rfd_1", "paymentIntent")).toBe(false);
  expect(isAirwallexId("int_a.b", "paymentIntent")).toBe(false);
  expect(isAirwallexId("int__a", "paymentIntent")).toBe(false);
  expect(isAirwallexId(`int_${"a".repeat(260)}`, "paymentIntent")).toBe(false);
  expect(() => toPlatformReference("pi_3MtwBw", "paymentIntent")).toThrow(
    TypeError,
  );
  expect(() => fromPlatformReference("cs.test.a1", "paymentIntent")).toThrow(
    TypeError,
  );
  expect(() => fromPlatformReference("int.a..b", "paymentIntent")).toThrow(
    TypeError,
  );
});

test("amounts convert exactly or not at all", () => {
  expect(toMajorAmount("USD", 1999)).toBe(19.99);
  expect(toMajorAmount("JPY", 2500)).toBe(2500);
  expect(JSON.stringify(toMajorAmount("USD", 1))).toBe("0.01");
  expect(() => toMajorAmount("KRW", 100)).toThrow(TypeError);
  expect(toMinorAmount("USD", 16.66)).toBe(1666);
  expect(toMinorAmount("THB", 999_999.99)).toBe(99_999_999);
  expect(toMinorAmount("JPY", 2500)).toBe(2500);
  for (const [currency, amount] of [
    ["USD", 16.665],
    ["JPY", 2500.5],
    ["USD", -1],
    ["USD", Number.NaN],
    ["USD", "25"],
    ["KRW", 1000],
  ] as const)
    expect(toMinorAmount(currency, amount)).toBeUndefined();
  expect(supportsAmount("USD", 1)).toBe(true);
  expect(supportsAmount("USD", 0)).toBe(false);
  expect(supportsAmount("USD", 1.5)).toBe(false);
  expect(supportsAmount("KRW", 1000)).toBe(false);
});

test("capability IDs are stable version-8 UUIDs per account and method", () => {
  const id = capabilityId("10000000-0000-4000-8000-000000000001", "card");
  expect(id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(capabilityId("10000000-0000-4000-8000-000000000001", "card")).toBe(id);
  expect(capabilityId("10000000-0000-4000-8000-000000000002", "card")).not.toBe(
    id,
  );
});

test("Airwallex timestamps with compact offsets parse; anything looser does not", () => {
  expect(parseAirwallexTimestamp("2019-10-22T01:54:09+0000")).toBe(
    Date.parse("2019-10-22T01:54:09Z"),
  );
  expect(parseAirwallexTimestamp("2021-03-03T08:17:27.659+0800")).toBe(
    Date.parse("2021-03-03T00:17:27.659Z"),
  );
  expect(parseAirwallexTimestamp("2026-09-26T00:00:00Z")).toBe(
    Date.parse("2026-09-26T00:00:00Z"),
  );
  for (const value of ["yesterday", "2026-09-26", "2026-13-40T00:00:00Z"])
    expect(parseAirwallexTimestamp(value)).toBeUndefined();
});
