import { expect, test } from "vitest";
import {
  cartRuntimeAddCommandSchema,
  cartRuntimeHeaderSchema,
  cartRuntimeItemRecordSchema,
  cartRuntimeViewSchema,
  storefrontGiftResponseSchema,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@fan-support/contracts";

const modulePath = "./cart-runtime.js";
const runtime = (await import(modulePath).catch(() => ({}))) as Record<
  string,
  (input: unknown) => unknown
>;
function call(name: string, input: unknown) {
  expect(runtime[name], `${name} must exist`).toBeTypeOf("function");
  return runtime[name]!(input);
}
const id = (n: number) =>
  `ca000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-08T00:00:00Z";
function fixture(locale: SupportedLocale = "en") {
  const localeContext = {
    schemaVersion: 2,
    publicationMode: "DIRECT_OPERATOR_V1",
    sourceLocale: "zh-CN",
    requestedLocale: locale,
    resolvedLocale: "zh-CN",
    fallbackUsed: locale !== "zh-CN",
    translationRevision: id(9),
  };
  const media = {
    schemaVersion: 2,
    kind: "INFORMATIVE",
    url: "https://media.example.invalid/cart-test.webp",
    alt: "原始图片",
    width: 960,
    height: 1200,
    focalPoint: { x: 0.5, y: 0.5 },
    localeContext,
  };
  const command = cartRuntimeAddCommandSchema.parse({
    schemaVersion: 1,
    operation: "ADD_CART_ITEM",
    presentationLocale: locale,
    market: "TEST",
    currency: "USD",
    idolId: id(1),
    giftId: id(2),
    giftVariantId: id(3),
    quantity: 2,
    observedPriceId: id(4),
    displayMode: "anonymous",
    fanMessageLocale: "und",
  });
  const cart = cartRuntimeHeaderSchema.parse({
    schemaVersion: 1,
    id: id(5),
    version: 1,
    status: "ACTIVE",
    expired: false,
    presentationLocale: "en",
    market: "TEST",
    currency: "USD",
    expiresAt: "2026-09-09T00:00:00Z",
    createdAt: at,
    updatedAt: at,
  });
  const current = storefrontGiftResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_GIFT",
    publication: {
      id: id(6),
      revisionId: id(7),
      manifestHash: "a".repeat(64),
      publishedAt: at,
    },
    content: {
      kind: "GIFT",
      view: {
        schemaVersion: 1,
        id: id(2),
        handle: "test-gift",
        status: "active",
        localeContext,
        title: "原始礼物",
        shortDescription: "原始描述",
        description: "原始描述",
        category: "OTHER",
        contents: [],
        shippingMode: "internal_to_idol",
        primaryMedia: media,
        gallery: [],
        variants: [
          {
            schemaVersion: 1,
            id: id(3),
            label: "单件礼物",
            status: "active",
            inventoryPolicy: "PROCURE_ON_DEMAND",
          },
        ],
        seoTitle: "原始礼物",
        seoDescription: "原始描述",
      },
      details: { format: "LEGACY_TEXT", text: "原始描述" },
    },
    classification: {
      kind: "CLASSIFIED",
      giftKind: "WISH",
      profileHash: "a".repeat(64),
    },
    market: "TEST",
    currency: "USD",
    recipient: {
      kind: "PUBLISHED",
      idol: {
        schemaVersion: 1,
        id: id(1),
        handle: "test-artist",
        status: "active",
        acceptingGifts: true,
        localeContext,
        displayName: "原始艺人",
        portrait: media,
      },
    },
    offers: [
      {
        giftVariantId: id(3),
        price: { priceId: id(4), priceRevision: 1, unitAmountMinor: 250 },
        availability: "AVAILABLE",
        reason: null,
        requiresRecipient: false,
        stock: { kind: "PROCURE_ON_DEMAND" },
        maxQuantity: Number.MAX_SAFE_INTEGER,
      },
    ],
  });
  const item = cartRuntimeItemRecordSchema.parse({
    schemaVersion: 1,
    id: id(8),
    version: 1,
    cartId: cart.id,
    giftId: command.giftId,
    giftVariantId: command.giftVariantId,
    idolId: command.idolId,
    quantity: command.quantity,
    observedPriceId: command.observedPriceId,
    displayMode: "anonymous",
    nicknameProvided: false,
    hasFanMessage: false,
  });
  return { schemaVersion: 1, cart, command, current, item };
}
const addInput = (f: ReturnType<typeof fixture>) => ({
  schemaVersion: 1,
  cart: f.cart,
  command: f.command,
  current: f.current,
});
const projection = (f: ReturnType<typeof fixture>) => ({
  schemaVersion: 1,
  cart: f.cart,
  presentationLocale: f.command.presentationLocale,
  items: [{ item: f.item, current: f.current }],
});

test("verified on-demand offers accept zero physical inventory without merging or repricing", () => {
  const f = fixture();
  expect(call("decideCartRuntimeAdd", addInput(f))).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    priceId: id(4),
    unitAmountMinor: 250,
    lineTotalMinor: 500,
  });
  const view = cartRuntimeViewSchema.parse(
    call("projectCartRuntimeView", projection(f)),
  );
  expect(view.items[0]).toMatchObject({
    id: id(8),
    price: {
      status: "CURRENT",
      current: { unitAmountMinor: 250, lineTotalMinor: 500 },
    },
    availability: { status: "AVAILABLE", maxQuantity: null },
  });
});

test("scope, identity, missing recipient and exact price hints fail closed", () => {
  const f = fixture();
  for (const [command, code] of [
    [{ ...f.command, currency: "EUR" }, "SCOPE_MISMATCH"],
    [{ ...f.command, market: "OTHER" }, "SCOPE_MISMATCH"],
    [{ ...f.command, giftId: id(20) }, "GIFT_UNAVAILABLE"],
    [{ ...f.command, idolId: id(20) }, "IDOL_UNAVAILABLE"],
    [{ ...f.command, giftVariantId: id(20) }, "VARIANT_UNAVAILABLE"],
    [{ ...f.command, observedPriceId: id(20) }, "PRICE_CHANGED"],
  ])
    expect(
      call("decideCartRuntimeAdd", { ...addInput(f), command }),
    ).toMatchObject({ outcome: "FAILURE", code });
  expect(
    call("decideCartRuntimeAdd", {
      ...addInput(f),
      current: {
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      },
    }),
  ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
});

test("actual PostgreSQL expired status and cart lock block adding", () => {
  const f = fixture();
  expect(
    call("decideCartRuntimeAdd", {
      ...addInput(f),
      cart: { ...f.cart, expired: true },
    }),
  ).toMatchObject({ code: "CART_EXPIRED" });
  expect(
    call("decideCartRuntimeAdd", {
      ...addInput(f),
      cart: { ...f.cart, status: "LOCKED" },
    }),
  ).toMatchObject({ code: "CART_LOCKED" });
});

test("tracked stock limits, preorder and safe integer arithmetic retain real boundaries", () => {
  const f = fixture();
  if (f.current.outcome !== "SUCCESS") throw new Error("fixture");
  const variants = f.current.content.view.variants.map((value) => ({
    ...value,
    inventoryPolicy: "TRACKED",
  }));
  const current = {
    ...f.current,
    content: {
      ...f.current.content,
      view: { ...f.current.content.view, variants },
    },
    offers: [
      {
        ...f.current.offers[0],
        stock: { kind: "TRACKED", availableQuantity: 1 },
        maxQuantity: 1,
      },
    ],
  };
  expect(
    call("decideCartRuntimeAdd", { ...addInput(f), current }),
  ).toMatchObject({ code: "INSUFFICIENT_STOCK" });
  const huge = {
    ...f.current,
    offers: [
      {
        ...f.current.offers[0],
        price: {
          priceId: id(4),
          priceRevision: 1,
          unitAmountMinor: Number.MAX_SAFE_INTEGER,
        },
      },
    ],
  };
  expect(
    call("decideCartRuntimeAdd", { ...addInput(f), current: huge }),
  ).toMatchObject({ code: "AMOUNT_OVERFLOW" });
});

test("read preserves each independent cart line and source locale across seven presentation locales", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const f = fixture(locale);
    const input = projection(f);
    input.items.push({
      item: { ...f.item, id: id(21) as typeof f.item.id },
      current: f.current,
    });
    const result = cartRuntimeViewSchema.parse(
      call("projectCartRuntimeView", input),
    );
    expect(result.items).toHaveLength(2);
    expect(result).toMatchObject({
      presentationLocale: locale,
      currency: "USD",
      market: "TEST",
    });
    expect(result.items[0]?.idol?.localeContext).toMatchObject({
      requestedLocale: locale,
      resolvedLocale: "zh-CN",
    });
    expect(result.items[0]?.gift?.primaryMedia.schemaVersion).toBe(2);
  }
});

test("missing current content stays unavailable without stale images or a fake empty cart", () => {
  const f = fixture();
  const result = cartRuntimeViewSchema.parse(
    call("projectCartRuntimeView", {
      ...projection(f),
      items: [
        {
          item: f.item,
          current: { schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" },
        },
      ],
    }),
  );
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    idol: null,
    gift: null,
    price: { status: "UNAVAILABLE", current: null },
    availability: { status: "UNAVAILABLE" },
  });
  expect(() =>
    call("projectCartRuntimeView", {
      ...projection(f),
      items: [{ item: { ...f.item, cartId: id(30) }, current: f.current }],
    }),
  ).toThrow();
});

test("read exposes price changes without rewriting the observed price identity", () => {
  const f = fixture();
  const result = cartRuntimeViewSchema.parse(
    call("projectCartRuntimeView", {
      ...projection(f),
      items: [
        { item: { ...f.item, observedPriceId: id(30) }, current: f.current },
      ],
    }),
  );
  expect(result.items[0]?.price).toMatchObject({
    status: "CHANGED",
    observedPriceId: id(30),
    current: { priceId: id(4) },
  });
});

test("preorder remains preorder and an unselected recipient cannot add", () => {
  const f = fixture();
  if (f.current.outcome !== "SUCCESS") throw new Error("fixture");
  const current = {
    ...f.current,
    content: {
      ...f.current.content,
      view: {
        ...f.current.content.view,
        variants: f.current.content.view.variants.map((variant) => ({
          ...variant,
          inventoryPolicy: "PREORDER",
        })),
      },
    },
    offers: [
      {
        ...f.current.offers[0],
        availability: "PREORDER",
        stock: { kind: "PREORDER" },
      },
    ],
  };
  expect(
    call("decideCartRuntimeAdd", { ...addInput(f), current }),
  ).toMatchObject({ outcome: "SUCCESS" });
  const view = cartRuntimeViewSchema.parse(
    call("projectCartRuntimeView", {
      ...projection(f),
      items: [{ item: f.item, current }],
    }),
  );
  expect(view.items[0]?.availability).toEqual({
    status: "PREORDER",
    reason: null,
    maxQuantity: null,
  });
  expect(
    call("decideCartRuntimeAdd", {
      ...addInput(f),
      current: {
        ...f.current,
        recipient: { kind: "NONE" },
        offers: [{ ...f.current.offers[0], requiresRecipient: true }],
      },
    }),
  ).toMatchObject({ code: "IDOL_UNAVAILABLE" });
});

test("legacy reviewed views still project without fabricated media provenance", () => {
  const f = fixture();
  if (
    f.current.outcome !== "SUCCESS" ||
    f.current.recipient.kind !== "PUBLISHED"
  )
    throw new Error("fixture");
  const localeContext = {
    schemaVersion: 1,
    requestedLocale: "en",
    resolvedLocale: "en",
    fallbackUsed: false,
    translationRevision: id(9),
  };
  const { localeContext: originalContext, ...mediaFields } = f.current.content
    .view.primaryMedia as Extract<
    typeof f.current.content.view.primaryMedia,
    { schemaVersion: 2 }
  >;
  expect(originalContext.sourceLocale).toBe("zh-CN");
  const media = { ...mediaFields, schemaVersion: 1 };
  const current = storefrontGiftResponseSchema.parse({
    ...f.current,
    content: {
      ...f.current.content,
      view: {
        ...f.current.content.view,
        localeContext,
        primaryMedia: media,
        contents: [{ componentCode: "TEST", quantity: 1, unit: "ITEM" }],
        deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
        fulfillmentDescription: "Prepared by the studio",
      },
    },
    recipient: {
      ...f.current.recipient,
      idol: { ...f.current.recipient.idol, localeContext, portrait: media },
    },
  });
  expect(
    call("decideCartRuntimeAdd", { ...addInput(f), current }),
  ).toMatchObject({ outcome: "SUCCESS" });
  const view = cartRuntimeViewSchema.parse(
    call("projectCartRuntimeView", {
      ...projection(f),
      items: [{ item: f.item, current }],
    }),
  );
  expect(view.items[0]?.gift?.localeContext.schemaVersion).toBe(1);
  expect(view.items[0]?.gift?.primaryMedia).not.toHaveProperty("localeContext");
});

test("wrong media locale and failed current reads cannot become successful cart projections", () => {
  const f = fixture();
  if (
    f.current.outcome !== "SUCCESS" ||
    f.current.recipient.kind !== "PUBLISHED" ||
    f.current.recipient.idol.portrait.schemaVersion !== 2
  )
    throw new Error("fixture");
  const current = {
    ...f.current,
    recipient: {
      ...f.current.recipient,
      idol: {
        ...f.current.recipient.idol,
        portrait: {
          ...f.current.recipient.idol.portrait,
          localeContext: {
            ...f.current.recipient.idol.portrait.localeContext,
            requestedLocale: "th",
          },
        },
      },
    },
  };
  expect(
    call("decideCartRuntimeAdd", { ...addInput(f), current }),
  ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  expect(() =>
    call("projectCartRuntimeView", {
      ...projection(f),
      items: [{ item: f.item, current }],
    }),
  ).toThrow();
  expect(() =>
    call("projectCartRuntimeView", {
      ...projection(f),
      items: [
        {
          item: f.item,
          current: {
            schemaVersion: 1,
            outcome: "FAILURE",
            code: "CONTENT_UNAVAILABLE",
          },
        },
      ],
    }),
  ).toThrow();
});

test("canonical request serialization ignores key order, preserves every private value and never includes transport data", () => {
  const command = { ...fixture().command, fanMessage: "🙂 hello" };
  const reversed = Object.fromEntries(Object.entries(command).reverse());
  expect(call("canonicalCartRuntimeRequest", command)).toBe(
    call("canonicalCartRuntimeRequest", reversed),
  );
  expect(call("canonicalCartRuntimeRequest", command)).not.toBe(
    call("canonicalCartRuntimeRequest", {
      ...command,
      fanMessage: "🙂 goodbye",
    }),
  );
  expect(() =>
    call("canonicalCartRuntimeRequest", { ...command, token: "private" }),
  ).toThrow();
});
