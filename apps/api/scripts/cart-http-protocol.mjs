import { discardCommittedCartResponse } from "./cart-http-response-loss.mjs";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  cartRuntimeResponseSchema,
  storefrontGiftResponseSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";

export async function verifyCartHttpProtocol({
  base,
  origin,
  fixtures,
  client,
  gateway,
  kms,
  logLines,
  check,
}) {
  let requests = 0;
  const cases = [];
  const secretMessage = `TEST_PRIVATE_MESSAGE_${randomUUID()}_祝福`,
    secretName = `TEST_NAME_${randomUUID().slice(0, 8)}`;
  const privateKeys = new Set([
    "fanMessage",
    "displayNameCiphertext",
    "fanMessageCiphertext",
    "encryptedDataKey",
    "encryptionKeyVersion",
    "supportIntentId",
    "tokenDigest",
    "tokenPepperVersion",
    "csrfToken",
    "sessionToken",
  ]);
  const safe = (value) =>
    value === null ||
    typeof value !== "object" ||
    Object.entries(value).every(
      ([key, child]) => !privateKeys.has(key) && safe(child),
    );
  async function request(
    url,
    {
      method = "GET",
      body,
      cookie,
      csrf,
      key,
      expected = 200,
      extra = {},
    } = {},
  ) {
    requests++;
    const response = await globalThis.fetch(base + url, {
      method,
      headers: {
        ...(method === "POST"
          ? { origin, "content-type": "application/json" }
          : {}),
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        ...(key ? { "idempotency-key": key } : {}),
        ...extra,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    const parsed = cartRuntimeResponseSchema.safeParse(JSON.parse(text));
    const code =
      parsed.success && parsed.data.outcome === "FAILURE"
        ? parsed.data.code
        : null;
    console.log(
      `Cart HTTP response ${JSON.stringify({ request: requests, method, path: url.split("?")[0], status: response.status, code })}`,
    );
    check(
      response.status === expected,
      `cart HTTP request ${requests} ${method} ${url.split("?")[0]} expected ${expected}, received ${response.status}, code ${code ?? "NONE"}`,
    );
    check(
      response.headers.get("cache-control") === "private, no-store",
      "cart response is private and uncached",
    );
    check(
      response.headers.get("x-robots-tag") === "noindex, nofollow",
      "cart response excludes search indexing",
    );
    check(
      !text.includes(secretMessage) && !text.includes(secretName),
      "private canaries are absent from cart HTTP",
    );
    const data = cartRuntimeResponseSchema.parse(JSON.parse(text));
    check(
      safe(data),
      "cart public response rejects private implementation fields",
    );
    return { data, response };
  }
  const scope = fixtures.markets[0];
  const initialBody = { schemaVersion: 1, presentationLocale: "en", ...scope };
  const initialized = await request("/api/v1/carts", {
    method: "POST",
    body: initialBody,
  });
  check(
    initialized.data.outcome === "SUCCESS" &&
      initialized.data.action === "INITIALIZED" &&
      initialized.data.cart.items.length === 0,
    "initialization creates an empty cart only",
  );
  const setCookie = initialized.response.headers.get("set-cookie"),
    cookie = setCookie?.split(";")[0],
    csrf = initialized.response.headers.get("x-csrf-token");
  check(
    /^__Host-fan-cart=[A-Za-z0-9_-]{43};/u.test(setCookie ?? "") &&
      ["HttpOnly", "Secure", "Path=/", "SameSite=Lax"].every((flag) =>
        setCookie.includes(flag),
      ) &&
      !setCookie.includes("Domain="),
    "stable opaque cart cookie has all host-only flags",
  );
  check(
    /^[A-Za-z0-9_-]{43}$/u.test(csrf ?? ""),
    "CSRF is returned only through private response header",
  );
  const token = cookie.split("=")[1];
  const cartRows = await client.query(
    "SELECT id, encode(token_digest,'hex') AS digest, token_pepper_version FROM carts",
  );
  check(
    cartRows.rows.length === 1 &&
      cartRows.rows[0].digest.length === 64 &&
      cartRows.rows[0].digest !== token &&
      cartRows.rows[0].token_pepper_version === "test-mac",
    "PostgreSQL stores only versioned session digest",
  );
  const cartId = cartRows.rows[0].id;
  const again = await request("/api/v1/carts", {
    method: "POST",
    body: initialBody,
    cookie,
  });
  check(
    !again.response.headers.has("set-cookie") &&
      Number(
        (await client.query("SELECT count(*) FROM carts")).rows[0].count,
      ) === 1,
    "stable-cookie initialization reuses the same cart without rotation",
  );
  await request("/api/v1/cart?presentationLocale=en", { expected: 401 });
  await request("/api/v1/cart?presentationLocale=en&cartId=forged", {
    cookie,
    expected: 400,
  });
  await request("/api/v1/carts", {
    method: "POST",
    body: initialBody,
    expected: 403,
    extra: { origin: "https://other.example.invalid" },
  });
  cases.push("stable-empty-session-and-origin");

  async function commandFor(
    gift,
    variantIndex = 0,
    artist = fixtures.artists[0],
  ) {
    const current = storefrontGiftResponseSchema.parse(
      await (
        await globalThis.fetch(
          `${base}/api/v1/storefront-gifts/${gift.handle}?locale=en&market=${scope.market}&currency=${scope.currency}&idol=${artist.id}`,
        )
      ).json(),
    );
    check(
      current.outcome === "SUCCESS",
      "observed price comes from actual published commerce API",
    );
    const offer = current.offers.find(
      (offer) => offer.giftVariantId === gift.variants[variantIndex].id,
    );
    check(
      offer?.price !== null && offer?.price !== undefined,
      "selected real variant has a current observed price",
    );
    return {
      ...initialBody,
      idolId: artist.id,
      giftId: gift.id,
      giftVariantId: gift.variants[variantIndex].id,
      quantity: 1,
      observedPriceId: offer.price.priceId,
      displayMode: "anonymous",
      fanMessageLocale: "en",
    };
  }
  const command = await commandFor(fixtures.gifts[0]);
  const auth = {
    method: "POST",
    cookie,
    csrf,
    key: randomUUID(),
    body: command,
  };
  await request("/api/v1/cart/items", {
    ...auth,
    csrf: "invalid",
    expected: 403,
  });
  await request("/api/v1/cart/items", {
    ...auth,
    cookie: undefined,
    expected: 401,
  });
  await request("/api/v1/cart/items", {
    ...auth,
    key: undefined,
    expected: 400,
  });
  await request("/api/v1/cart/items", {
    ...auth,
    body: { ...command, unitAmountMinor: 1 },
    expected: 400,
  });
  check(
    Number(
      (await client.query("SELECT count(*) FROM cart_items")).rows[0].count,
    ) === 0,
    "invalid transport never creates an item",
  );
  const lost = await discardCommittedCartResponse({
    base,
    body: command,
    headers: {
      origin,
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": auth.key,
    },
  });
  requests++;
  check(
    lost.upstreamStatus === 200 &&
      lost.clientNetworkFailure &&
      !lost.downstreamHeadersSent,
    "real add commits upstream while downstream loses all response headers and body",
  );
  const replay = await request("/api/v1/cart/items", auth);
  check(
    replay.data.outcome === "SUCCESS" &&
      replay.data.action === "REPLAYED" &&
      replay.data.cart.items.length === 1,
    "same stable session and key recover the discarded response",
  );
  const anonymous = (
    await client.query(
      "SELECT encrypted_data_key, fan_message_ciphertext, display_name_ciphertext FROM support_intents WHERE cart_item_id=$1",
      [replay.data.cartItemId],
    )
  ).rows[0];
  check(
    anonymous.encrypted_data_key?.length > 28 &&
      anonymous.fan_message_ciphertext === null &&
      anonymous.display_name_ciphertext === null,
    "empty anonymous intent has a real wrapped key and no invented private text",
  );
  const conflict = await request("/api/v1/cart/items", {
    ...auth,
    body: { ...command, quantity: 2 },
    expected: 409,
  });
  check(
    conflict.data.code === "IDEMPOTENCY_CONFLICT",
    "same key with changed quantity is a conflict",
  );
  kms.setEncryptionUnavailable(true);
  const replayWithoutEncryption = await request("/api/v1/cart/items", auth);
  check(
    replayWithoutEncryption.data.action === "REPLAYED" &&
      replayWithoutEncryption.data.cartItemId === replay.data.cartItemId,
    "committed replay does not require envelope encryption again",
  );
  kms.setEncryptionUnavailable(false);
  cases.push("discarded-success-response-replay");

  const privateCommand = {
    ...command,
    displayMode: "nickname",
    displayName: secretName,
    fanMessage: secretMessage,
    fanMessageLocale: "zh-CN",
  };
  const parallelKey = randomUUID();
  const parallel = await Promise.all(
    [0, 1].map(() =>
      request("/api/v1/cart/items", {
        ...auth,
        key: parallelKey,
        body: privateCommand,
      }),
    ),
  );
  check(
    parallel
      .map((result) => result.data.action)
      .sort()
      .join(",") === "ADDED,REPLAYED",
    "concurrent duplicate add commits exactly once",
  );
  const itemId = parallel[0].data.cartItemId;
  check(
    parallel[1].data.cartItemId === itemId,
    "parallel duplicate identifies the same committed item",
  );
  const stored = (
    await client.query("SELECT * FROM support_intents WHERE cart_item_id=$1", [
      itemId,
    ])
  ).rows[0];
  for (const [column, purpose, plaintext] of [
    ["fan_message_ciphertext", "SUPPORT_INTENT_MESSAGE", secretMessage],
    ["display_name_ciphertext", "SUPPORT_INTENT_DISPLAY_NAME", secretName],
  ]) {
    check(
      !Buffer.from(stored[column]).includes(Buffer.from(plaintext)),
      "private PostgreSQL field is actual ciphertext",
    );
    const decrypted = await kms.adapter.decryptEnvelope({
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      algorithm: "AES_256_GCM",
      subjectId: stored.id,
      purpose,
      ciphertext: `enc:v1:${Buffer.from(stored[column]).toString("base64url")}`,
      encryptedDataKey: `enc:v1:${Buffer.from(stored.encrypted_data_key).toString("base64url")}`,
      keyVersion: stored.encryption_key_version,
    });
    check(
      decrypted.outcome === "SUCCESS" &&
        Buffer.from(decrypted.value.plaintextBase64, "base64url").toString(
          "utf8",
        ) === plaintext,
      "real adapter decrypts the exact private Unicode field",
    );
  }
  const counts = (
    await client.query(
      "SELECT (SELECT count(*) FROM cart_items WHERE cart_id=$1)::int AS items, (SELECT count(*) FROM support_intents s JOIN cart_items i ON i.id=s.cart_item_id WHERE i.cart_id=$1)::int AS intents, (SELECT count(*) FROM outbox_events WHERE aggregate_id=$1 AND event_type='CART_ITEM_ADDED')::int AS events",
      [cartId],
    )
  ).rows[0];
  check(
    counts.items === 2 && counts.intents === 2 && counts.events === 2,
    "item, encrypted intent and outbox are one-to-one despite retries",
  );
  const auxiliary =
    JSON.stringify(
      (
        await client.query(
          "SELECT canonical_request_hash, safe_result_reference FROM idempotency_records WHERE actor=$1",
          [`actor-ref:v1:guest:${cartId}`],
        )
      ).rows,
    ) +
    JSON.stringify(
      (
        await client.query(
          "SELECT to_jsonb(event) AS value FROM public.outbox_events event WHERE aggregate_id=$1",
          [cartId],
        )
      ).rows,
    );
  check(
    !auxiliary.includes(secretName) &&
      !auxiliary.includes(secretMessage) &&
      !auxiliary.includes(token),
    "idempotency and outbox never store raw credentials or private text",
  );
  cases.push("concurrent-idempotency-and-private-encryption");
  const second = await request("/api/v1/carts", {
    method: "POST",
    body: initialBody,
  });
  const secondCookie = second.response.headers.get("set-cookie").split(";")[0],
    secondCsrf = second.response.headers.get("x-csrf-token");
  const isolated = await request("/api/v1/cart/items", {
    ...auth,
    cookie: secondCookie,
    csrf: secondCsrf,
    key: parallelKey,
    body: privateCommand,
  });
  check(
    isolated.data.outcome === "SUCCESS" &&
      isolated.data.action === "ADDED" &&
      isolated.data.cart.items.length === 1 &&
      isolated.data.cartItemId !== itemId,
    "same request idempotency key is isolated between two stable cart sessions",
  );
  cases.push("cross-session-idempotency-isolation");

  for (const locale of SUPPORTED_LOCALES) {
    const result = await request(`/api/v1/cart?presentationLocale=${locale}`, {
      cookie,
    });
    check(
      result.data.outcome === "SUCCESS" &&
        result.data.cart.presentationLocale === locale &&
        result.data.cart.currency === scope.currency &&
        result.data.cart.market === scope.market &&
        result.data.cart.items.length === 2,
      "all seven presentation locales preserve cart identity and commerce scope",
    );
    for (const item of result.data.cart.items)
      check(
        item.idol?.localeContext.requestedLocale === locale &&
          item.gift?.localeContext.requestedLocale === locale,
        "cart presentation uses current proof for requested locale",
      );
  }
  const portrait = replay.data.cart.items[0].idol.portrait;
  check(
    portrait.url.startsWith(gateway.origin + "/"),
    "cart image is a real published TLS media URL",
  );
  const image = await gateway.probe(portrait.url);
  check(
    image.statusCode === 200 || image.status === 200,
    "cart published derivative resolves from actual TLS S3",
  );
  cases.push("seven-locales-and-real-media");

  for (const [giftIndex, variantIndex, quantity, code] of [
    [1, 0, 2, "INSUFFICIENT_STOCK"],
    [2, 0, 1, "INSUFFICIENT_STOCK"],
  ]) {
    const body = {
      ...(await commandFor(fixtures.gifts[giftIndex], variantIndex)),
      quantity,
    };
    const rejected = await request("/api/v1/cart/items", {
      ...auth,
      key: randomUUID(),
      body,
      expected: 409,
    });
    check(
      rejected.data.code === code,
      "tracked stock is revalidated against PostgreSQL before writing",
    );
  }
  const paused = await request("/api/v1/cart/items", {
    ...auth,
    key: randomUUID(),
    body: { ...command, idolId: fixtures.artists[2].id },
    expected: 409,
  });
  check(
    ["IDOL_UNAVAILABLE", "RECIPIENT_INELIGIBLE"].includes(paused.data.code),
    "paused recipient cannot authorize a write",
  );
  const wrongScope = await request("/api/v1/cart/items", {
    ...auth,
    key: randomUUID(),
    body: { ...command, ...fixtures.markets[1] },
    expected: 409,
  });
  check(
    wrongScope.data.code === "SCOPE_MISMATCH",
    "established cart scope cannot change through add",
  );
  kms.setUnavailable(true);
  await request("/api/v1/cart/items", {
    ...auth,
    key: randomUUID(),
    expected: 503,
  });
  kms.setUnavailable(false);
  check(
    Number(
      (
        await client.query("SELECT count(*) FROM cart_items WHERE cart_id=$1", [
          cartId,
        ])
      ).rows[0].count,
    ) === 2,
    "all rejected writes including KMS outage leave committed cart unchanged",
  );
  cases.push("live-stock-recipient-scope-and-kms-failures");
  const logs = JSON.stringify(logLines);
  check(
    [
      secretMessage,
      secretName,
      token,
      csrf,
      Buffer.from(secretMessage).toString("base64url"),
      Buffer.from(secretName).toString("base64url"),
    ].every((value) => !logs.includes(value)),
    "actual structured API logs exclude private text, encoded fields and credentials",
  );

  return {
    requests,
    cases,
    kmsRemoteBoundary: "TEST_LOCAL",
    kmsCommandCounts: kms.counts,
    items: counts.items,
    intents: counts.intents,
    outboxEvents: counts.events,
    responseLoss: lost,
    actualNetworkDisconnect: true,
  };
}
