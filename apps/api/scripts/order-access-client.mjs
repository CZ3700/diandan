import { orderAccessResponseSchema } from "@fan-support/contracts";

const forbidden = new Set([
  "token",
  "tokenDigest",
  "sessionToken",
  "sessionTokenDigest",
  "csrfToken",
  "pepperVersion",
  "orderId",
  "supportIntentId",
  "customerContactId",
  "fanMessage",
  "displayNameCiphertext",
  "email",
  "emailCiphertext",
  "emailLookupHmac",
  "fulfillmentProfileId",
  "objectKey",
  "metadataRevisionId",
  "translationRevisionId",
  "giftVariantId",
  "priceId",
  "encryptedDataKey",
]);
function safe(value) {
  return (
    !value ||
    typeof value !== "object" ||
    Object.entries(value).every(
      ([key, child]) => !forbidden.has(key) && safe(child),
    )
  );
}

/** Only fixed request categories/statuses enter reports. All credential bytes remain callback-local. */
export function createOrderAccessProtocolClient({
  accessBase,
  origin,
  check,
  canaries,
}) {
  const events = [];
  async function request(
    category,
    path,
    {
      target = accessBase,
      method = "POST",
      body,
      session,
      expected = 200,
      code,
      headers = {},
    } = {},
  ) {
    const response = await globalThis.fetch(target + path, {
      method,
      redirect: "error",
      headers: {
        ...(method === "GET"
          ? {}
          : { origin, "content-type": "application/json" }),
        ...(session?.cookie ? { cookie: session.cookie } : {}),
        ...(session?.csrf && method !== "GET"
          ? { "x-csrf-token": session.csrf }
          : {}),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      signal: globalThis.AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Order access response is not JSON");
    }
    const parsed = orderAccessResponseSchema.safeParse(json);
    const actualCode =
      parsed.success && parsed.data.outcome === "FAILURE"
        ? parsed.data.code
        : null;
    events.push({ category, status: response.status, code: actualCode });
    console.log(`Order access HTTP ${JSON.stringify(events.at(-1))}`);
    check(
      (Array.isArray(expected) ? expected : [expected]).includes(
        response.status,
      ),
      `order access ${category} returns expected status`,
    );
    check(
      parsed.success,
      `order access ${category} satisfies its exact response schema`,
    );
    check(
      response.headers.get("cache-control") === "private, no-store" &&
        response.headers.get("x-robots-tag") === "noindex, nofollow" &&
        response.headers.get("referrer-policy") === "no-referrer",
      `order access ${category} is private, non-indexed and suppresses referrers`,
    );
    check(
      safe(json) && canaries.every((value) => !text.includes(value)),
      `order access ${category} exposes no credential or private storage fields`,
    );
    if (code)
      check(
        (Array.isArray(code) ? code : [code]).includes(actualCode),
        `order access ${category} retains its precise rejection code`,
      );
    const cookie = response.headers.get("set-cookie");
    if (cookie && session) {
      check(
        cookie.includes("HttpOnly") &&
          cookie.includes("Secure") &&
          cookie.includes("SameSite=Strict") &&
          cookie.includes("Path=/") &&
          !cookie.includes("Domain="),
        "Order scope uses a host-only Secure HttpOnly SameSite cookie",
      );
      session.cookie = cookie.split(";")[0];
      const token = session.cookie.split("=")[1];
      if (token) canaries.push(token);
    }
    if (response.headers.get("x-csrf-token") && session) {
      session.csrf = response.headers.get("x-csrf-token");
      canaries.push(session.csrf);
    }
    return { data: parsed.data, response, text };
  }
  async function bootstrap(value, options = {}) {
    const resultSession = { ...value.session };
    const result = await request(
      "BOOTSTRAP",
      `/api/v1/checkout/sessions/${value.checkout.id}/order-access`,
      { body: { schemaVersion: 1 }, session: resultSession, ...options },
    );
    return { ...result, session: resultSession };
  }
  async function exchange(token, options = {}) {
    const session = {};
    const result = await request("EXCHANGE", "/api/v1/order-access/exchange", {
      body: { schemaVersion: 1, token },
      session,
      ...options,
    });
    return { ...result, session };
  }
  const read = (session, id, options = {}) =>
    request("READ", `/api/v1/orders/${id}`, {
      method: "GET",
      session,
      ...options,
    });
  const revoke = (session, id, options = {}) =>
    request("REVOKE", "/api/v1/order-access/revoke", {
      body: { schemaVersion: 1, publicOrderId: id },
      session,
      ...options,
    });
  const locate = (session, publicOrderNo, options = {}) =>
    request("LOCATE", "/api/v1/order-access/locate", {
      body: { schemaVersion: 1, publicOrderNo },
      session,
      ...options,
    });
  return { request, bootstrap, exchange, read, revoke, locate, events };
}
