import { describe, expect, it } from "vitest";
import {
  managementCenterIntentSchema,
  managementCenterOperationSchema,
  managementCenterCommandSchema,
  managementCenterResponseSchema,
  managementCenterListItemSchema,
} from "./management-center.js";

const id = "00000000-0000-4000-8000-000000000001";
const artist = {
  kind: "SAVE_ARTIST",
  sourceLocale: "th",
  id: null,
  expectedVersion: 0,
  name: "ศิลปิน",
  description: "คำอธิบาย",
  image: { uploadId: id },
};
const gift = {
  ...artist,
  kind: "SAVE_GIFT",
  giftKind: "VIRTUAL",
  category: "OTHER",
  price: { market: "TEST", currency: "USD", amountMinor: 1000 },
  inventory: { policy: "PROCURE_ON_DEMAND" },
  eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
};
describe("management center boundary", () => {
  it("exposes an explicit inventory policy lock without disabling gift editing", () => {
    const item = {
      kind: "GIFT",
      id,
      version: 2,
      sourceLocale: "th",
      name: "Gift",
      description: "Description",
      image: null,
      status: "active",
      handle: "gift",
      giftKind: "VIRTUAL",
      category: "OTHER",
      price: { market: "TEST", currency: "USD", amountMinor: 1000 },
      inventory: { policy: "TRACKED", locationId: id, quantity: 0 },
      eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
      canEdit: true,
      inventoryPolicyLocked: true,
    };
    expect(managementCenterListItemSchema.safeParse(item).success).toBe(true);
    expect(
      managementCenterResponseSchema.safeParse({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "INVENTORY_POLICY_LOCKED",
      }).success,
    ).toBe(true);
    const missing: Record<string, unknown> = { ...item };
    delete missing["inventoryPolicyLocked"];
    expect(managementCenterListItemSchema.safeParse(missing).success).toBe(
      false,
    );
  });
  it("accepts actual source language without inventing English or reviews", () => {
    expect(managementCenterIntentSchema.parse(artist)).toEqual(artist);
    expect(
      managementCenterIntentSchema.safeParse({ ...artist, translations: [] })
        .success,
    ).toBe(false);
  });
  it.each([
    { ...artist, image: null },
    { ...artist, expectedVersion: 1 },
    { ...artist, id, expectedVersion: 0 },
    { ...artist, name: " " },
    { ...artist, image: { url: "https://example.test/private" } },
  ])("rejects incomplete or contradictory artist input", (input) => {
    expect(managementCenterIntentSchema.safeParse(input).success).toBe(false);
  });
  it("allows editing to keep the current image at an exact version", () => {
    expect(
      managementCenterIntentSchema.safeParse({
        ...artist,
        id,
        expectedVersion: 2,
        image: null,
      }).success,
    ).toBe(true);
  });
  it("keeps gift kind independent of inventory policy", () => {
    expect(managementCenterIntentSchema.safeParse(gift).success).toBe(true);
    expect(
      managementCenterIntentSchema.safeParse({
        ...gift,
        inventory: { policy: "TRACKED", quantity: 0, locationId: id },
      }).success,
    ).toBe(true);
    expect(
      managementCenterIntentSchema.safeParse({
        ...gift,
        inventory: { policy: "PREORDER" },
      }).success,
    ).toBe(true);
    expect(
      managementCenterIntentSchema.safeParse({
        ...gift,
        inventory: { policy: "PROCURE_ON_DEMAND", quantity: 5 },
      }).success,
    ).toBe(false);
  });
  it("requires exact price and configured tracking location", () => {
    expect(
      managementCenterIntentSchema.safeParse({
        ...gift,
        price: { ...gift.price, amountMinor: 1.5 },
      }).success,
    ).toBe(false);
    expect(
      managementCenterIntentSchema.safeParse({
        ...gift,
        inventory: { policy: "TRACKED", quantity: 1 },
      }).success,
    ).toBe(false);
  });
  it("offers only the four scoped intents", () => {
    expect(
      managementCenterIntentSchema.safeParse({
        kind: "SAVE_POLICY",
        sourceLocale: "en",
      }).success,
    ).toBe(false);
    expect(
      managementCenterIntentSchema.safeParse({
        kind: "RESTORE_POSTER",
        sourceLocale: "en",
        expectedVersion: 1,
        sourceRevisionId: id,
      }).success,
    ).toBe(true);
  });
  it("retains real content field limits instead of silently truncating", () => {
    expect(
      managementCenterIntentSchema.safeParse({
        ...artist,
        name: "x".repeat(41),
      }).success,
    ).toBe(false);
    expect(
      managementCenterIntentSchema.safeParse({ ...gift, name: "x".repeat(101) })
        .success,
    ).toBe(false);
    expect(
      managementCenterIntentSchema.safeParse({
        ...artist,
        description: "x".repeat(601),
      }).success,
    ).toBe(false);
  });
  it("requires explicit rights confirmation and forbids credentials in commands", () => {
    const command = {
      schemaVersion: 1,
      action: "PREPARE_UPLOAD",
      checksumSha256: "a".repeat(64),
      byteSize: 1000,
      mimeType: "image/jpeg",
      rightsConfirmed: true,
      idempotencyKey: "management-upload-01",
    };
    expect(managementCenterCommandSchema.safeParse(command).success).toBe(true);
    expect(
      managementCenterCommandSchema.safeParse({
        ...command,
        rightsConfirmed: false,
      }).success,
    ).toBe(false);
    expect(
      managementCenterCommandSchema.safeParse({ ...command, sessionToken: "x" })
        .success,
    ).toBe(false);
  });
  it("does not accept a false published result or expose worker data", () => {
    const operation = {
      operationId: id,
      version: 1,
      kind: "SAVE_ARTIST",
      sourceLocale: "th",
      status: "PROCESSING",
      targetId: null,
      updatedAt: "2026-09-08T00:00:00Z",
      result: null,
      failure: null,
    };
    expect(managementCenterOperationSchema.safeParse(operation).success).toBe(
      true,
    );
    expect(
      managementCenterOperationSchema.safeParse({
        ...operation,
        status: "PUBLISHED",
      }).success,
    ).toBe(false);
    expect(
      managementCenterOperationSchema.safeParse({
        ...operation,
        leaseToken: "secret",
      }).success,
    ).toBe(false);
    expect(
      managementCenterOperationSchema.safeParse({
        ...operation,
        status: "FAILED",
        failure: { code: "MEDIA_FAILED", retryable: true },
      }).success,
    ).toBe(true);
    expect(
      managementCenterResponseSchema.safeParse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "OPERATION",
        operation,
      }).success,
    ).toBe(true);
  });
  it("retains unavailable poster history without claiming it can be restored", () => {
    const item = {
      kind: "POSTER",
      id,
      version: 1,
      sourceLocale: "en",
      sourceRevisionId: id,
      current: false,
      image: null,
      canRestore: false,
      canDelete: true,
      createdAt: "2026-09-08T00:00:00Z",
    };
    const response = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "LIST",
      section: "POSTERS",
      page: 1,
      pageSize: 10,
      totalItems: 1,
      items: [item],
    };
    expect(managementCenterResponseSchema.safeParse(response).success).toBe(
      true,
    );
    expect(
      managementCenterResponseSchema.safeParse({
        ...response,
        items: [{ ...item, canRestore: true }],
      }).success,
    ).toBe(false);
    // The poster on the homepage can never be offered for deletion.
    expect(
      managementCenterResponseSchema.safeParse({
        ...response,
        items: [{ ...item, current: true, canDelete: true }],
      }).success,
    ).toBe(false);
    expect(
      managementCenterResponseSchema.safeParse({
        ...response,
        items: [{ ...item, current: true, canDelete: false }],
      }).success,
    ).toBe(true);
  });
});
