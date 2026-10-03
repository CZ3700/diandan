import { describe, expect, test } from "vitest";
import {
  adminOrdersCommandSchema,
  adminOrdersResponseSchema,
  adminOrdersStoreCommandSchema,
  adminOrdersProofUploadStateSchema,
  deliveryProofProcessingCommandSchema,
  deliveryProofProcessingSuccessSchema,
  deliveryProofRenditionObjectKey,
  deliveryProofSourceObjectKey,
  orderAccessItemSchema,
  orderAccessProofCommandSchema,
} from "./index.js";

const uploadId = "20000000-0000-4000-8000-000000000001";
const proofId = "20000000-0000-4000-8000-000000000002";
const orderId = "20000000-0000-4000-8000-000000000003";
const checksum = (fill: string) => fill.repeat(64);
const rendition = (fill: string, width: number, height: number) => ({
  objectKey: deliveryProofRenditionObjectKey(uploadId, checksum(fill)),
  checksumSha256: checksum(fill),
  byteSize: 1024,
  width,
  height,
  mimeType: "image/webp" as const,
});
const success = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  profileVersion: 1,
  uploadId,
  metadataPolicy: "STRIP_ALL_SRGB",
  display: rendition("a", 1600, 1200),
  thumbnail: rendition("b", 480, 360),
};

describe("private proof storage keys", () => {
  test("keys stay inside the private proof namespace and are server-derived", () => {
    expect(deliveryProofSourceObjectKey(uploadId.toUpperCase())).toBe(
      `fulfillment-proofs/v1/sources/${uploadId}`,
    );
    expect(deliveryProofRenditionObjectKey(uploadId, checksum("c"))).toBe(
      `fulfillment-proofs/v1/renditions/${uploadId}/${checksum("c")}.webp`,
    );
    expect(() => deliveryProofSourceObjectKey("../escape")).toThrow();
    expect(() => deliveryProofRenditionObjectKey(uploadId, "abc")).toThrow();
  });
  test("processing binds the exact reserved source key", () => {
    const command = {
      schemaVersion: 1,
      profileVersion: 1,
      uploadId,
      source: {
        objectKey: deliveryProofSourceObjectKey(uploadId),
        checksumSha256: checksum("d"),
        byteSize: 4096,
        mimeType: "image/jpeg",
      },
    };
    expect(
      deliveryProofProcessingCommandSchema.safeParse(command).success,
    ).toBe(true);
    for (const source of [
      { objectKey: "uploads/v1/other" },
      { mimeType: "image/avif" },
      { byteSize: 25 * 1024 * 1024 + 1 },
    ])
      expect(
        deliveryProofProcessingCommandSchema.safeParse({
          ...command,
          source: { ...command.source, ...source },
        }).success,
      ).toBe(false);
  });
  test("renditions are bounded, content-addressed and never larger than display", () => {
    expect(
      deliveryProofProcessingSuccessSchema.safeParse(success).success,
    ).toBe(true);
    for (const change of [
      { thumbnail: rendition("b", 481, 360) },
      {
        thumbnail: {
          ...rendition("b", 480, 360),
          checksumSha256: checksum("e"),
        },
      },
      {
        display: {
          ...rendition("a", 1600, 1200),
          objectKey: "processed/v1/x.webp",
        },
      },
      { display: rendition("a", 400, 300) },
      { metadataPolicy: "KEEP" },
    ])
      expect(
        deliveryProofProcessingSuccessSchema.safeParse({
          ...success,
          ...change,
        }).success,
      ).toBe(false);
  });
});

describe("fan-visible proof references", () => {
  const language = {
    schemaVersion: 1,
    mode: "APPROVED",
    requestedLocale: "en",
    resolvedLocale: "en",
    fallbackUsed: false,
  };
  const media = {
    url: "https://media.example.test/gift.webp",
    alt: "Gift",
    locale: language,
  };
  const item = {
    schemaVersion: 1,
    position: 1,
    idol: {
      handle: "test-artist",
      displayName: "Artist",
      locale: language,
      portrait: media,
    },
    gift: { title: "Gift", variantLabel: null, locale: language, image: media },
    quantity: 1,
    unitAmountMinor: 1000,
    lineSubtotalMinor: 1000,
    taxAmountMinor: 0,
    discountAmountMinor: 0,
    lineTotalMinor: 1000,
    currency: "USD",
    displayMode: "anonymous",
    giftKind: "PHYSICAL",
    fulfillmentStatus: "DELIVERED",
    deliveryProofs: [
      {
        proofId,
        width: 1600,
        height: 1200,
        thumbnailWidth: 480,
        thumbnailHeight: 360,
      },
    ],
    supportCertificate: null,
  };
  test("only delivered physical lines expose distinct opaque proofs", () => {
    expect(orderAccessItemSchema.safeParse(item).success).toBe(true);
    expect(
      orderAccessItemSchema.safeParse({ ...item, deliveryProofs: [] }).success,
    ).toBe(true);
    for (const change of [
      { fulfillmentStatus: "PREPARING" },
      { giftKind: "VIRTUAL" },
      { deliveryProofs: [item.deliveryProofs[0], item.deliveryProofs[0]] },
      {
        deliveryProofs: [
          { ...item.deliveryProofs[0], objectKey: "fulfillment-proofs/v1/x" },
        ],
      },
      {
        deliveryProofs: [
          {
            ...item.deliveryProofs[0],
            thumbnailWidth: 1600,
            thumbnailHeight: 1200,
          },
        ],
      },
    ])
      expect(
        orderAccessItemSchema.safeParse({ ...item, ...change }).success,
      ).toBe(false);
    expect(
      orderAccessItemSchema.safeParse({
        ...item,
        deliveryProofs: [1, 2, 3, 4].map((index) => ({
          ...item.deliveryProofs[0],
          proofId: `20000000-0000-4000-8000-00000000001${index}`,
        })),
      }).success,
    ).toBe(false);
    const legacy = Object.fromEntries(
      Object.entries(item).filter(([key]) => key !== "deliveryProofs"),
    );
    expect(orderAccessItemSchema.safeParse(legacy).success).toBe(false);
  });
  test("proof reads carry session candidates, never storage identities", () => {
    const command = {
      schemaVersion: 1,
      publicOrderId: orderId,
      proofId,
      rendition: "thumbnail",
      sessionCandidates: [
        { schemaVersion: 1, tokenDigest: checksum("f"), pepperVersion: "v1" },
      ],
    };
    expect(orderAccessProofCommandSchema.safeParse(command).success).toBe(true);
    for (const change of [
      { rendition: "original" },
      { objectKey: "fulfillment-proofs/v1/sources/x" },
      { sessionCandidates: [] },
    ])
      expect(
        orderAccessProofCommandSchema.safeParse({ ...command, ...change })
          .success,
      ).toBe(false);
  });
});

describe("administrative proof commands", () => {
  const line = {
    schemaVersion: 1,
    orderId,
    expectedOrderVersion: 3,
    idempotencyKey: "proof-command-0001",
    reasonCode: "DELIVERY_PROOF_UPLOAD",
    fulfillmentId: proofId,
    expectedFulfillmentVersion: 2,
  };
  test("uploads declare a bounded supported source for one line", () => {
    const begin = {
      ...line,
      action: "BEGIN_PROOF_UPLOAD",
      checksumSha256: checksum("a"),
      byteSize: 2048,
      mimeType: "image/png",
    };
    expect(adminOrdersCommandSchema.safeParse(begin).success).toBe(true);
    expect(adminOrdersStoreCommandSchema.safeParse(begin).success).toBe(true);
    for (const change of [
      { mimeType: "image/heic" },
      { byteSize: 0 },
      { objectKey: "fulfillment-proofs/v1/sources/x" },
      { expectedFulfillmentVersion: 0 },
    ])
      expect(
        adminOrdersCommandSchema.safeParse({ ...begin, ...change }).success,
      ).toBe(false);
    const complete = {
      schemaVersion: 1,
      action: "COMPLETE_PROOF_UPLOAD",
      orderId,
      uploadId,
    };
    expect(adminOrdersCommandSchema.safeParse(complete).success).toBe(true);
    expect(
      adminOrdersCommandSchema.safeParse({
        ...complete,
        idempotencyKey: "proof-command-0002",
      }).success,
    ).toBe(false);
  });
  test("attachments require distinct uploads and explicit privacy confirmation", () => {
    const attach = {
      ...line,
      action: "ATTACH_PROOFS",
      uploadIds: [uploadId],
      privacyConfirmed: true,
    };
    expect(adminOrdersCommandSchema.safeParse(attach).success).toBe(true);
    for (const change of [
      { privacyConfirmed: false },
      { uploadIds: [] },
      { uploadIds: [uploadId, uploadId] },
      {
        uploadIds: [1, 2, 3, 4].map(
          (index) => `20000000-0000-4000-8000-00000000002${index}`,
        ),
      },
    ])
      expect(
        adminOrdersCommandSchema.safeParse({ ...attach, ...change }).success,
      ).toBe(false);
    const withdraw = {
      ...line,
      action: "WITHDRAW_PROOF",
      proofId,
      confirmed: true,
    };
    expect(adminOrdersCommandSchema.safeParse(withdraw).success).toBe(true);
    expect(
      adminOrdersCommandSchema.safeParse({ ...withdraw, confirmed: false })
        .success,
    ).toBe(false);
    expect(
      adminOrdersCommandSchema.safeParse({
        schemaVersion: 1,
        action: "VIEW_PROOF",
        orderId,
        proofId,
        rendition: "display",
      }).success,
    ).toBe(true);
  });
  test("proof responses expose short-lived grants, never storage keys", () => {
    const download = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PROOF_DOWNLOAD",
      orderId,
      proofId,
      rendition: "thumbnail",
      width: 480,
      height: 360,
      download: {
        method: "GET",
        url: "https://storage.example.test/object?X-Amz-Signature=abc",
        headers: {},
        expiresAt: "2026-09-27T00:05:00.000Z",
      },
    };
    expect(adminOrdersResponseSchema.safeParse(download).success).toBe(true);
    expect(
      adminOrdersResponseSchema.safeParse({
        ...download,
        objectKey: "fulfillment-proofs/v1/sources/x",
      }).success,
    ).toBe(false);
    expect(
      adminOrdersResponseSchema.safeParse({
        ...download,
        download: { ...download.download, method: "PUT" },
      }).success,
    ).toBe(false);
  });
  test("upload states tie READY to both renditions", () => {
    const state = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PROOF_UPLOAD_STATE",
      orderId,
      fulfillmentId: proofId,
      uploadId,
      status: "READY",
      source: {
        objectKey: deliveryProofSourceObjectKey(uploadId),
        checksumSha256: checksum("d"),
        byteSize: 4096,
        mimeType: "image/jpeg",
      },
      expiresAt: "2026-09-27T00:15:00.000Z",
      display: success.display,
      thumbnail: success.thumbnail,
    };
    expect(adminOrdersProofUploadStateSchema.safeParse(state).success).toBe(
      true,
    );
    expect(
      adminOrdersProofUploadStateSchema.safeParse({
        ...state,
        status: "RESERVED",
      }).success,
    ).toBe(false);
    expect(
      adminOrdersProofUploadStateSchema.safeParse({
        ...state,
        thumbnail: null,
      }).success,
    ).toBe(false);
  });
});
