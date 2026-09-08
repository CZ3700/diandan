import { describe, expect, it } from "vitest";
import {
  checkoutPreflightObservationSchema,
  checkoutPreflightSessionRecordSchema,
  checkoutPreflightSaveCommandSchema,
} from "@fan-support/contracts";

const id = (n: number) =>
  `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = "a".repeat(64);
const time = "2026-09-09T01:00:00.123456Z";
const expiry = "2026-09-09T01:15:00.123456Z";
const provenance = {
  schemaVersion: 1,
  mode: "DAILY",
  publicationMode: "DIRECT_OPERATOR_V1",
  publicationId: id(1),
  revisionId: id(2),
  manifestHash: hash,
  sourceHash: hash,
  sourceLocale: "zh-CN",
  requestedLocale: "en",
  resolvedLocale: "zh-CN",
  translationRevisionId: id(3),
  fallbackUsed: true,
};
const media = {
  schemaVersion: 1,
  assetId: id(4),
  checksum: hash,
  objectKey: "original/photo.webp",
  metadataRevisionId: id(2),
  alt: "原文",
  altTranslation: provenance,
};
function current(quantities = [2, 3], onHand = 5, tracked = true) {
  const lines = quantities.map((quantity, index) => ({
    schemaVersion: 1,
    cartItemId: id(10 + index),
    itemVersion: 1,
    supportIntentId: id(20 + index),
    intentVersion: 1,
    fulfillmentProfileId: id(30 + index),
    idolId: id(40 + index),
    idolHandle: `idol-${index}`,
    idolDisplayName: "艺人",
    idolTranslation: provenance,
    idolPortrait: media,
    giftId: id(50),
    giftVariantId: id(51),
    giftTitle: "礼物",
    giftVariantLabel: "默认",
    giftTranslation: provenance,
    giftImage: media,
    observedPriceId: id(60),
    priceId: id(60),
    priceRevision: 1,
    unitAmountMinor: 10,
    quantity,
    displayMode: "anonymous",
    inventoryPolicy: tracked ? "TRACKED" : "PROCURE_ON_DEMAND",
    inventoryItemId: tracked ? id(70) : null,
    eligibility: "ALL_ACTIVE_ARTISTS",
  }));
  return {
    schemaVersion: 1,
    cart: {
      schemaVersion: 1,
      id: id(80),
      version: 3,
      status: "ACTIVE",
      expired: false,
      presentationLocale: "en",
      market: "TEST",
      currency: "USD",
      createdAt: time,
      updatedAt: time,
      expiresAt: "2026-09-10T01:00:00Z",
    },
    evaluatedAt: time,
    consent: {
      schemaVersion: 1,
      cartId: id(80),
      cartVersion: 3,
      presentationLocale: "en",
      market: "TEST",
      currency: "USD",
      lines,
      policies: [
        {
          schemaVersion: 1,
          policyKey: "terms",
          kind: "TERMS",
          locale: "en",
          policyRevisionId: id(81),
          policyTranslationRevisionId: id(82),
          publicationId: id(83),
          manifestHash: hash,
          sourceHash: hash,
          title: "Terms",
          body: "<p>Terms</p>",
          effectiveAt: "2026-09-08T00:00:00Z",
        },
      ],
    },
    inventory: tracked
      ? lines.map((line) => ({
          schemaVersion: 1,
          cartItemId: line.cartItemId,
          inventoryItem: {
            schemaVersion: 1,
            id: id(70),
            giftVariantId: id(51),
            sku: "TEST-GIFT",
            policy: "TRACKED",
            status: "ACTIVE",
          },
          locations: [
            {
              location: {
                schemaVersion: 1,
                id: id(71),
                code: "TEST",
                status: "ACTIVE",
              },
              balance: {
                schemaVersion: 1,
                inventoryItemId: id(70),
                inventoryLocationId: id(71),
                onHand,
                reserved: 0,
                version: 1,
              },
            },
          ],
        }))
      : [],
  };
}
const load = () => import("./checkout-preflight.js").catch(() => null);

describe("whole-cart reservation planning", () => {
  it("rejects two individually affordable lines whose shared stock is insufficient", async () => {
    const domain = await load();
    expect(domain?.selectCheckoutInventory(current([3, 3], 5))).toMatchObject({
      outcome: "FAILURE",
      code: "INSUFFICIENT_STOCK",
    });
  });
  it("plans shared balances progressively without duplicate targets", async () => {
    const domain = await load();
    const facts = current();
    const selected = domain?.selectCheckoutInventory(facts);
    expect(selected?.outcome).toBe("SUCCESS");
    if (selected?.outcome !== "SUCCESS") return;
    expect(selected.targets).toHaveLength(1);
    const entry = facts.inventory[0]!;
    const result = domain?.planCheckoutInventory({
      schemaVersion: 1,
      current: facts,
      assignments: selected.assignments,
      lockedInventory: entry.locations.map(({ location, balance }) => ({
        inventoryItem: entry.inventoryItem,
        inventoryLocation: location,
        balance,
        reservation: null,
      })),
      reservations: facts.consent.lines.map((line, index) => ({
        cartItemId: line.cartItemId,
        reservationId: id(90 + index),
      })),
      quoteId: id(95),
      expiresAt: expiry,
      evaluatedAt: time,
    });
    expect(result?.outcome).toBe("SUCCESS");
    if (result?.outcome !== "SUCCESS") return;
    expect(
      result.decisions.map((decision) => decision.expectedBalanceVersion),
    ).toEqual([1, 2]);
    expect(result.decisions.at(-1)?.nextBalance.reserved).toBe(5);
  });
  it("uses lower current locked stock and refuses incomplete or duplicate bindings", async () => {
    const domain = await load();
    const facts = current();
    const selected = domain?.selectCheckoutInventory(facts);
    expect(selected?.outcome).toBe("SUCCESS");
    if (selected?.outcome !== "SUCCESS") return;
    const entry = facts.inventory[0]!;
    const command = {
      schemaVersion: 1,
      current: facts,
      assignments: selected.assignments,
      lockedInventory: entry.locations.map(({ location, balance }) => ({
        inventoryItem: entry.inventoryItem,
        inventoryLocation: location,
        balance,
        reservation: null,
      })),
      reservations: facts.consent.lines.map((line, index) => ({
        cartItemId: line.cartItemId,
        reservationId: id(90 + index),
      })),
      quoteId: id(95),
      expiresAt: expiry,
      evaluatedAt: time,
    };
    expect(
      domain?.planCheckoutInventory({
        ...command,
        lockedInventory: command.lockedInventory.map((row) => ({
          ...row,
          balance: { ...row.balance, onHand: 4 },
        })),
      }),
    ).toMatchObject({ outcome: "FAILURE", code: "INSUFFICIENT_STOCK" });
    for (const changes of [
      { assignments: selected.assignments.slice(1) },
      { reservations: [command.reservations[0], command.reservations[0]] },
      {
        lockedInventory: [
          ...command.lockedInventory,
          ...command.lockedInventory,
        ],
      },
    ])
      expect(
        domain?.planCheckoutInventory({ ...command, ...changes }),
      ).toMatchObject({ outcome: "FAILURE", code: "INVALID_COMMAND" });
    expect(facts.inventory[0]!.locations[0]!.balance.reserved).toBe(0);
  });
  it("rejects conflicting snapshots of the same stock and expired nontracked plans", async () => {
    const domain = await load();
    const facts = current();
    facts.inventory[1]!.locations[0]!.balance.onHand = 10;
    expect(domain?.selectCheckoutInventory(facts)).toMatchObject({
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
    expect(
      domain?.planCheckoutInventory({
        schemaVersion: 1,
        current: current([1], 0, false),
        assignments: [],
        lockedInventory: [],
        reservations: [],
        quoteId: id(95),
        expiresAt: time,
        evaluatedAt: time,
      }),
    ).toMatchObject({ outcome: "FAILURE", code: "PREFLIGHT_EXPIRED" });
  });
  it("does not manufacture stock or reservations for procure-on-demand", async () => {
    const domain = await load();
    const facts = current([2147483647], 0, false);
    expect(domain?.selectCheckoutInventory(facts)).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      assignments: [],
      targets: [],
    });
    expect(
      domain?.planCheckoutInventory({
        schemaVersion: 1,
        current: facts,
        assignments: [],
        lockedInventory: [],
        reservations: [],
        quoteId: id(95),
        expiresAt: expiry,
        evaluatedAt: time,
      }),
    ).toEqual({ schemaVersion: 1, outcome: "SUCCESS", decisions: [] });
  });
  it("never splits one line across two insufficient locations", async () => {
    const domain = await load();
    const facts = current([6], 3);
    const entry = facts.inventory[0]!;
    entry.locations.push({
      location: { ...entry.locations[0]!.location, id: id(72) },
      balance: { ...entry.locations[0]!.balance, inventoryLocationId: id(72) },
    });
    expect(domain?.selectCheckoutInventory(facts)).toMatchObject({
      outcome: "FAILURE",
      code: "INSUFFICIENT_STOCK",
    });
  });
  it("keeps original text and provenance in public review without private storage fields", async () => {
    const domain = await load();
    const facts = current([2]);
    const quote = {
      schemaVersion: 1,
      id: id(95),
      cartVersion: 3,
      expiresAt: expiry,
      amount: {
        schemaVersion: 1,
        market: "TEST",
        currency: "USD",
        quoteRevision: 1,
        quoteExpiresAt: expiry,
        subtotalMinor: 20,
        taxAmountMinor: 0,
        shippingAmountMinor: 0,
        feeAmountMinor: 0,
        discountAmountMinor: 0,
        totalAmountMinor: 20,
      },
      lines: [
        {
          schemaVersion: 1,
          cartItemId: id(10),
          giftVariantId: id(51),
          priceId: id(60),
          priceRevision: 1,
          quantity: 2,
          unitAmountMinor: 10,
          lineSubtotalMinor: 20,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          lineTotalMinor: 20,
        },
      ],
    };
    const observation = {
      schemaVersion: 1,
      id: id(96),
      consentHash: hash,
      consent: facts.consent,
      quote,
      createdAt: time,
      expiresAt: expiry,
    };
    const view = domain?.projectCheckoutPreflight(observation);
    expect(view?.lines[0]?.idolLocaleContext).toMatchObject({
      schemaVersion: 2,
      sourceLocale: "zh-CN",
      requestedLocale: "en",
      resolvedLocale: "zh-CN",
      fallbackUsed: true,
    });
    expect(view?.amount.totalAmountMinor).toBe(20);
    const encoded = JSON.stringify(view);
    for (const key of [
      "supportIntentId",
      "fulfillmentProfileId",
      "objectKey",
      "checksum",
      "email",
      "sourceHash",
    ])
      expect(encoded).not.toContain(`"${key}"`);
    const session = {
      schemaVersion: 1,
      receipt: {
        schemaVersion: 1,
        preflightId: id(96),
        cartId: id(80),
        cartVersion: 4,
        checkoutSessionId: id(97),
        orderId: id(98),
        publicOrderId: id(99),
        occurredAt: time,
      },
      observation,
      evaluatedAt: expiry,
      expired: true,
      status: "READY",
      orderStatus: "PENDING_PAYMENT",
      paymentStatus: "UNPAID",
    };
    expect(domain?.projectCheckoutSession(session)).toMatchObject({
      id: id(97),
      expired: true,
      presentationLocale: "en",
      lines: view?.lines,
      amount: view?.amount,
    });
    expect
      .soft(
        checkoutPreflightSessionRecordSchema.safeParse({
          ...session,
          receipt: { ...session.receipt, cartId: id(100) },
        }).success,
      )
      .toBe(false);
    expect
      .soft(
        checkoutPreflightObservationSchema.safeParse({
          ...observation,
          createdAt: expiry,
        }).success,
      )
      .toBe(false);
    expect
      .soft(
        checkoutPreflightSaveCommandSchema.safeParse({
          schemaVersion: 1,
          accesses: [
            { schemaVersion: 1, tokenDigest: hash, pepperVersion: "v1" },
          ],
          cartId: id(100),
          observation,
        }).success,
      )
      .toBe(false);
  });
});
