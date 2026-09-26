import { randomUUID } from "node:crypto";
import * as contract from "@fan-support/contracts";
import {
  createCatalogDirectoryUseCases,
  createPublishedGiftCommerceUseCases,
} from "@fan-support/application";
import { createTestGiftCommerceComposition } from "../dist/testing/gift-commerce-composition.js";
import { seedGiftCommerceMarket } from "../../../packages/persistence-postgres/scripts/postgres-gift-commerce-fixtures.mjs";
import { workspaceTranslations } from "./admin-workspace-fixtures.mjs";
import { verifyGiftCommerceBrowser } from "./gift-commerce-browser.mjs";
const prefix = "/api/v1/admin/gift-commerce/";
const permissions = [
  "commerce.read",
  "gift.manage",
  "pricing.manage",
  "inventory.manage",
];
const configured = { market: "GLOBAL", currency: "USD" };

async function seed({ client, identities, check }) {
  await client.query("BEGIN");
  try {
    const at = (
      await client.query("SELECT clock_timestamp()-interval '10 minutes' AS at")
    ).rows[0].at;
    const permissionIds = new Map();
    for (const key of permissions) {
      const id = randomUUID();
      permissionIds.set(key, id);
      await client.query(
        "INSERT INTO permissions(id,permission_key,description,created_at) VALUES($1,$2,'Synthetic commerce permission',$3)",
        [id, key, at],
      );
    }
    for (const [name, keys] of Object.entries({
      manager: permissions,
      editor: permissions.slice(0, 2),
      reviewer: permissions.slice(0, 1),
    })) {
      const role = randomUUID();
      await client.query(
        "INSERT INTO roles(id,role_key,description,created_at) VALUES($1,$2,'Synthetic commerce role',$3)",
        [role, `commerce:${name}:${role}`, at],
      );
      await client.query(
        "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by,granted_at) VALUES($1,$2,$3,$4)",
        [identities.identities[name], role, identities.identities.manager, at],
      );
      for (const key of keys)
        await client.query(
          "INSERT INTO role_permissions(role_id,permission_id,granted_by,granted_at) VALUES($1,$2,$3,$4)",
          [role, permissionIds.get(key), identities.identities.manager, at],
        );
    }
    await seedGiftCommerceMarket(client, configured);
    await seedGiftCommerceMarket(client, { market: "JAPAN", currency: "JPY" });
    await client.query("COMMIT");
    check(
      true,
      "synthetic commerce grants and two configured markets use normal database constraints",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
function compositions({ common, persistence }) {
  return [
    createTestGiftCommerceComposition({
      ...common,
      publicMediaBaseUrl: "https://media.example.invalid",
    }),
    {
      catalogDirectoryRoute: createCatalogDirectoryUseCases({
        transactions: persistence.contentReadTransactionManager,
      }),
      publishedGiftCommerceRoute: {
        useCases: createPublishedGiftCommerceUseCases({
          transactions: persistence.publishedGiftCommerceTransactionManager,
        }),
      },
    },
  ];
}
async function prepare({
  fixtures,
  request,
  write,
  approve,
  publish,
  createMediaAsset,
  client,
  base,
  check,
}) {
  const readGift = async (giftId, revisionId) =>
    (
      await request(prefix + "gifts/read", {
        schemaVersion: 1,
        giftId,
        locale: "en",
        ...(revisionId ? { revisionId } : {}),
      })
    ).value;
  const mutate = (route, body, options = {}) =>
    request(
      prefix + route,
      { schemaVersion: 1, reasonCode: "COMMERCE_HTTP", ...body },
      { actor: "manager", key: randomUUID(), ...options },
    );
  const context = await request(
    prefix + "context/read",
    { schemaVersion: 1 },
    { actor: "manager" },
  );
  check(
    permissions.every((permission) => context.permissions.includes(permission)),
    "context uses current commerce capabilities",
  );
  check(
    context.markets.length === 2,
    "context discovers only actual configured markets",
  );
  const editor = await request(prefix + "context/read", { schemaVersion: 1 });
  check(
    editor.permissions.length === 2 &&
      !editor.permissions.includes("pricing.manage"),
    "editor does not receive manager pricing privilege",
  );
  const session = await request(
    "/api/v1/admin/session/read",
    { schemaVersion: 1 },
    { actor: "manager" },
  );
  check(
    !session.permissions.some((permission) => permissions.includes(permission)),
    "old session bootstrap remains unchanged",
  );
  for (const [actor, status] of [
    ["denied", 403],
    ["expired", 401],
    ["revoked", 401],
    ["no-mfa", 401],
  ])
    await request(
      prefix + "context/read",
      { schemaVersion: 1 },
      { actor, status },
    );
  await request(
    prefix + "context/read",
    { schemaVersion: 1 },
    { status: 403, headers: { origin: "https://untrusted.example" } },
  );
  await request(
    prefix + "context/read",
    { schemaVersion: 1 },
    { status: 403, headers: { "x-csrf-token": "A".repeat(43) } },
  );
  await request(
    prefix + "context/read",
    { schemaVersion: 1, actorId: fixtures.identities.manager },
    { status: 400 },
  );
  const initialCount = Number(
    (await client.query("SELECT count(*) AS count FROM gifts")).rows[0].count,
  );
  check(
    initialCount === 0,
    "first commerce gift starts from no business gift records",
  );
  const createBody = { handle: "studio-wish", expectedBaseVersion: 0 };
  const createKey = randomUUID();
  const created = await mutate("gifts/create", createBody, {
    actor: "editor",
    key: createKey,
  });
  const giftId = created.giftId,
    owner = { kind: "GIFT", giftId };
  const replay = await mutate("gifts/create", createBody, {
    actor: "editor",
    key: createKey,
  });
  check(
    replay.replayed && replay.giftId === giftId,
    "same create key replays canonical gift receipt",
  );
  await mutate(
    "gifts/create",
    { ...createBody, handle: "changed-request" },
    { actor: "editor", key: createKey, status: 409 },
  );
  let gift = await readGift(giftId);
  check(
    gift.gift.status === "draft" &&
      gift.latestRevisionId === null &&
      gift.variants.length === 0,
    "new gift is empty unpublished draft",
  );
  await mutate(
    "gifts/status",
    { giftId, expectedBaseVersion: gift.gift.version, status: "active" },
    { status: 409 },
  );
  const variantIds = [];
  for (const [sku, inventoryPolicy] of [
    ["STUDIO-WISH", "PROCURE_ON_DEMAND"],
    ["STUDIO-STOCK", "TRACKED"],
    ["STUDIO-PREORDER", "PREORDER"],
  ]) {
    gift = await readGift(giftId);
    const result = await mutate(
      "variants/save",
      {
        giftId,
        giftVariantId: null,
        expectedBaseVersion: gift.gift.version,
        expectedVariantVersion: 0,
        sku,
        status: "draft",
        inventoryPolicy,
        eligibleIdolIds: [fixtures.idol.owner.idolId],
      },
      { actor: "editor" },
    );
    variantIds.push(result.giftVariantId);
  }
  const image = await createMediaAsset("Gift", 1600, 1600, 40, "GIFT_PRIMARY");
  const content = {
    kind: "GIFT",
    structure: {
      category: "OTHER",
      contents: [{ componentCode: "STUDIO_GIFT", quantity: 1, unit: "ITEM" }],
      deliveryEstimate: { minimum: 3, maximum: 14, unit: "DAY" },
      requiresSafetyNotice: false,
      shippingMode: "internal_to_idol",
    },
    media: [
      {
        role: "PRIMARY",
        mediaAssetId: image.assetId,
        mediaMetadataRevisionId: image.revisionId,
        sortOrder: 0,
      },
    ],
    translations: workspaceTranslations((locale) => ({
      title: "Studio Wish",
      subtitle: `A thoughtful gift · ${locale}`,
      shortDescription: `Prepared by our studio for the artist · ${locale}`,
      description: `Your chosen gift is prepared or procured after payment · ${locale}`,
      fulfillmentDescription: `Our studio delivers this gift to the artist · ${locale}`,
      variantLabels: variantIds.map((giftVariantId, index) => ({
        giftVariantId,
        label: ["Studio procurement", "Available stock", "Studio preorder"][
          index
        ],
      })),
      seoTitle: "Studio Wish",
      seoDescription: `Studio gift for your artist · ${locale}`,
    })),
    details: {
      blocks: [{ id: "care", kind: "PARAGRAPH" }],
      translations: workspaceTranslations(() => ({})).map(
        ({ locale, origin }) => ({
          locale,
          origin,
          blocks: [
            {
              blockId: "care",
              kind: "PARAGRAPH",
              text: `Our studio arranges every delivery to the artist · ${locale}`,
            },
          ],
        }),
      ),
    },
  };
  check(
    contract.contentAuthoringContentSchema.safeParse(content).success,
    "gift fixture conforms before transport without normalization",
  );
  gift = await readGift(giftId);
  const saved = await mutate(
    "content/save",
    {
      expectedBaseVersion: gift.gift.version,
      giftKind: "WISH",
      authoring: {
        schemaVersion: 1,
        action: "CREATE",
        target: owner,
        expectedVersion: 0,
        content,
      },
    },
    { actor: "editor" },
  );
  let revisionId = saved.giftRevisionId;
  check(
    saved.authoringVersion === 1,
    "first content wrapper creates one revision and classification",
  );
  gift = await readGift(giftId);
  check(
    gift.latestProfile?.profile.giftKind === "WISH" &&
      gift.selectedRevisionId === revisionId,
    "current profile binds actual new revision",
  );
  for (const id of variantIds) {
    gift = await readGift(giftId);
    const variant = gift.variants.find((value) => value.id === id);
    await mutate(
      "variants/save",
      {
        giftId,
        giftVariantId: id,
        expectedBaseVersion: gift.gift.version,
        expectedVariantVersion: variant.version,
        sku: variant.sku,
        status: "active",
        inventoryPolicy: variant.inventoryPolicy,
        eligibleIdolIds: variant.eligibleIdolIds,
      },
      { actor: "editor" },
    );
  }
  gift = await readGift(giftId);
  check(
    gift.variants.every((variant) => variant.status === "active") &&
      gift.gift.status === "draft",
    "first active variants do not require a previously published gift",
  );
  check(
    gift.variants
      .filter((variant) => variant.inventoryPolicy !== "TRACKED")
      .every((variant) => variant.inventoryItemId === null),
    "procurement and preorder have no fabricated stock",
  );
  const at = (
    await client.query(
      "SELECT to_char((clock_timestamp()-interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
    )
  ).rows[0].at;
  const priceBody = {
    ...configured,
    expectedBookRevision: 0,
    expectedHeadVersion: 0,
    source: null,
    validFrom: at,
    validUntil: null,
    changes: variantIds.map((giftVariantId, index) => ({
      giftVariantId,
      unitAmountMinor: [1500, 1200, 1800][index],
    })),
  };
  await mutate("prices/create", priceBody, { actor: "editor", status: 403 });
  const beforeUnknown = (
    await client.query(
      "SELECT (SELECT count(*) FROM price_books) AS books,(SELECT count(*) FROM audit_logs) AS audits",
    )
  ).rows[0];
  await mutate(
    "prices/create",
    { ...priceBody, currency: "EUR" },
    { status: 404 },
  );
  const afterUnknown = (
    await client.query(
      "SELECT (SELECT count(*) FROM price_books) AS books,(SELECT count(*) FROM audit_logs) AS audits",
    )
  ).rows[0];
  check(
    beforeUnknown.books === afterUnknown.books &&
      beforeUnknown.audits === afterUnknown.audits,
    "unknown market currency creates neither book nor audit",
  );
  const bookKey = randomUUID();
  const book = await mutate("prices/create", priceBody, { key: bookKey });
  const priceHead = await mutate("prices/publish", {
    ...configured,
    priceBookId: book.priceBookId,
    revision: book.revision,
    expectedHeadVersion: 0,
    expectedContentHash: book.contentHash,
  });
  const location = await mutate("inventory/locations/create", {
    code: "STUDIO_ROOM",
    expectedVersion: 0,
  });
  gift = await readGift(giftId);
  const tracked = gift.variants.find(
    (variant) => variant.inventoryPolicy === "TRACKED",
  );
  const initialStock = {
    giftVariantId: tracked.id,
    inventoryLocationId: location.inventoryLocationId,
    expectedVariantVersion: tracked.version,
    expectedBalanceVersion: 0,
    deltaOnHand: 1,
  };
  const added = await mutate("inventory/adjust", initialStock);
  const initialZero = await mutate("inventory/adjust", {
    ...initialStock,
    expectedBalanceVersion: added.balanceVersion,
    deltaOnHand: -1,
  });
  async function approveDetails(id) {
    const body = {
      schemaVersion: 1,
      target: { schemaVersion: 1, kind: "GIFT_DETAILS", giftRevisionId: id },
    };
    for (const action of ["submit", "approve"]) {
      const draft = await request("/api/v1/admin/content/drafts/read", body);
      for (const context of draft.reviews)
        await write(
          `/api/v1/admin/content/reviews/${action}`,
          {
            target: context.target,
            expectedVersion: context.sequence,
            expectedContentHash: context.contentHash,
            expectedSourceHash: context.sourceHash,
          },
          action === "approve" ? "reviewer" : "editor",
        );
    }
  }
  await approve(owner, revisionId);
  await approveDetails(revisionId);
  const firstPublication = await publish(owner, revisionId);
  gift = await readGift(giftId);
  check(
    gift.gift.status === "active" &&
      gift.gift.publishedRevisionId === revisionId,
    "first publication activates completely new gift",
  );
  async function publicGift(locale = "en", kind = "WISH", id = revisionId) {
    const response = await globalThis.fetch(
      `${base}/api/v1/gift-content/studio-wish?locale=${locale}`,
    );
    const result = contract.publishedGiftCommerceResponseSchema.safeParse(
      await response.json(),
    );
    check(
      response.status === 200 &&
        result.success &&
        result.data.outcome === "SUCCESS",
      "public gift has strict safe response",
    );
    check(
      result.data.classification.giftKind === kind &&
        result.data.publication.revisionId === id,
      "public classification belongs to exact current published revision",
    );
    check(
      !/(sourceObjectKey|signedUrl|reviewedBy|sessionToken|csrfToken)/u.test(
        JSON.stringify(result.data),
      ),
      "public response omits private proof and capabilities",
    );
    return result.data;
  }
  async function offer(amount, purchasable = true, locale = "en") {
    const query = new globalThis.URLSearchParams({
      locale,
      ...configured,
      idol: fixtures.idol.owner.idolId,
      page: "1",
      pageSize: "12",
    });
    const response = await globalThis.fetch(`${base}/api/v1/gifts?${query}`);
    const result = contract.giftDirectoryResponseSchema.safeParse(
      await response.json(),
    );
    if (
      response.status !== 200 ||
      !result.success ||
      result.data.outcome !== "SUCCESS"
    )
      console.error(
        `Gift directory diagnostic ${JSON.stringify({ status: response.status, code: result.success && result.data.outcome === "FAILURE" ? result.data.code : "INVALID_RESPONSE" })}`,
      );
    check(
      response.status === 200 &&
        result.success &&
        result.data.outcome === "SUCCESS",
      "actual directory resolves current sale eligibility",
    );
    const entry = result.data.items.find((entry) => entry.gift.id === giftId);
    check(
      entry?.offer.priceMinor === amount &&
        entry?.offer.purchasable === purchasable,
      "public offer uses real price head and stock policy",
    );
  }
  for (const locale of contract.SUPPORTED_LOCALES) {
    await publicGift(locale);
    await offer(1500, true, locale);
  }
  const stockBody = {
    giftVariantId: tracked.id,
    inventoryLocationId: location.inventoryLocationId,
    expectedVariantVersion: tracked.version,
    expectedBalanceVersion: initialZero.balanceVersion,
    deltaOnHand: 5,
  };
  await mutate("inventory/adjust", stockBody, { actor: "editor", status: 403 });
  const stockKey = randomUUID();
  const stock = await mutate("inventory/adjust", stockBody, { key: stockKey });
  const stockReplay = await mutate("inventory/adjust", stockBody, {
    key: stockKey,
  });
  check(
    stockReplay.replayed && stockReplay.balanceVersion === stock.balanceVersion,
    "stock retry does not double quantity",
  );
  await offer(1200);
  await mutate("inventory/adjust", stockBody, { status: 409 });
  await mutate(
    "inventory/adjust",
    {
      ...stockBody,
      expectedBalanceVersion: stock.balanceVersion,
      deltaOnHand: -6,
    },
    { status: 409 },
  );
  await mutate("inventory/adjust", {
    ...stockBody,
    expectedBalanceVersion: stock.balanceVersion,
    deltaOnHand: -5,
  });
  await offer(1500);
  await mutate(
    "inventory/adjust",
    {
      ...stockBody,
      giftVariantId: variantIds[0],
      expectedVariantVersion: gift.variants[0].version,
      deltaOnHand: 1,
    },
    { status: 409 },
  );
  const prices = await request(
    prefix + "prices/read",
    { schemaVersion: 1, ...configured, revision: 1, page: 1, pageSize: 50 },
    { actor: "manager" },
  );
  check(
    prices.items.length === 3,
    "complete initial book includes all three variant prices",
  );
  const second = await mutate("prices/create", {
    ...priceBody,
    expectedBookRevision: 1,
    expectedHeadVersion: priceHead.headVersion,
    source: {
      priceBookId: book.priceBookId,
      revision: 1,
      contentHash: prices.book.contentHash,
    },
    changes: [{ giftVariantId: variantIds[0], unitAmountMinor: 1600 }],
  });
  const secondPublication = await mutate("prices/publish", {
    ...configured,
    priceBookId: second.priceBookId,
    revision: 2,
    expectedHeadVersion: priceHead.headVersion,
    expectedContentHash: second.contentHash,
  });
  await offer(1600);
  const priceFirst = await request(
    prefix + "prices/read",
    { schemaVersion: 1, ...configured, revision: 1, page: 1, pageSize: 50 },
    { actor: "manager" },
  );
  await mutate("prices/rollback", {
    ...configured,
    priceBookId: book.priceBookId,
    revision: 1,
    expectedHeadVersion: secondPublication.headVersion,
    expectedContentHash: priceFirst.book.contentHash,
  });
  await offer(1500);
  await mutate(
    "prices/publish",
    {
      ...configured,
      priceBookId: second.priceBookId,
      revision: 2,
      expectedHeadVersion: 0,
      expectedContentHash: second.contentHash,
    },
    { status: 409 },
  );
  const authority = (
    await client.query(
      "DELETE FROM role_permissions WHERE role_id IN(SELECT role_id FROM admin_identity_roles WHERE admin_identity_id=$1) AND permission_id IN(SELECT id FROM permissions WHERE permission_key='pricing.manage') RETURNING role_id,permission_id,granted_by",
      [fixtures.identities.manager],
    )
  ).rows[0];
  check(Boolean(authority), "fixture withdraws current pricing grant");
  await mutate("prices/create", priceBody, { key: bookKey, status: 403 });
  const currentContext = await request(
    prefix + "context/read",
    { schemaVersion: 1 },
    { actor: "manager" },
  );
  check(
    !currentContext.permissions.includes("pricing.manage"),
    "same session context reflects revoked pricing role",
  );
  await client.query(
    "INSERT INTO role_permissions(role_id,permission_id,granted_by,granted_at) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute')",
    [authority.role_id, authority.permission_id, authority.granted_by],
  );
  // A separate kind revision must be reviewed and published normally; rollback restores its own kind.
  gift = await readGift(giftId);
  const source = await request("/api/v1/admin/content-authoring/read", {
    schemaVersion: 1,
    target: owner,
    revisionId,
  });
  const virtual = await mutate(
    "content/save",
    {
      expectedBaseVersion: gift.gift.version,
      giftKind: "VIRTUAL",
      authoring: {
        schemaVersion: 1,
        action: "COPY",
        target: owner,
        sourceRevisionId: revisionId,
        expectedSourceHash: source.snapshot.contentHash,
        expectedVersion: gift.authoringVersion,
        changes: { kind: "GIFT" },
      },
    },
    { actor: "editor" },
  );
  await approveDetails(virtual.giftRevisionId);
  await publish(owner, virtual.giftRevisionId);
  await publicGift("en", "VIRTUAL", virtual.giftRevisionId);
  const rollbackTarget = { owner, revisionId };
  const rollback = await request(
    "/api/v1/admin/content/publication/preflight",
    { schemaVersion: 1, target: rollbackTarget, action: "ROLLBACK" },
    { actor: "manager" },
  );
  check(
    rollback.ready,
    "historical gift rollback uses full canonical preflight",
  );
  await write(
    "/api/v1/admin/content/publication/rollback",
    {
      target: rollbackTarget,
      expectedVersion: rollback.headVersion,
      expectedContentHash: rollback.contentHash,
    },
    "manager",
  );
  await publicGift("en", "WISH", revisionId);
  await offer(1500);
  gift = await readGift(giftId);
  await mutate("gifts/status", {
    giftId,
    expectedBaseVersion: gift.gift.version,
    status: "paused",
  });
  const paused = await globalThis.fetch(
    `${base}/api/v1/gift-content/studio-wish?locale=en`,
  );
  const pausedBody = contract.publishedGiftCommerceResponseSchema.safeParse(
    await paused.json(),
  );
  check(
    paused.status === 200 &&
      pausedBody.success &&
      pausedBody.data.outcome === "SUCCESS" &&
      pausedBody.data.content.view.status === "paused",
    "paused gift remains readable with its explicit public status",
  );
  await offer(null, false);
  gift = await readGift(giftId);
  await mutate("gifts/status", {
    giftId,
    expectedBaseVersion: gift.gift.version,
    status: "active",
  });
  await offer(1500);
  const atomicKey = randomUUID();
  const atomicBody = {
    handle: "atomic-gift",
    expectedBaseVersion: 0,
    reasonCode: "HTTP_COMMERCE_ATOMICITY",
  };
  const beforeAtomic = (
    await client.query(
      "SELECT (SELECT count(*) FROM gifts) AS gifts,(SELECT count(*) FROM audit_logs) AS audits,(SELECT count(*) FROM idempotency_records) AS idempotency",
    )
  ).rows[0];
  await client.query(
    "CREATE FUNCTION commerce_http_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason_code='HTTP_COMMERCE_ATOMICITY' THEN RAISE EXCEPTION 'CONTROLLED_COMMERCE_FAILURE'; END IF; RETURN NEW; END $$",
  );
  await client.query(
    "CREATE TRIGGER commerce_http_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION commerce_http_audit_fault()",
  );
  try {
    await mutate("gifts/create", atomicBody, { key: atomicKey, status: 503 });
    const afterAtomic = (
      await client.query(
        "SELECT (SELECT count(*) FROM gifts) AS gifts,(SELECT count(*) FROM audit_logs) AS audits,(SELECT count(*) FROM idempotency_records) AS idempotency",
      )
    ).rows[0];
    check(
      beforeAtomic.gifts === afterAtomic.gifts &&
        beforeAtomic.audits === afterAtomic.audits &&
        beforeAtomic.idempotency === afterAtomic.idempotency,
      "HTTP audit failure rolls back gift and idempotency in the same transaction",
    );
  } finally {
    await client.query("DROP TRIGGER commerce_http_audit_fault ON audit_logs");
    await client.query("DROP FUNCTION commerce_http_audit_fault()");
  }
  const recovered = await mutate("gifts/create", atomicBody, {
    key: atomicKey,
  });
  check(
    !recovered.replayed,
    "same failed key succeeds after deterministic audit fault is removed",
  );
  gift = await readGift(giftId);
  const latestSource = await request("/api/v1/admin/content-authoring/read", {
    schemaVersion: 1,
    target: owner,
    revisionId: virtual.giftRevisionId,
  });
  const ordinaryCopy = await write("/api/v1/admin/content-authoring/copy", {
    target: owner,
    sourceRevisionId: virtual.giftRevisionId,
    expectedSourceHash: latestSource.snapshot.contentHash,
    expectedVersion: gift.authoringVersion,
    changes: { kind: "GIFT" },
  });
  const inherited = await readGift(giftId, ordinaryCopy.resultId);
  check(
    inherited.selectedProfile.profile.giftKind === "VIRTUAL",
    "ordinary authoring COPY inherits exact source classification",
  );
  const exported = await write("/api/v1/admin/translation-transfer/export", {
    target: { owner, revisionId: ordinaryCopy.resultId },
    locales: ["ja"],
  });
  const imported = await write("/api/v1/admin/translation-transfer/import", {
    package: exported.package,
  });
  const importedGift = await readGift(giftId, imported.resultId);
  check(
    importedGift.selectedProfile.profile.giftKind === "VIRTUAL",
    "actual translation IMPORT preserves exact source classification",
  );
  await publicGift("en", "WISH", revisionId);
  fixtures.commerce = {
    configured,
    giftId,
    owner,
    revisionId,
    latestRevisionId: imported.resultId,
    variantIds,
    image,
    locationId: location.inventoryLocationId,
    firstPublicationId: firstPublication.publicationId,
  };
}
export const giftCommerceExtension = {
  name: "gift commerce",
  seed,
  compositions,
  prepare,
  verifyBrowser: verifyGiftCommerceBrowser,
};
