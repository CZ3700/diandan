import { randomUUID } from "node:crypto";
import {
  cartRuntimeCurrentResponseSchema,
  cartEditResponseSchema,
  cartEditorResponseSchema,
  storefrontGiftResponseSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";

/** Synthetic private strings live only in this callback and the real encrypted intent/editor channel. */
export async function verifyCartStorefrontProtocol({
  base,
  origin,
  fixtures,
  client,
  kms,
  logLines,
  check,
}) {
  const canaries = [
    `TEST_${randomUUID()}_🌟`,
    `NAME_${randomUUID().slice(0, 8)}`,
    `EDIT_${randomUUID()}_礼`,
    `EDIT_${randomUUID().slice(0, 8)}`,
  ];
  const scope = fixtures.markets[0];
  const initial = { schemaVersion: 1, presentationLocale: "en", ...scope };
  let requests = 0;
  const cases = [];
  const forbidden = new Set([
    "fanMessage",
    "supportIntentId",
    "fanMessageCiphertext",
    "displayNameCiphertext",
    "encryptedDataKey",
    "encryptionKeyVersion",
    "tokenDigest",
    "sessionToken",
    "csrfToken",
  ]);
  const safe = (value) =>
    !value ||
    typeof value !== "object" ||
    Object.entries(value).every(
      ([key, child]) => !forbidden.has(key) && safe(child),
    );
  async function request(
    path,
    {
      method = "GET",
      body,
      session,
      key,
      expected = 200,
      code,
      editor = false,
      headers = {},
    } = {},
  ) {
    const sequence = ++requests;
    const response = await globalThis.fetch(base + path, {
      method,
      headers: {
        ...(method !== "GET"
          ? { origin, "content-type": "application/json" }
          : {}),
        ...(session
          ? { cookie: session.cookie, "x-csrf-token": session.csrf }
          : {}),
        ...(key ? { "idempotency-key": key } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: globalThis.AbortSignal.timeout(30_000),
      redirect: "error",
    });
    const text = await response.text();
    const schema = editor
      ? cartEditorResponseSchema
      : ["PATCH", "DELETE"].includes(method)
        ? cartEditResponseSchema
        : cartRuntimeCurrentResponseSchema;
    const parsed = schema.safeParse(JSON.parse(text));
    const actualCode =
      parsed.success && parsed.data.outcome === "FAILURE"
        ? parsed.data.code
        : null;
    console.log(
      `Cart edit HTTP ${JSON.stringify({ request: sequence, method, editor, status: response.status, code: actualCode })}`,
    );
    check(
      (Array.isArray(expected) ? expected : [expected]).includes(
        response.status,
      ),
      `cart edit HTTP request ${sequence} has expected status ${expected}`,
    );
    check(
      parsed.success,
      "cart response satisfies its exact public or private contract",
    );
    check(
      response.headers.get("cache-control") === "private, no-store" &&
        response.headers.get("x-robots-tag") === "noindex, nofollow",
      "cart response has mandatory private cache and indexing headers",
    );
    if (code)
      check(
        actualCode === code,
        "cart conflict retains its exact failure code",
      );
    if (!editor)
      check(
        safe(parsed.data) && canaries.every((canary) => !text.includes(canary)),
        "ordinary cart responses cannot expose private intent data",
      );
    return { data: parsed.data, response };
  }
  async function initialize() {
    const { response, data } = await request("/api/v1/carts", {
      method: "POST",
      body: initial,
    });
    const cookie = response.headers.get("set-cookie");
    check(
      cookie?.includes("HttpOnly") &&
        cookie.includes("Secure") &&
        cookie.includes("SameSite=Lax") &&
        !cookie.includes("Domain="),
      "initialization issues an opaque host-only secure cart cookie",
    );
    return {
      cookie: cookie.split(";")[0],
      csrf: response.headers.get("x-csrf-token"),
      cart: data.cart,
    };
  }
  const session = await initialize();
  const other = await initialize();
  const gift = fixtures.gifts[0];
  async function addBody(artist, variantIndex = 0) {
    const query = new globalThis.URLSearchParams({
      locale: "en",
      ...scope,
      idol: artist.id,
    });
    const current = storefrontGiftResponseSchema.parse(
      await (
        await globalThis.fetch(
          `${base}/api/v1/storefront-gifts/${gift.handle}?${query}`,
        )
      ).json(),
    );
    check(
      current.outcome === "SUCCESS",
      "add observes price from the actual published commerce API",
    );
    const offer = current.offers.find(
      (value) => value.giftVariantId === gift.variants[variantIndex].id,
    );
    check(
      offer?.price && offer.availability !== "UNAVAILABLE",
      "fixture selected variant has a current eligible offer",
    );
    return {
      ...initial,
      idolId: artist.id,
      giftId: gift.id,
      giftVariantId: offer.giftVariantId,
      observedPriceId: offer.price.priceId,
      quantity: 1,
      displayMode: "nickname",
      fanMessageLocale: "ja",
      displayName: canaries[1],
      fanMessage: canaries[0],
    };
  }
  const firstBody = await addBody(fixtures.artists[0]);
  const addKey = randomUUID();
  let result = (
    await request("/api/v1/cart/items", {
      method: "POST",
      body: firstBody,
      key: addKey,
      session,
    })
  ).data;
  const firstId = result.cartItemId;
  result = (
    await request("/api/v1/cart/items", {
      method: "POST",
      body: await addBody(fixtures.artists[1]),
      key: randomUUID(),
      session,
    })
  ).data;
  let cart = result.cart;
  const untouchedId = result.cartItemId;
  const untouched = JSON.stringify(
    cart.items.find((item) => item.id === untouchedId),
  );
  check(
    firstId !== untouchedId && cart.items.length === 2,
    "same gift for different artists creates independent rows",
  );
  const target = (id = firstId) => ({
    schemaVersion: 1,
    presentationLocale: "en",
    expectedCartVersion: cart.version,
    expectedItemVersion: cart.items.find((item) => item.id === id).version,
  });
  const path = `/api/v1/cart/items/${firstId}`;
  const originalTarget = target();
  const update = {
    ...originalTarget,
    change: {
      kind: "QUANTITY",
      quantity: 3,
      observedPriceId: firstBody.observedPriceId,
    },
  };
  const updateKey = randomUUID();
  for (const method of ["PATCH", "DELETE", "POST"]) {
    const body = method === "PATCH" ? update : originalTarget;
    await request(path + (method === "POST" ? "/editor" : ""), {
      method,
      body,
      session,
      key: randomUUID(),
      editor: method === "POST",
      expected: 403,
      code: "INVALID_ACCESS",
      headers: { "x-csrf-token": "invalid" },
    });
  }
  await request(path, {
    method: "PATCH",
    body: { ...update, expectedCartVersion: other.cart.version },
    session: other,
    key: randomUUID(),
    expected: 404,
    code: "ITEM_NOT_FOUND",
  });
  result = (
    await request(path, {
      method: "PATCH",
      body: update,
      session,
      key: updateKey,
    })
  ).data;
  cart = result.cart;
  check(
    result.action === "UPDATED" &&
      cart.items.find((item) => item.id === firstId).quantity === 3,
    "quantity changes exactly the selected row",
  );
  check(
    cart.version === originalTarget.expectedCartVersion + 1 &&
      cart.items.find((item) => item.id === firstId).version ===
        originalTarget.expectedItemVersion + 1,
    "successful mutation advances both exact versions once",
  );
  check(
    JSON.stringify(cart.items.find((item) => item.id === untouchedId)) ===
      untouched,
    "the other artist row is unchanged",
  );
  const replay = (
    await request(path, {
      method: "PATCH",
      body: update,
      session,
      key: updateKey,
    })
  ).data;
  check(
    replay.action === "REPLAYED" && replay.cart.version === cart.version,
    "same-key quantity replay does not advance any head",
  );
  await request(path, {
    method: "PATCH",
    body: update,
    session,
    key: randomUUID(),
    expected: 409,
    code: "VERSION_CONFLICT",
  });
  await request(path, {
    method: "PATCH",
    body: { ...update, change: { ...update.change, quantity: 4 } },
    session,
    key: updateKey,
    expected: 409,
    code: "IDEMPOTENCY_CONFLICT",
  });
  cases.push("versioned-quantity-replay-and-cross-cart-isolation");
  const beforePrivate = (
    await client.query(
      "SELECT version, encode(fan_message_ciphertext,'hex') AS message, encode(display_name_ciphertext,'hex') AS name FROM support_intents WHERE cart_item_id=$1",
      [firstId],
    )
  ).rows[0];
  const editor = (
    await request(path + "/editor", {
      method: "POST",
      body: target(),
      session,
      editor: true,
    })
  ).data;
  check(
    editor.content.fanMessage === canaries[0] &&
      editor.content.displayName === canaries[1] &&
      editor.content.fanMessageLocale === "ja",
    "authorized explicit editor decrypts the exact original Unicode privately",
  );
  const editBody = {
    ...target(),
    change: {
      kind: "PERSONALIZATION",
      displayMode: "nickname",
      displayName: canaries[3],
      fanMessage: canaries[2],
      fanMessageLocale: "zh-CN",
    },
  };
  const editKey = randomUUID();
  result = (
    await request(path, {
      method: "PATCH",
      body: editBody,
      key: editKey,
      session,
    })
  ).data;
  cart = result.cart;
  const privateState = (
    await client.query(
      "SELECT version, encode(fan_message_ciphertext,'hex') AS message, encode(display_name_ciphertext,'hex') AS name, moderation_status FROM support_intents WHERE cart_item_id=$1",
      [firstId],
    )
  ).rows[0];
  check(
    privateState.message !== beforePrivate.message &&
      privateState.name !== beforePrivate.name &&
      Number(privateState.version) === Number(beforePrivate.version) + 1 &&
      privateState.moderation_status === "PENDING",
    "personalization atomically replaces encrypted fields and resets moderation",
  );
  kms.setEncryptionUnavailable(true);
  try {
    const replayed = (
      await request(path, {
        method: "PATCH",
        body: editBody,
        key: editKey,
        session,
      })
    ).data;
    check(
      replayed.action === "REPLAYED",
      "completed personalization replay survives encryption unavailability",
    );
  } finally {
    kms.setEncryptionUnavailable(false);
  }
  const newEditor = (
    await request(path + "/editor", {
      method: "POST",
      body: target(),
      session,
      editor: true,
    })
  ).data;
  check(
    newEditor.content.fanMessage === canaries[2] &&
      newEditor.content.displayName === canaries[3] &&
      newEditor.content.fanMessageLocale === "zh-CN",
    "editor reads the latest private version only",
  );
  cases.push("audited-private-edit-encryption-and-replay");
  const remove = target();
  const removeKey = randomUUID();
  result = (
    await request(path, {
      method: "DELETE",
      body: remove,
      key: removeKey,
      session,
    })
  ).data;
  cart = result.cart;
  check(
    result.action === "REMOVED" &&
      !cart.items.some((item) => item.id === firstId) &&
      cart.items.length === 1,
    "remove hides only the selected logical item",
  );
  check(
    (
      await request(path, {
        method: "DELETE",
        body: remove,
        key: removeKey,
        session,
      })
    ).data.action === "REPLAYED",
    "same-key removal replays without another receipt",
  );
  await request("/api/v1/cart/items", {
    method: "POST",
    body: firstBody,
    key: addKey,
    session,
    expected: 409,
    code: "CART_ITEM_REMOVED",
  });
  await request(path + "/editor", {
    method: "POST",
    body: { ...remove, expectedCartVersion: cart.version },
    session,
    editor: true,
    expected: 409,
    code: "CART_ITEM_REMOVED",
  });
  const state = (
    await client.query(
      `SELECT item.version AS item_version,intent.version AS intent_version,intent.status,
    (SELECT count(*)::int FROM cart_item_mutation_receipts WHERE cart_item_id=item.id) AS receipts,
    (SELECT count(*)::int FROM cart_edit_outbox_events WHERE cart_item_id=item.id) AS events,
    (SELECT count(*)::int FROM cart_private_access_receipts WHERE cart_item_id=item.id) AS private_reads
    FROM cart_items item JOIN support_intents intent ON intent.cart_item_id=item.id WHERE item.id=$1`,
      [firstId],
    )
  ).rows[0];
  check(
    state.receipts === 3 &&
      state.events === 3 &&
      state.status === "CANCELED" &&
      state.private_reads === 2,
    "three immutable mutation receipts and durable events accompany logical removal; two explicit reads are audited",
  );
  cases.push("logical-removal-audited-receipts-and-no-revival");
  for (const locale of SUPPORTED_LOCALES) {
    const read = (
      await request(`/api/v1/cart?presentationLocale=${locale}`, { session })
    ).data.cart;
    check(
      read.presentationLocale === locale &&
        read.market === cart.market &&
        read.currency === cart.currency &&
        read.version === cart.version &&
        read.items.length === 1 &&
        read.items[0].id === untouchedId,
      "language changes preserve cart identity, amount scope and version",
    );
  }
  const concurrent = await initialize();
  const concurrentAdded = (
    await request("/api/v1/cart/items", {
      method: "POST",
      body: firstBody,
      session: concurrent,
      key: randomUUID(),
    })
  ).data;
  const concurrentId = concurrentAdded.cartItemId;
  const concurrentPath = `/api/v1/cart/items/${concurrentId}`;
  let concurrentCart = concurrentAdded.cart;
  const concurrentBody = (quantity) => ({
    schemaVersion: 1,
    presentationLocale: "en",
    expectedCartVersion: concurrentCart.version,
    expectedItemVersion: concurrentCart.items[0].version,
    change: {
      kind: "QUANTITY",
      quantity,
      observedPriceId: firstBody.observedPriceId,
    },
  });
  const competing = await Promise.all(
    [2, 3].map((quantity) =>
      request(concurrentPath, {
        method: "PATCH",
        body: concurrentBody(quantity),
        session: concurrent,
        key: randomUUID(),
        expected: [200, 409],
      }),
    ),
  );
  const winners = competing.filter(({ data }) => data.outcome === "SUCCESS");
  const losers = competing.filter(({ data }) => data.outcome === "FAILURE");
  check(
    winners.length === 1 &&
      losers.length === 1 &&
      losers[0].data.code === "VERSION_CONFLICT",
    "different-key concurrent edits from the same versions have one winner and one exact conflict",
  );
  concurrentCart = winners[0].data.cart;
  const sameKey = randomUUID(),
    sameBody = concurrentBody(4);
  const duplicates = await Promise.all(
    [0, 1].map(() =>
      request(concurrentPath, {
        method: "PATCH",
        body: sameBody,
        session: concurrent,
        key: sameKey,
        expected: [200, 409],
      }),
    ),
  );
  const confirmed = [];
  for (const result of duplicates) {
    if (result.data.outcome === "SUCCESS") confirmed.push(result.data);
    else {
      check(
        result.data.code === "IN_PROGRESS",
        "same-key overlap can only request an explicit same-key recovery",
      );
      confirmed.push(
        (
          await request(concurrentPath, {
            method: "PATCH",
            body: sameBody,
            session: concurrent,
            key: sameKey,
          })
        ).data,
      );
    }
  }
  check(
    confirmed.filter((data) => data.action === "UPDATED").length === 1 &&
      confirmed.filter((data) => data.action === "REPLAYED").length === 1 &&
      confirmed.every(
        (data) => data.cart.version === sameBody.expectedCartVersion + 1,
      ),
    "concurrent duplicate edit commits one version and returns its replay",
  );
  const concurrentState = (
    await client.query(
      `SELECT (SELECT count(*)::int FROM cart_item_mutation_receipts WHERE cart_item_id=$1) AS receipts,
    (SELECT count(*)::int FROM cart_edit_outbox_events WHERE cart_item_id=$1) AS events`,
      [concurrentId],
    )
  ).rows[0];
  check(
    concurrentState.receipts === 2 && concurrentState.events === 2,
    "two winning concurrent operations produce exactly two receipts and durable events",
  );
  cases.push("real-concurrent-conflict-and-same-key-recovery");
  check(
    canaries.every((value) => !JSON.stringify(logLines).includes(value)),
    "private runtime canaries are absent from API logs",
  );
  const durable = await client.query(
    "SELECT coalesce(jsonb_agg(to_jsonb(event)), '[]'::jsonb)::text AS value FROM cart_edit_outbox_events event",
  );
  check(
    canaries.every((value) => !durable.rows[0].value.includes(value)),
    "outbox contains no private plaintext",
  );
  return {
    status: "PASS",
    requests,
    cases,
    mutationReceipts: state.receipts,
    durableEvents: state.events,
    privateReads: state.private_reads,
    concurrentMutationReceipts: concurrentState.receipts,
    concurrentDurableEvents: concurrentState.events,
    privatePlaintextPersistedInEvidence: false,
    actualAwsKms: false,
  };
}
