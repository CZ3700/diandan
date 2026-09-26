import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createPaidAdminOrder } from "./admin-orders-fixtures.mjs";

export async function verifyAdminOrdersProtocol(context, runtime, payment) {
  const { check, client } = context,
    { command, login } = runtime;
  payment.canaries.forEach(runtime.registerSecret);
  const manager = await login("manager"),
    operator = await login("order"),
    editor = await login("editor");
  check(
    !(
      await command(editor, "context", { schemaVersion: 1 })
    ).permissions.includes("orders.read"),
    "content editor has no order capability",
  );
  check(
    (
      await command(
        editor,
        "list",
        {
          schemaVersion: 1,
          page: 1,
          pageSize: 2,
          query: "",
          fulfillment: "ALL",
          moderation: "ALL",
        },
        { status: 403 },
      )
    ).code === "FORBIDDEN",
    "content editor cannot read orders",
  );
  const permissions = await command(operator, "context", { schemaVersion: 1 });
  check(
    permissions.permissions.includes("orders.read") &&
      !permissions.permissions.includes("orders.manage") &&
      permissions.reviewLocales.join() === "ja",
    "operator orders capability independent from content permissions",
  );
  const detail = (session, orderId) =>
    command(session, "detail", { schemaVersion: 1, orderId });
  const mutate = (session, path, body, options = {}) =>
    command(
      session,
      path,
      { schemaVersion: 1, reasonCode: "LOCAL_ACCEPTANCE", ...body },
      { key: randomUUID(), ...options },
    );
  const values = [];
  for (const locale of SUPPORTED_LOCALES) {
    context.progress(`admin ${locale} paid order and moderation`);
    const value = await createPaidAdminOrder(context, payment, {
      locale,
      messageLocale: locale,
    });
    values.push(value);
    let current = await detail(manager, value.orderId),
      line = current.items[0];
    check(
      current.order.presentationLocale === locale &&
        line.giftKind &&
        line.inventoryPolicy,
      "order detail retains historical language, product and inventory meaning",
    );
    check(
      !JSON.stringify(current).includes(payment.canaries[0]) &&
        !line.allowedActions.includes("PREPARE"),
      "pending private content is hidden and blocks preparation",
    );
    check(
      (
        await mutate(
          manager,
          "prepare",
          {
            orderId: value.orderId,
            expectedOrderVersion: current.version,
            fulfillmentId: line.fulfillmentId,
            expectedFulfillmentVersion: line.fulfillmentVersion,
          },
          { status: 409 },
        )
      ).code === "MODERATION_REQUIRED",
      "prepare cannot bypass private review",
    );
    if (locale !== "ja")
      check(
        (
          await command(
            operator,
            "message/read",
            {
              schemaVersion: 1,
              orderId: value.orderId,
              itemId: line.itemId,
              expectedIntentVersion: line.intentVersion,
              reviewLocale: locale,
            },
            { status: 409 },
          )
        ).code === "LANGUAGE_REVIEW_REQUIRED",
        "review language is separately authorized",
      );
    const privateRead = await command(
      manager,
      "message/read",
      {
        schemaVersion: 1,
        orderId: value.orderId,
        itemId: line.itemId,
        expectedIntentVersion: line.intentVersion,
        reviewLocale: locale,
      },
      { privateResult: true },
    );
    check(
      privateRead.content.fanMessage === payment.canaries[0] &&
        privateRead.content.displayName === payment.canaries[1],
      "audited explicit private read decrypts intended message and nickname",
    );
    const reviewBody = {
      orderId: value.orderId,
      expectedOrderVersion: current.version,
      itemId: line.itemId,
      expectedIntentVersion: line.intentVersion,
      accessId: privateRead.accessId,
      reviewLocale: locale,
      languageConfirmed: true,
      decision: "APPROVED",
    };
    const reviewKey = randomUUID(),
      review = await mutate(manager, "message/review", reviewBody, {
        key: reviewKey,
      });
    const replay = await mutate(manager, "message/review", reviewBody, {
      key: reviewKey,
    });
    check(
      replay.replayed && replay.resultId === review.resultId,
      "review retries replay one committed result",
    );
    check(
      (
        await mutate(
          manager,
          "message/review",
          { ...reviewBody, decision: "REJECTED" },
          { key: reviewKey, status: 409 },
        )
      ).code === "IDEMPOTENCY_CONFLICT",
      "changed review body cannot reuse idempotency key",
    );
    current = await detail(manager, value.orderId);
    line = current.items[0];
    check(
      line.languageConfidence === "CONFIRMED" &&
        line.allowedActions.includes("PREPARE"),
      "human review unlocks preparation for exact line",
    );
    const before = await payment.immutableSnapshot(value);
    await mutate(manager, "prepare", {
      orderId: value.orderId,
      expectedOrderVersion: current.version,
      fulfillmentId: line.fulfillmentId,
      expectedFulfillmentVersion: line.fulfillmentVersion,
    });
    current = await detail(manager, value.orderId);
    line = current.items[0];
    await mutate(manager, "deliver", {
      orderId: value.orderId,
      expectedOrderVersion: current.version,
      fulfillmentId: line.fulfillmentId,
      expectedFulfillmentVersion: line.fulfillmentVersion,
    });
    current = await detail(manager, value.orderId);
    check(
      current.order.fulfillmentStatus === "DELIVERED",
      "authorized per-item delivery advances aggregate",
    );
    check(
      (await payment.immutableSnapshot(value)) === before,
      "fulfillment preserves purchased price and content snapshots",
    );
  }
  const value = values[0];
  let current = await detail(manager, value.orderId);
  const note = `private-note-${randomUUID()}`;
  runtime.registerSecret(note);
  const noteBody = {
      orderId: value.orderId,
      expectedOrderVersion: current.version,
      note,
    },
    noteKey = randomUUID();
  const added = await mutate(manager, "note/add", noteBody, { key: noteKey });
  const replay = await mutate(manager, "note/add", noteBody, { key: noteKey });
  check(
    added.resultId === replay.resultId && replay.replayed,
    "encrypted note submission retries create exactly one note",
  );
  current = await detail(manager, value.orderId);
  check(
    current.notes.length === 1 && !JSON.stringify(current).includes(note),
    "detail contains only note metadata",
  );
  const notes = await command(
    manager,
    "notes/read",
    { schemaVersion: 1, orderId: value.orderId },
    { privateResult: true },
  );
  check(
    notes.notes[0].text === note,
    "explicit note read decrypts after audit and authority recheck",
  );
  const stored = (
    await client.query(
      "SELECT ciphertext,encrypted_data_key FROM admin_order_notes WHERE order_id=$1",
      [value.orderId],
    )
  ).rows[0];
  check(
    !stored.ciphertext.includes(Buffer.from(note)),
    "freeform internal note encrypted at rest",
  );
  const hold = await createPaidAdminOrder(context, payment, {
    noMessage: true,
  });
  current = await detail(manager, hold.orderId);
  let line = current.items[0];
  const holdBody = {
    orderId: hold.orderId,
    expectedOrderVersion: current.version,
    fulfillmentId: line.fulfillmentId,
    expectedFulfillmentVersion: line.fulfillmentVersion,
    confirmed: true,
  };
  check(
    (await mutate(operator, "hold", holdBody, { status: 403 })).code ===
      "FORBIDDEN",
    "operator cannot use manager hold",
  );
  await mutate(manager, "hold", holdBody);
  current = await detail(manager, hold.orderId);
  line = current.items[0];
  check(
    current.order.fulfillmentStatus === "ON_HOLD",
    "manager can pause with explicit confirmation",
  );
  await mutate(manager, "resume", {
    ...holdBody,
    expectedOrderVersion: current.version,
    expectedFulfillmentVersion: line.fulfillmentVersion,
  });
  current = await detail(manager, hold.orderId);
  check(
    current.order.fulfillmentStatus === "PENDING",
    "manager resume restores owned prior status",
  );
  const listBody = {
    schemaVersion: 1,
    page: 1,
    pageSize: 2,
    query: "",
    fulfillment: "ALL",
    moderation: "ALL",
  };
  const first = await command(operator, "list", listBody),
    second = await command(operator, "list", { ...listBody, page: 2 });
  check(
    first.items.length === 2 &&
      second.items.length === 2 &&
      first.items.every((a) =>
        second.items.every((b) => a.orderId !== b.orderId),
      ),
    "orders pagination has stable disjoint pages",
  );
  const search = await command(operator, "list", {
    ...listBody,
    query: value.checkout.publicOrderId,
  });
  check(
    search.items.length === 1 && search.items[0].orderId === value.orderId,
    "operator can find exact public order number",
  );
  // Support hears "7 k 3 m 9 c" without the prefix; the list shows the same FS- number.
  const spoken = await command(operator, "list", {
    ...listBody,
    query: search.items[0].publicOrderNo
      .slice(3)
      .toLowerCase()
      .split("")
      .join(" "),
  });
  check(
    /^FS-[0-9A-HJKMNP-TV-Z]{6}$/u.test(search.items[0].publicOrderNo) &&
      spoken.items.some((item) => item.orderId === value.orderId),
    "operator can find an order by its spoken public number",
  );
  return {
    values,
    manager,
    operator,
    detail,
    mutate,
    holdOrderId: hold.orderId,
  };
}
