import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import type { z } from "zod";
import * as contracts from "./index.js";

function contract(name: string): z.ZodType {
  expect(contracts).toHaveProperty(name);
  return Reflect.get(contracts, name) as z.ZodType;
}
const navigation = () => ({
  schemaVersion: 1,
  header: ["HOME", "ARTISTS", "GIFTS"],
  footer: ["DESCRIPTION", "REGION", "ARTISTS", "GIFTS", "POLICIES"].map(
    (id) => ({ id, visible: id !== "GIFTS" }),
  ),
});
test("default preserves legacy entry order while retiring the description block", () => {
  expect(contracts).toHaveProperty("createDefaultStorefrontNavigation");
  const create = Reflect.get(
    contracts,
    "createDefaultStorefrontNavigation",
  ) as () => unknown;
  const value = navigation();
  expect(create()).toEqual({
    ...value,
    footer: value.footer.map((item) =>
      item.id === "DESCRIPTION" ? { ...item, visible: false } : item,
    ),
  });
  // Previously published DESCRIPTION=true values remain byte-compatible.
  expect(contract("storefrontNavigationSchema").parse(value)).toEqual(value);
  expect(
    contract("storefrontNavigationSchema").safeParse({
      ...value,
      header: [...value.header].reverse(),
      footer: [...value.footer].reverse(),
    }).success,
  ).toBe(true);
  expect(create()).not.toBe(create());
});
test("navigation rejects missing, duplicate, unknown, hidden required and executable entries", () => {
  const schema = contract("storefrontNavigationSchema");
  const value = navigation();
  for (const invalid of [
    { ...value, header: value.header.slice(1) },
    { ...value, header: ["HOME", "HOME", "GIFTS"] },
    { ...value, header: ["HOME", "ARTISTS", "ORDER_LOOKUP"] },
    { ...value, header: ["HOME", "ARTISTS", { id: "GIFTS", visible: false }] },
    { ...value, footer: value.footer.slice(1) },
    {
      ...value,
      footer: value.footer.map((row, index) =>
        index === 0 ? value.footer[1] : row,
      ),
    },
    {
      ...value,
      footer: value.footer.map((row) =>
        row.id === "POLICIES" ? { ...row, visible: false } : row,
      ),
    },
    {
      ...value,
      footer: value.footer.map((row) => ({
        ...row,
        url: "javascript:alert(1)",
      })),
    },
    { ...value, label: "Custom" },
    { ...value, script: "alert(1)" },
  ])
    expect(schema.safeParse(invalid).success).toBe(false);
});
test("draft mutation is fenced and public projections cannot expose drafts or invented provenance", () => {
  const value = navigation();
  expect(
    contract("storefrontNavigationCommandSchema").safeParse({
      schemaVersion: 1,
      action: "SAVE_DRAFT",
      navigation: value,
    }).success,
  ).toBe(false);
  const response = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_NAVIGATION",
    source: "DEFAULT",
    navigation: value,
    version: 0,
    publicationId: null,
  };
  const schema = contract("publicStorefrontNavigationResponseSchema");
  expect(schema.safeParse(response).success).toBe(true);
  expect(schema.safeParse({ ...response, source: "PUBLISHED" }).success).toBe(
    false,
  );
  expect(schema.safeParse({ ...response, draft: {} }).success).toBe(false);
  expect(
    contract("storefrontNavigationPreviewMessageSchema").safeParse({
      schemaVersion: 1,
      type: "STOREFRONT_NAVIGATION_PREVIEW",
      channel: "11111111-1111-4111-8111-111111111111",
      navigation: value,
    }).success,
  ).toBe(true);
});
test("navigation never enters old layout and theme command bytes or hashes", () => {
  const cases = [
    {
      schema: contracts.homeLayoutCommandSchema,
      value: {
        schemaVersion: 1,
        expectedVersion: 0,
        idempotencyKey: "legacy-layout-000001",
        action: "SAVE_DRAFT",
        layout: contracts.createDefaultHomeLayout(),
      },
    },
    {
      schema: contracts.storefrontThemeCommandSchema,
      value: {
        schemaVersion: 1,
        expectedVersion: 0,
        idempotencyKey: "legacy-theme-0000001",
        action: "SAVE_DRAFT",
        theme: contracts.createDefaultStorefrontTheme(),
      },
    },
  ];
  for (const { schema, value } of cases) {
    const before = JSON.stringify(value);
    const after = JSON.stringify(schema.parse(value));
    expect(after).toBe(before);
    expect(createHash("sha256").update(after).digest("hex")).toBe(
      createHash("sha256").update(before).digest("hex"),
    );
    expect(
      schema.safeParse({ ...value, navigation: navigation() }).success,
    ).toBe(false);
  }
});
