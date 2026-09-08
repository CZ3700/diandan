import { randomUUID } from "node:crypto";
import {
  cartRuntimeCurrentResponseSchema,
  cartEditResponseSchema,
  checkoutPreflightResponseSchema,
  storefrontGiftResponseSchema,
} from "@fan-support/contracts";

/** Records only fixed request categories/statuses; test email/message/credentials never enter reports. */
export function createCheckoutProtocolClient({
  base,
  checkoutBase,
  origin,
  fixtures,
  check,
  canaries,
}) {
  const events = [];
  const forbidden = new Set([
    "email",
    "fanMessage",
    "supportIntentId",
    "customerContactId",
    "fulfillmentProfileId",
    "encryptedDataKey",
    "emailCiphertext",
    "emailLookupHmac",
    "tokenDigest",
    "sessionToken",
    "csrfToken",
    "objectKey",
    "plaintextBase64",
  ]);
  const safe = (value) =>
    !value ||
    typeof value !== "object" ||
    Object.entries(value).every(
      ([key, child]) => !forbidden.has(key) && safe(child),
    );
  async function request(
    category,
    path,
    {
      target = checkoutBase,
      method = "POST",
      body,
      session,
      key,
      expected = 200,
      code,
      headers = {},
      cart = false,
    } = {},
  ) {
    const response = await globalThis.fetch(target + path, {
      method,
      redirect: "error",
      headers: {
        ...(method === "GET"
          ? {}
          : { origin, "content-type": "application/json" }),
        ...(session
          ? { cookie: session.cookie, "x-csrf-token": session.csrf }
          : {}),
        ...(key ? { "idempotency-key": key } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Checkout response is not JSON");
    }
    const schema = cart
      ? method === "PATCH" || method === "DELETE"
        ? cartEditResponseSchema
        : cartRuntimeCurrentResponseSchema
      : checkoutPreflightResponseSchema;
    const parsed = schema.safeParse(json);
    const actualCode =
      parsed.success && parsed.data.outcome === "FAILURE"
        ? parsed.data.code
        : null;
    events.push({ category, status: response.status, code: actualCode });
    console.log(
      `Checkout HTTP ${JSON.stringify({ ordinal: events.length, category, status: response.status, code: actualCode })}`,
    );
    check(
      (Array.isArray(expected) ? expected : [expected]).includes(
        response.status,
      ),
      `checkout ${category} returns expected status`,
    );
    check(
      parsed.success,
      `checkout ${category} satisfies its exact response schema`,
    );
    check(
      response.headers.get("cache-control") === "private, no-store" &&
        response.headers.get("x-robots-tag") === "noindex, nofollow",
      `checkout ${category} is private and non-indexed`,
    );
    check(
      safe(json) && canaries.every((value) => !text.includes(value)),
      `checkout ${category} does not expose private text or internal storage`,
    );
    if (code)
      check(
        (Array.isArray(code) ? code : [code]).includes(actualCode),
        `checkout ${category} retains its precise rejection code`,
      );
    if (response.headers.get("x-csrf-token") && session)
      session.csrf = response.headers.get("x-csrf-token");
    if (cart && parsed.data.outcome === "SUCCESS" && session)
      session.cart = parsed.data.cart;
    return { data: parsed.data, response };
  }
  async function initialize(locale = "en", scope = fixtures.markets[0]) {
    const { data, response } = await request(
      "INITIALIZE_CART",
      "/api/v1/carts",
      {
        target: base,
        cart: true,
        body: { schemaVersion: 1, presentationLocale: locale, ...scope },
      },
    );
    const cookie = response.headers.get("set-cookie");
    check(
      cookie?.includes("HttpOnly") &&
        cookie.includes("Secure") &&
        cookie.includes("SameSite=Lax") &&
        !cookie.includes("Domain="),
      "checkout uses an established opaque Secure HttpOnly cart cookie",
    );
    return {
      cookie: cookie.split(";")[0],
      csrf: response.headers.get("x-csrf-token"),
      cart: data.cart,
    };
  }
  async function add(
    session,
    {
      gift = fixtures.gifts[0],
      artist = fixtures.artists[0],
      variant = gift.variants[0],
      quantity = 1,
    } = {},
  ) {
    const query = new globalThis.URLSearchParams({
      locale: session.cart.presentationLocale,
      market: session.cart.market,
      currency: session.cart.currency,
      idol: artist.id,
    });
    const response = await globalThis.fetch(
      `${base}/api/v1/storefront-gifts/${gift.handle}?${query}`,
      { signal: globalThis.AbortSignal.timeout(30_000) },
    );
    const current = storefrontGiftResponseSchema.parse(await response.json());
    check(
      response.status === 200 && current.outcome === "SUCCESS",
      "checkout add uses the actual current published gift price",
    );
    const offer = current.offers.find(
      (value) => value.giftVariantId === variant.id,
    );
    check(
      offer?.price && offer.availability !== "UNAVAILABLE",
      "checkout fixture variant is actually available for its selected recipient",
    );
    const body = {
      schemaVersion: 1,
      presentationLocale: session.cart.presentationLocale,
      market: session.cart.market,
      currency: session.cart.currency,
      idolId: artist.id,
      giftId: gift.id,
      giftVariantId: variant.id,
      observedPriceId: offer.price.priceId,
      quantity,
      displayMode: "nickname",
      displayName: canaries[1],
      fanMessage: canaries[0],
      fanMessageLocale: "ja",
    };
    const result = await request("ADD_CART_ITEM", "/api/v1/cart/items", {
      target: base,
      cart: true,
      body,
      session,
      key: randomUUID(),
    });
    return { body, cartItemId: result.data.cartItemId };
  }
  const validate = async (
    session,
    {
      locale = session.cart.presentationLocale,
      key = randomUUID(),
      ...options
    } = {},
  ) =>
    request("VALIDATE", "/api/v1/cart/validate", {
      body: {
        schemaVersion: 1,
        expectedCartVersion: session.cart.version,
        presentationLocale: locale,
      },
      session,
      key,
      ...options,
    });
  const createBody = (session, preflight, email) => ({
    schemaVersion: 1,
    preflightId: preflight.id,
    expectedCartVersion: session.cart.version,
    email,
    policyAcceptances: preflight.policies.map(
      ({ policyKey, policyRevisionId, policyTranslationRevisionId }) => ({
        policyKey,
        policyRevisionId,
        policyTranslationRevisionId,
        accepted: true,
      }),
    ),
  });
  const create = async (session, preflight, email, options = {}) =>
    request("CREATE", "/api/v1/checkout/sessions", {
      body: createBody(session, preflight, email),
      session,
      key: randomUUID(),
      ...options,
    });
  const read = async (session, id, options = {}) =>
    request("STATUS", `/api/v1/checkout/sessions/${id}/status`, {
      method: "GET",
      session,
      ...options,
    });
  return {
    request,
    initialize,
    add,
    validate,
    createBody,
    create,
    read,
    events,
  };
}
