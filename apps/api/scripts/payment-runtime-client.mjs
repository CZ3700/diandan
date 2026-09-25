import { randomUUID } from "node:crypto";
import { paymentRuntimeResponseSchema } from "@fan-support/contracts";

export function createPaymentProtocolClient({
  paymentBase,
  origin,
  check,
  canaries,
}) {
  const events = [];
  async function request(
    category,
    path,
    {
      session,
      method = "GET",
      body,
      key,
      expected = 200,
      code,
      headers = {},
      target = paymentBase,
    } = {},
  ) {
    const response = await globalThis.fetch(target + path, {
      method,
      redirect: "error",
      headers: {
        ...(method === "GET"
          ? {}
          : {
              origin,
              "content-type": "application/json",
              "idempotency-key": key ?? randomUUID(),
            }),
        ...(session
          ? { cookie: session.cookie, "x-csrf-token": session.csrf }
          : {}),
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
      throw new Error("Payment response is not JSON");
    }
    const parsed = paymentRuntimeResponseSchema.safeParse(json);
    const actualCode =
      parsed.success && parsed.data.outcome === "FAILURE"
        ? parsed.data.code
        : null;
    events.push({ category, status: response.status, code: actualCode });
    console.log(`Payment HTTP ${JSON.stringify(events.at(-1))}`);
    check(
      (Array.isArray(expected) ? expected : [expected]).includes(
        response.status,
      ),
      `payment ${category} returns expected status`,
    );
    check(
      parsed.success,
      `payment ${category} satisfies strict response schema`,
    );
    check(
      response.headers.get("cache-control") === "private, no-store" &&
        response.headers.get("x-robots-tag") === "noindex, nofollow" &&
        response.headers.get("referrer-policy") === "no-referrer",
      `payment ${category} has private response controls`,
    );
    check(
      canaries.every((value) => !text.includes(value)) &&
        !/"(?:email|fanMessage|tokenDigest|ciphertext|encryptedDataKey|leaseToken|returnStateDigest|customerContactId)"/u.test(
          text,
        ),
      `payment ${category} omits private content and internal credentials`,
    );
    if (code)
      check(
        (Array.isArray(code) ? code : [code]).includes(actualCode),
        `payment ${category} retains exact safe rejection`,
      );
    const csrf = response.headers.get("x-csrf-token");
    if (session && csrf) session.csrf = csrf;
    return { data: parsed.data, response };
  }
  const current = (session, options = {}) =>
    request("CURRENT", "/api/v1/checkout/current/status", {
      session,
      ...options,
    });
  const capabilities = (
    session,
    checkoutId,
    { locale = "en", country = "US", ...options } = {},
  ) =>
    request(
      "CAPABILITIES",
      `/api/v1/checkout/sessions/${checkoutId}/capabilities?${new globalThis.URLSearchParams({ presentationLocale: locale, ...(country ? { country } : {}), supportedActionTypes: "REDIRECT" })}`,
      { session, ...options },
    );
  const createBody = (capability, country = "US") => ({
    schemaVersion: 1,
    capabilityId: capability.id,
    country,
    configVersion: capability.configVersion,
    ruleVersion: capability.ruleVersion,
    supportedActionTypes: ["REDIRECT"],
  });
  const create = (session, checkoutId, capability, options = {}) =>
    request(
      "CREATE_ATTEMPT",
      `/api/v1/checkout/sessions/${checkoutId}/attempts`,
      { session, method: "POST", body: createBody(capability), ...options },
    );
  const read = (session, checkoutId, attemptId, options = {}) =>
    request(
      "READ_ATTEMPT",
      `/api/v1/checkout/sessions/${checkoutId}/attempts/${attemptId}`,
      { session, ...options },
    );
  const recover = (session, checkoutId, attemptId, options = {}) =>
    request(
      "RECOVER_ATTEMPT",
      `/api/v1/checkout/sessions/${checkoutId}/attempts/${attemptId}/recover`,
      { session, method: "POST", body: { schemaVersion: 1 }, ...options },
    );
  return {
    request,
    current,
    capabilities,
    createBody,
    create,
    read,
    recover,
    events,
  };
}
