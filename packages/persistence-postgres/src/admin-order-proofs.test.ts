import { randomUUID } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import {
  adminOrdersAccessSchema,
  adminOrdersPrincipalSchema,
  deliveryProofRenditionObjectKey,
  deliveryProofSourceObjectKey,
  type AdminOrdersPermission,
  type AdminOrdersStoreRequest,
} from "@fan-support/contracts";
import { proofActions } from "./admin-orders-rules.js";
import {
  attachDeliveryProofs,
  withdrawDeliveryProof,
} from "./admin-order-proofs-write.js";
import { readAdminProofRendition } from "./admin-order-proofs-read.js";
import {
  completeAdminProofUpload,
  readAdminProofUpload,
  reserveAdminProofUpload,
} from "./admin-order-proof-uploads.js";

const orderId = randomUUID(),
  fulfillmentId = randomUUID(),
  uploadId = randomUUID(),
  proofId = randomUUID();
const access = adminOrdersAccessSchema.parse({
  schemaVersion: 1,
  sessionTokenDigest: "a".repeat(64),
  csrfTokenDigest: "b".repeat(64),
  requestId: randomUUID(),
  correlationId: randomUUID(),
});
const principal = (permissions: AdminOrdersPermission[]) =>
  adminOrdersPrincipalSchema.parse({
    actorId: randomUUID(),
    sessionId: randomUUID(),
    authorizedAt: "2026-09-27T00:00:00.000000Z",
    sessionExpiresAt: "2026-09-27T01:00:00.000000Z",
    permissions,
    reviewLocales: [],
  });
const operator = principal(["orders.read", "orders.fulfillment"]);
const manager = principal(["orders.read", "orders.manage"]);
const client = (values: unknown[][] = []) => ({
  query: vi.fn(async (sql: string, parameters?: unknown[]) => {
    void sql;
    void parameters;
    return { rows: values.shift() ?? [] };
  }),
  release: () => undefined,
});
const line = (overrides: Record<string, unknown> = {}) => ({
  item_id: randomUUID(),
  fulfillment_id: fulfillmentId,
  fulfillment_version: 3,
  status: "PREPARING",
  gift_kind: "PHYSICAL",
  ...overrides,
});
const mutation = {
  schemaVersion: 1 as const,
  orderId,
  expectedOrderVersion: 2,
  idempotencyKey: "proof-operation-0001",
  reasonCode: "DELIVERY_PROOF_CONFIRMED",
  fulfillmentId,
  expectedFulfillmentVersion: 3,
};
const request = (command: Record<string, unknown>) =>
  ({
    schemaVersion: 1,
    access,
    requestHash: "c".repeat(64),
    command: { ...mutation, ...command },
  }) as AdminOrdersStoreRequest;
const sql = (db: ReturnType<typeof client>) =>
  db.query.mock.calls.map(([statement]) => String(statement));

describe("proof action gating", () => {
  test.each([
    [{ status: "PREPARING" }, 0, ["orders.fulfillment"], ["ATTACH"]],
    [{ status: "DELIVERED" }, 2, ["orders.fulfillment"], ["ATTACH"]],
    [{ status: "DELIVERED" }, 3, ["orders.fulfillment"], []],
    [{ status: "PENDING" }, 0, ["orders.fulfillment"], []],
    [{ status: "ON_HOLD" }, 0, ["orders.fulfillment"], []],
    [
      { status: "DELIVERED", gift_kind: "VIRTUAL" },
      0,
      ["orders.fulfillment"],
      [],
    ],
    [{ status: "DELIVERED" }, 1, ["orders.manage"], ["WITHDRAW"]],
    [{ status: "DELIVERED" }, 0, ["orders.manage"], []],
    [
      { status: "DELIVERED" },
      1,
      ["orders.fulfillment", "orders.manage"],
      ["ATTACH", "WITHDRAW"],
    ],
  ] as const)(
    "%j with %i active proofs and %j",
    (state, active, grants, expected) =>
      expect(proofActions(line(state), active, [...grants])).toEqual(expected),
  );
});

describe("attaching proofs", () => {
  const attach = (uploadIds: string[]) =>
    request({ action: "ATTACH_PROOFS", uploadIds, privacyConfirmed: true });
  test("a full line refuses before reading uploads", async () => {
    const db = client([[line()], [{ active: 2, last_sequence: 4 }]]);
    expect(
      await attachDeliveryProofs(
        db,
        attach([randomUUID(), randomUUID()]),
        operator,
      ),
    ).toMatchObject({ code: "PROOF_LIMIT_REACHED" });
    expect(db.query).toHaveBeenCalledTimes(2);
  });
  test("digital lines never accept studio photos", async () => {
    const db = client([
      [line({ gift_kind: "VIRTUAL" })],
      [{ active: 0, last_sequence: 0 }],
    ]);
    expect(
      await attachDeliveryProofs(db, attach([uploadId]), operator),
    ).toMatchObject({ code: "TRANSITION_NOT_ALLOWED" });
  });
  test("uploads must be the operator's own READY uploads for this line", async () => {
    for (const [upload, code] of [
      [
        { actor_id: randomUUID(), status: "READY", attached: false },
        "NOT_FOUND",
      ],
      [
        { actor_id: operator.actorId, status: "RESERVED", attached: false },
        "CONFLICT",
      ],
      [
        { actor_id: operator.actorId, status: "READY", attached: true },
        "CONFLICT",
      ],
    ] as const) {
      const db = client([
        [line()],
        [{ active: 0, last_sequence: 0 }],
        [{ id: uploadId, fulfillment_id: fulfillmentId, ...upload }],
      ]);
      expect(
        await attachDeliveryProofs(db, attach([uploadId]), operator),
      ).toMatchObject({ code });
      expect(sql(db).some((statement) => statement.includes("INSERT"))).toBe(
        false,
      );
    }
  });
  test("appends after the last sequence, including withdrawn photos", async () => {
    const second = randomUUID();
    const db = client([
      [line({ status: "DELIVERED" })],
      [{ active: 1, last_sequence: 5 }],
      [uploadId, second].map((id) => ({
        id,
        fulfillment_id: fulfillmentId,
        actor_id: operator.actorId,
        status: "READY",
        attached: false,
      })),
      [{ live: true }],
    ]);
    const result = await attachDeliveryProofs(
      db,
      attach([uploadId, second]),
      operator,
    );
    expect(result).toMatchObject({ outcome: "SUCCESS", kind: "MUTATION" });
    const inserts = db.query.mock.calls.filter(([statement]) =>
      String(statement).includes("INSERT INTO public.fulfillment_proofs"),
    );
    expect(inserts.map(([, values]) => (values as unknown[])[5])).toEqual([
      6, 7,
    ]);
    expect(String(inserts[0]![0])).toContain(",true)");
    expect(
      inserts.every(
        ([, values]) =>
          (values as unknown[])[4] ===
          (result as { resultId: string }).resultId,
      ),
    ).toBe(true);
    expect(
      sql(db).some((statement) =>
        statement.includes("admin_order_operation_receipts"),
      ),
    ).toBe(true);
  });
});

describe("withdrawing proofs", () => {
  const withdraw = request({
    action: "WITHDRAW_PROOF",
    reasonCode: "PROOF_PRIVACY_ISSUE",
    proofId,
    confirmed: true,
  });
  test("only an active proof of this line can be withdrawn", async () => {
    const db = client([[line({ status: "DELIVERED" })], []]);
    expect(await withdrawDeliveryProof(db, withdraw, manager)).toMatchObject({
      code: "NOT_FOUND",
    });
  });
  test("records the manager's reason and a receipt", async () => {
    const db = client([
      [line({ status: "DELIVERED" })],
      [{ id: proofId }],
      [{ live: true }],
    ]);
    expect(await withdrawDeliveryProof(db, withdraw, manager)).toMatchObject({
      outcome: "SUCCESS",
    });
    const insert = db.query.mock.calls.find(([statement]) =>
      String(statement).includes("fulfillment_proof_withdrawals("),
    )!;
    expect(insert[1]).toEqual(
      expect.arrayContaining([proofId, orderId, "PROOF_PRIVACY_ISSUE"]),
    );
  });
});

describe("proof upload reservations", () => {
  const begin = request({
    action: "BEGIN_PROOF_UPLOAD",
    reasonCode: "DELIVERY_PROOF_UPLOAD",
    checksumSha256: "d".repeat(64),
    byteSize: 4096,
    mimeType: "image/jpeg",
  });
  test("reserves a server-assigned private key bounded by the session", async () => {
    const db = client([
      [line()],
      [{ active: 0, last_sequence: 0 }],
      [{ live: true }],
      [],
      [],
      [],
    ]);
    db.query.mockImplementation(
      async (statement: string, values?: unknown[]) => {
        if (statement.includes("FROM public.fulfillment_proof_uploads u WHERE"))
          return {
            rows: [
              {
                id: values![0],
                order_id: orderId,
                fulfillment_id: fulfillmentId,
                actor_id: operator.actorId,
                session_id: operator.sessionId,
                status: "RESERVED",
                source_object_key: deliveryProofSourceObjectKey(
                  String(values![0]),
                ),
                source_checksum_sha256: "d".repeat(64),
                source_byte_size: 4096,
                source_mime_type: "image/jpeg",
                created_at: "2026-09-27T00:00:00.000000Z",
                expires_at: "2026-09-27T00:15:00.000000Z",
                live: true,
              },
            ],
          };
        if (
          statement.includes(
            "FROM public.order_items i JOIN public.fulfillments",
          )
        )
          return { rows: [line()] };
        if (statement.includes("last_sequence"))
          return { rows: [{ active: 0, last_sequence: 0 }] };
        if (statement.includes(" live FROM public.admin_sessions"))
          return { rows: [{ live: true }] };
        return { rows: [] };
      },
    );
    const result = await reserveAdminProofUpload(db, begin, operator);
    expect(result).toMatchObject({
      kind: "PROOF_RESERVATION",
      replayed: false,
      source: { checksumSha256: "d".repeat(64), mimeType: "image/jpeg" },
    });
    const insert = db.query.mock.calls.find(([statement]) =>
      String(statement).includes(
        "INSERT INTO public.fulfillment_proof_uploads",
      ),
    )!;
    expect(String(insert[0])).toContain(
      "least(transaction_timestamp()+interval '900 seconds'",
    );
    const values = insert[1] as unknown[];
    expect(values[6]).toBe(deliveryProofSourceObjectKey(String(values[0])));
  });
  test("a digital line cannot reserve a photo upload", async () => {
    const db = client([
      [line({ gift_kind: "VIRTUAL" })],
      [{ active: 0, last_sequence: 0 }],
    ]);
    expect(await reserveAdminProofUpload(db, begin, operator)).toMatchObject({
      code: "TRANSITION_NOT_ALLOWED",
    });
  });
});

describe("completing proof uploads", () => {
  const source = {
    objectKey: deliveryProofSourceObjectKey(uploadId),
    checksumSha256: "d".repeat(64),
    byteSize: 4096,
    mimeType: "image/jpeg" as const,
  };
  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: uploadId,
    order_id: orderId,
    fulfillment_id: fulfillmentId,
    actor_id: operator.actorId,
    session_id: operator.sessionId,
    status: "RESERVED",
    source_object_key: source.objectKey,
    source_checksum_sha256: source.checksumSha256,
    source_byte_size: source.byteSize,
    source_mime_type: source.mimeType,
    created_at: "2026-09-27T00:00:00.000000Z",
    expires_at: "2026-09-27T00:15:00.000000Z",
    live: true,
    ...overrides,
  });
  const rendition = (fill: string, width: number, height: number) => ({
    objectKey: deliveryProofRenditionObjectKey(uploadId, fill.repeat(64)),
    checksumSha256: fill.repeat(64),
    byteSize: 1024,
    width,
    height,
    mimeType: "image/webp" as const,
  });
  const completion = {
    schemaVersion: 1 as const,
    access,
    orderId,
    uploadId,
    source,
    result: {
      schemaVersion: 1 as const,
      outcome: "SUCCESS" as const,
      profileVersion: 1 as const,
      uploadId,
      metadataPolicy: "STRIP_ALL_SRGB" as const,
      display: rendition("e", 1600, 1200),
      thumbnail: rendition("f", 480, 360),
    },
  };
  test("only the reserving session reads its own unexpired reservation", async () => {
    const read = request({ action: "COMPLETE_PROOF_UPLOAD", uploadId });
    const other = client([[stored({ session_id: randomUUID() })]]);
    expect(await readAdminProofUpload(other, read, operator)).toMatchObject({
      code: "NOT_FOUND",
    });
    const expired = client([[stored({ live: false })]]);
    expect(await readAdminProofUpload(expired, read, operator)).toMatchObject({
      code: "CONFLICT",
    });
  });
  test("records verified renditions once and replays a READY upload", async () => {
    const db = client([[stored()], [{ live: true }]]);
    expect(
      await completeAdminProofUpload(db, completion as never, operator),
    ).toMatchObject({ kind: "PROOF_UPLOAD", width: 1600, height: 1200 });
    const update = db.query.mock.calls.find(([statement]) =>
      String(statement).includes("UPDATE public.fulfillment_proof_uploads"),
    )!;
    expect(update[1]).toEqual(
      expect.arrayContaining([
        completion.result.display.objectKey,
        completion.result.thumbnail.objectKey,
      ]),
    );
    const ready = client([
      [stored({ status: "READY", display_width: 1200, display_height: 900 })],
    ]);
    expect(
      await completeAdminProofUpload(ready, completion as never, operator),
    ).toMatchObject({ width: 1200, height: 900 });
    expect(ready.query).toHaveBeenCalledTimes(1);
  });
  test("a changed source identity cannot be recorded", async () => {
    const db = client([[stored({ source_byte_size: 1 })]]);
    expect(
      await completeAdminProofUpload(db, completion as never, operator),
    ).toMatchObject({ code: "CONFLICT" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe("viewing proofs", () => {
  test("requires delivery handling authority and selects the requested rendition", async () => {
    const view = request({
      action: "VIEW_PROOF",
      proofId,
      rendition: "display",
    });
    const reader = principal(["orders.read"]);
    expect(await readAdminProofRendition(client(), view, reader)).toMatchObject(
      { code: "FORBIDDEN" },
    );
    const db = client([[]]);
    expect(await readAdminProofRendition(db, view, operator)).toMatchObject({
      code: "NOT_FOUND",
    });
    expect(String(db.query.mock.calls[0]![0])).toContain(
      "u.display_object_key",
    );
  });
});
