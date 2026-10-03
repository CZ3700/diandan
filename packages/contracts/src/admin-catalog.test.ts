import { describe, expect, test } from "vitest";
import {
  adminCatalogCommandSchema,
  adminCatalogOwnerSchema,
  idolHandleResolutionSchema,
} from "./admin-catalog.js";
const id = "e95a65da-d2d0-420c-a1ba-f6921c45c741";
describe("admin catalog boundaries", () => {
  test("new identity starts at base version zero and excludes browser identity/status", () => {
    const command = {
      schemaVersion: 1,
      action: "CREATE_IDOL",
      handle: "sample-artist",
      expectedBaseVersion: 0,
      idempotencyKey: "create-sample-artist",
      reasonCode: "INITIAL_SETUP",
    };
    expect(adminCatalogCommandSchema.safeParse(command).success).toBe(true);
    for (const addition of [
      { idolId: id },
      { status: "active" },
      { expectedBaseVersion: 1 },
    ])
      expect(
        adminCatalogCommandSchema.safeParse({ ...command, ...addition })
          .success,
      ).toBe(false);
  });
  test("status changes cannot conflate base with publication version or accept gifts while paused", () => {
    const command = {
      schemaVersion: 1,
      action: "SET_IDOL_STATUS",
      idolId: id,
      expectedBaseVersion: 2,
      status: "paused",
      acceptingGifts: false,
      idempotencyKey: "pause-sample-artist",
      reasonCode: "OPERATIONS_PAUSE",
    };
    expect(adminCatalogCommandSchema.safeParse(command).success).toBe(true);
    expect(
      adminCatalogCommandSchema.safeParse({ ...command, acceptingGifts: true })
        .success,
    ).toBe(false);
    expect(
      adminCatalogCommandSchema.safeParse({ ...command, expectedVersion: 2 })
        .success,
    ).toBe(false);
  });
  test("discovery and history are bounded and locale explicit", () => {
    const command = {
      schemaVersion: 1,
      action: "LIST_OWNERS",
      kind: "IDOL",
      locale: "ja",
      page: 1,
      pageSize: 20,
    };
    expect(adminCatalogCommandSchema.safeParse(command).success).toBe(true);
    for (const change of [
      { page: 0 },
      { page: 1001 },
      { pageSize: 51 },
      { locale: "fr" },
      { q: "x".repeat(161) },
    ])
      expect(
        adminCatalogCommandSchema.safeParse({ ...command, ...change }).success,
      ).toBe(false);
  });
  test("owner view distinguishes all three clocks without localized fallback", () => {
    expect(
      adminCatalogOwnerSchema.safeParse({
        schemaVersion: 1,
        target: { kind: "IDOL", idolId: id },
        label: null,
        locale: "ja",
        status: "draft",
        baseVersion: 5,
        authoringVersion: 3,
        publicationHeadVersion: 1,
        latestRevisionId: id,
        draftRevisionId: id,
        publishedRevisionId: id,
        handle: "sample",
        acceptingGifts: false,
        createdAt: "2026-09-07T00:00:00.000001Z",
      }).success,
    ).toBe(true);
  });
  test("a valid media alt label is not rejected or truncated by discovery", () => {
    expect(
      adminCatalogOwnerSchema.shape.label.safeParse("a".repeat(300)).success,
    ).toBe(true);
    expect(
      adminCatalogOwnerSchema.shape.label.safeParse("a".repeat(301)).success,
    ).toBe(false);
  });
  test("artist discovery accepts a safe optional public thumbnail without storage metadata", () => {
    const owner = {
      schemaVersion: 1,
      target: { kind: "IDOL", idolId: id },
      label: "原语言艺人",
      locale: "ja",
      status: "active",
      baseVersion: 1,
      authoringVersion: 1,
      publicationHeadVersion: 1,
      latestRevisionId: id,
      draftRevisionId: null,
      publishedRevisionId: id,
      handle: "sample",
      acceptingGifts: true,
      createdAt: "2026-09-07T00:00:00.000001Z",
    };
    const image = {
      url: "https://media.example.test/public/portrait.webp",
      alt: "原语言艺人",
    };
    expect(adminCatalogOwnerSchema.safeParse({ ...owner, image }).success).toBe(
      true,
    );
    expect(
      adminCatalogOwnerSchema.safeParse({ ...owner, image: null }).success,
    ).toBe(true);
    expect(adminCatalogOwnerSchema.parse(owner)).toEqual(owner);
    for (const addition of [
      { url: "http://localhost/private.png" },
      { objectKey: "private/source.png" },
    ])
      expect(
        adminCatalogOwnerSchema.safeParse({
          ...owner,
          image: { ...image, ...addition },
        }).success,
      ).toBe(false);
  });
  test("redirect is stable identity resolution with fixed 301 and no arbitrary URL", () => {
    const result = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "IDOL_HANDLE",
      idolId: id,
      requestedHandle: "old-sample",
      currentHandle: "sample",
      redirectStatus: 301,
    };
    expect(idolHandleResolutionSchema.safeParse(result).success).toBe(true);
    expect(
      idolHandleResolutionSchema.safeParse({ ...result, redirectStatus: 302 })
        .success,
    ).toBe(false);
    expect(
      idolHandleResolutionSchema.safeParse({
        ...result,
        url: "https://example.test",
      }).success,
    ).toBe(false);
  });
  test("media summaries retain a safe latest job identifier for reopening processing", () => {
    const media = adminCatalogOwnerSchema.shape.media.unwrap();
    const value = {
      width: 1200,
      height: 1600,
      mimeType: "image/png",
      processingStatus: "READY",
      rightsStatus: "APPROVED",
      identityKind: "SOURCE",
      latestProcessingJobId: id,
    };
    expect(media.safeParse(value).success).toBe(true);
    expect(
      media.safeParse({ ...value, latestProcessingJobId: null }).success,
    ).toBe(true);
    expect(
      media.safeParse({ ...value, objectKey: "private/raw" }).success,
    ).toBe(false);
  });
});
