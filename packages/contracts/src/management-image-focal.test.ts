import { expect, test } from "vitest";
import {
  managementCenterIntentSchema,
  managementCenterCommandSchema,
  managementCenterResponseSchema,
} from "./management-center.js";
const id = "00000000-0000-4000-8000-000000000001";
const artist = {
  kind: "SAVE_ARTIST",
  sourceLocale: "en",
  id,
  expectedVersion: 2,
  name: "Artist",
  description: "Description",
  image: { uploadId: id },
};
test("daily upload accepts a bounded precise optional focus without changing old parsed input", () => {
  expect(managementCenterIntentSchema.parse(artist)).toEqual(artist);
  expect(
    managementCenterIntentSchema.safeParse({
      ...artist,
      image: { uploadId: id, focalPoint: { x: 0.12345, y: 1 } },
    }).success,
  ).toBe(true);
  for (const x of [-0.1, 1.01, 0.123456, NaN, Infinity])
    expect(
      managementCenterIntentSchema.safeParse({
        ...artist,
        image: { uploadId: id, focalPoint: { x, y: 0.5 } },
      }).success,
    ).toBe(false);
});
test("current image reuse binds both identities and requires an existing target", () => {
  const image = {
    currentImage: { assetId: id, metadataRevisionId: id },
    focalPoint: { x: 0, y: 1 },
  };
  expect(
    managementCenterIntentSchema.safeParse({ ...artist, image }).success,
  ).toBe(true);
  expect(
    managementCenterIntentSchema.safeParse({
      ...artist,
      id: null,
      expectedVersion: 0,
      image,
    }).success,
  ).toBe(false);
  expect(
    managementCenterIntentSchema.safeParse({
      ...artist,
      image: { ...image, uploadId: id },
    }).success,
  ).toBe(false);
});
test("original read binds target version and returns only a bounded private grant", () => {
  const target = { kind: "ARTIST", id, expectedVersion: 2 };
  expect(
    managementCenterCommandSchema.safeParse({
      schemaVersion: 1,
      action: "READ_IMAGE_SOURCE",
      target,
    }).success,
  ).toBe(true);
  const response = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "ORIGINAL_IMAGE",
    target,
    currentImage: { assetId: id, metadataRevisionId: id },
    focalPoint: { x: 0.5, y: 0.3 },
    sourceWidth: 2400,
    sourceHeight: 1600,
    download: {
      method: "GET",
      url: "https://media.example.test/private",
      headers: {},
      expiresAt: "2026-09-28T00:00:00Z",
    },
  };
  expect(managementCenterResponseSchema.safeParse(response).success).toBe(true);
  expect(
    managementCenterResponseSchema.safeParse({
      ...response,
      sourceObjectKey: "private/source",
    }).success,
  ).toBe(false);
  expect(
    managementCenterResponseSchema.safeParse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "REUPLOAD_REQUIRED",
    }).success,
  ).toBe(true);
});
test("existing gift edits distinguish preserved commerce from explicit CAS updates", () => {
  const gift = {
    ...artist,
    kind: "SAVE_GIFT",
    giftKind: "VIRTUAL",
    category: "OTHER",
    price: { market: "TEST", currency: "USD", amountMinor: 1000 },
    inventory: { policy: "PROCURE_ON_DEMAND" },
    eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
  };
  const commerceEdit = {
    price: { mode: "PRESERVE" },
    inventory: {
      mode: "SET",
      baseline: { policy: "TRACKED", locationId: id, quantity: 10 },
    },
  };
  expect(
    managementCenterIntentSchema.safeParse({ ...gift, commerceEdit }).success,
  ).toBe(true);
  expect(
    managementCenterIntentSchema.safeParse({
      ...gift,
      id: null,
      expectedVersion: 0,
      commerceEdit,
    }).success,
  ).toBe(false);
  expect(
    managementCenterIntentSchema.safeParse({
      ...gift,
      commerceEdit: { ...commerceEdit, price: { mode: "SET" } },
    }).success,
  ).toBe(false);
  expect(managementCenterIntentSchema.parse(gift)).toEqual(gift);
});
