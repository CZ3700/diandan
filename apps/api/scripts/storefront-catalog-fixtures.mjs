import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { workspaceTranslations } from "./admin-workspace-fixtures.mjs";

function copyForLocale(locale) {
  switch (locale) {
    case "en":
      return {
        title: "A little closer",
        subtitle: "Thoughtful gifts. A personal connection.",
        cta: "Meet the artists",
        bio: "Music, movement, and moments worth sharing.",
        story:
          "A fictional adult artist exploring the quiet connection between music and everyday life.",
        gift: "Prepared with care for your artist",
        care: "Our studio prepares or procures your chosen gift and delivers it to the artist. Internal fixture; service timing awaits confirmation.",
      };
    case "zh-CN":
      return {
        title: "让心意，更近一点",
        subtitle: "用一份礼物，传递你的支持。",
        cta: "认识艺人",
        bio: "以音乐与舞台，分享值得珍藏的瞬间。",
        story: "这是一位虚构的成年艺人，在音乐与日常生活之间寻找温柔的共鸣。",
        gift: "为你支持的艺人用心准备",
        care: "工作室准备或采购你选择的礼物，再转交艺人。此为内部测试内容，服务时效待确认。",
      };
    case "th":
      return {
        title: "ส่งความรู้สึกให้ใกล้กัน",
        subtitle: "ของขวัญที่ใส่ใจ เพื่อความผูกพันที่พิเศษ",
        cta: "พบกับศิลปิน",
        bio: "แบ่งปันช่วงเวลาที่น่าจดจำผ่านเสียงเพลงและการแสดง",
        story:
          "ศิลปินผู้ใหญ่ในเรื่องสมมติที่ค้นหาความสัมพันธ์ระหว่างเสียงเพลงและชีวิตประจำวัน",
        gift: "เตรียมด้วยความใส่ใจเพื่อศิลปินของคุณ",
        care: "สตูดิโอจัดเตรียมหรือจัดซื้อของขวัญและส่งต่อให้ศิลปิน ข้อมูลทดสอบภายใน ระยะเวลาบริการรอการยืนยัน",
      };
    case "vi":
      return {
        title: "Gửi yêu thương gần hơn",
        subtitle: "Món quà tinh tế, kết nối chân thành.",
        cta: "Khám phá nghệ sĩ",
        bio: "Chia sẻ những khoảnh khắc đáng nhớ qua âm nhạc và sân khấu.",
        story:
          "Nghệ sĩ trưởng thành hư cấu tìm kiếm sự kết nối giữa âm nhạc và đời sống thường ngày.",
        gift: "Chuẩn bị chu đáo cho nghệ sĩ của bạn",
        care: "Studio chuẩn bị hoặc mua món quà bạn chọn rồi trao cho nghệ sĩ. Nội dung thử nghiệm, thời gian dịch vụ chờ xác nhận.",
      };
    case "ja":
      return {
        title: "想いを、もう少し近くへ",
        subtitle: "心を込めた贈り物で、応援を届けよう。",
        cta: "アーティストを探す",
        bio: "音楽とステージを通して、大切な瞬間を分かち合う。",
        story: "音楽と日常のつながりを探す、架空の成人アーティストです。",
        gift: "大切なアーティストのために心を込めて",
        care: "スタジオがギフトを準備または購入し、アーティストにお渡しします。内部テスト用の内容で、サービス期間は確認待ちです。",
      };
    case "es":
      return {
        title: "Un poco más cerca",
        subtitle: "Regalos con intención. Conexiones personales.",
        cta: "Conoce a los artistas",
        bio: "Música, movimiento y momentos que merece la pena compartir.",
        story:
          "Artista adulto de ficción que explora la conexión entre la música y la vida cotidiana.",
        gift: "Preparado con cuidado para tu artista",
        care: "Nuestro estudio prepara o compra el regalo elegido y se lo entrega al artista. Contenido de prueba; plazos pendientes de confirmación.",
      };
    case "pt":
      return {
        title: "Um pouco mais perto",
        subtitle: "Presentes com significado. Ligações pessoais.",
        cta: "Conheça os artistas",
        bio: "Música, movimento e momentos que vale a pena partilhar.",
        story:
          "Artista adulto fictício que explora a ligação entre a música e o quotidiano.",
        gift: "Preparado com carinho para o seu artista",
        care: "O estúdio prepara ou compra o presente escolhido e entrega-o ao artista. Conteúdo de teste; prazos sujeitos a confirmação.",
      };
    default:
      throw new Error("Unsupported storefront fixture locale");
  }
}

const copy = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [locale, copyForLocale(locale)]),
);

export async function seedStorefrontCatalog({
  workspaceRoot,
  content,
  publishMedia,
  client,
  check,
  count = 120,
  progress,
}) {
  const publicRoot = path.join(workspaceRoot, "apps/storefront/public");
  const families = [];
  for (const [name, desktop, mobile] of [
    [
      "Mira Vale",
      "ui-composites/fictional-performer-hero-desktop.png",
      "ui-composites/fictional-performer-hero-mobile.png",
    ],
    [
      "Kai Ren",
      "ui-brand/performer-daylight-desktop.webp",
      "ui-brand/performer-daylight-mobile.webp",
    ],
  ]) {
    progress(
      `processing fictional ${name} portrait and independent dual heroes`,
    );
    families.push({
      name,
      portrait: await publishMedia(
        path.join(publicRoot, mobile),
        "PORTRAIT",
        `${name} portrait`,
      ),
      desktop: await publishMedia(
        path.join(publicRoot, desktop),
        "HERO_DESKTOP",
        `${name} desktop composition`,
      ),
      mobile: await publishMedia(
        path.join(publicRoot, mobile),
        "HERO_MOBILE",
        `${name} mobile composition`,
      ),
    });
  }
  const artists = [];
  for (let index = 0; index < count; index++) {
    if (index % 20 === 0)
      progress(`publishing actual artist ${index + 1}/${count}`);
    const family = families[index % families.length];
    const name =
      index < 2
        ? family.name
        : `Studio Artist ${String(index + 1).padStart(3, "0")}`;
    const handle =
      index === 0
        ? "mira-vale"
        : index === 1
          ? "kai-ren"
          : `studio-artist-${String(index + 1).padStart(3, "0")}`;
    const created = await content.write("/api/v1/admin/catalog/idols/create", {
      handle,
      expectedBaseVersion: 0,
    });
    const owner = { kind: "IDOL", idolId: created.idolId };
    const aliases =
      index === 99
        ? [{ id: "cross-locale-name", locale: "zh-CN", text: "星野一百" }]
        : undefined;
    const revisionId = await content.author(owner, {
      kind: "IDOL",
      structure: {
        themeAccent: "#CCAE7F",
        heroTextTone: "light",
        displayOrder: index,
      },
      media: [
        ["PORTRAIT", family.portrait],
        ["HERO_DESKTOP", family.desktop],
        ["HERO_MOBILE", family.mobile],
      ].map(([role, media], sortOrder) => ({
        role,
        mediaAssetId: media.assetId,
        mediaMetadataRevisionId: media.revisionId,
        sortOrder,
      })),
      translations: workspaceTranslations((locale) => ({
        displayName: name,
        shortBio: copy[locale].bio,
        fullBio: `<p>${copy[locale].story}</p>`,
        seoTitle: name,
        seoDescription: copy[locale].bio,
      })),
      ...(aliases ? { aliases } : {}),
    });
    await content.approve(owner, revisionId);
    if (aliases)
      await content.approveExtension({
        schemaVersion: 1,
        kind: "IDOL_ALIASES",
        idolRevisionId: revisionId,
      });
    await content.publish(owner, revisionId);
    const current = await content.request("/api/v1/admin/catalog/owners/read", {
      target: owner,
      locale: "en",
    });
    await content.write("/api/v1/admin/catalog/idols/status", {
      idolId: created.idolId,
      status: index === 4 ? "paused" : "active",
      acceptingGifts: index !== 4,
      expectedBaseVersion: current.owner.baseVersion,
    });
    artists.push({
      id: created.idolId,
      owner,
      revisionId,
      handle,
      name,
      family: index % families.length,
      acceptingGifts: index !== 4,
    });
  }
  check(
    artists.length >= 120,
    "actual published catalog contains at least 120 stable artist identities",
  );
  const gifts = [];
  for (const [index, [handle, name, file, giftKind]] of [
    ["rose-palace", "Rose Palace", "gift-rose-palace.webp", "VIRTUAL"],
    ["blue-orbit", "Blue Orbit", "gift-blue-orbit.webp", "WISH"],
    ["ruby-bouquet", "Ruby Bouquet", "gift-ruby-bouquet.webp", "PHYSICAL"],
  ].entries()) {
    progress(`publishing actual gift ${name}`);
    const media = await publishMedia(
      path.join(publicRoot, "ui-brand", file),
      "GIFT_PRIMARY",
      name,
    );
    const created = await content.write(
      "/api/v1/admin/gift-commerce/gifts/create",
      { handle, expectedBaseVersion: 0 },
    );
    const giftId = created.giftId;
    const read = async () =>
      (
        await content.request("/api/v1/admin/gift-commerce/gifts/read", {
          giftId,
          locale: "en",
        })
      ).value;
    let gift = await read();
    const variant = await content.write(
      "/api/v1/admin/gift-commerce/variants/save",
      {
        giftId,
        giftVariantId: null,
        expectedBaseVersion: gift.gift.version,
        expectedVariantVersion: 0,
        sku: `STOREFRONT-FIXTURE-${index + 1}`,
        status: "draft",
        inventoryPolicy: "PROCURE_ON_DEMAND",
        eligibleIdolIds: artists
          .filter((artist) => artist.acceptingGifts)
          .map((artist) => artist.id),
      },
    );
    gift = await read();
    const owner = { kind: "GIFT", giftId };
    const saved = await content.write(
      "/api/v1/admin/gift-commerce/content/save",
      {
        expectedBaseVersion: gift.gift.version,
        giftKind,
        authoring: {
          schemaVersion: 1,
          action: "CREATE",
          target: owner,
          expectedVersion: 0,
          content: {
            kind: "GIFT",
            structure: {
              category: "OTHER",
              contents: [
                { componentCode: "STUDIO_GIFT", quantity: 1, unit: "ITEM" },
              ],
              deliveryEstimate: { minimum: 3, maximum: 14, unit: "DAY" },
              requiresSafetyNotice: false,
              shippingMode: "internal_to_idol",
            },
            media: [
              {
                role: "PRIMARY",
                mediaAssetId: media.assetId,
                mediaMetadataRevisionId: media.revisionId,
                sortOrder: 0,
              },
            ],
            translations: workspaceTranslations((locale) => ({
              title: name,
              subtitle: copy[locale].gift,
              shortDescription: copy[locale].gift,
              description: copy[locale].care,
              fulfillmentDescription: copy[locale].care,
              variantLabels: [
                { giftVariantId: variant.giftVariantId, label: name },
              ],
              seoTitle: name,
              seoDescription: copy[locale].gift,
            })),
          },
        },
      },
    );
    await content.approve(owner, saved.giftRevisionId);
    gift = await read();
    const currentVariant = gift.variants.find(
      (value) => value.id === variant.giftVariantId,
    );
    check(currentVariant?.status === "draft", "new gift variant starts draft");
    await content.write("/api/v1/admin/gift-commerce/variants/save", {
      giftId,
      giftVariantId: currentVariant.id,
      expectedBaseVersion: gift.gift.version,
      expectedVariantVersion: currentVariant.version,
      sku: currentVariant.sku,
      status: "active",
      inventoryPolicy: currentVariant.inventoryPolicy,
      eligibleIdolIds: currentVariant.eligibleIdolIds,
    });
    gifts.push({
      id: giftId,
      handle,
      name,
      owner,
      revisionId: saved.giftRevisionId,
      variantId: variant.giftVariantId,
    });
  }
  const at = (
    await client.query(
      "SELECT to_char((clock_timestamp()-interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
    )
  ).rows[0].at;
  const book = await content.write(
    "/api/v1/admin/gift-commerce/prices/create",
    {
      market: "GLOBAL",
      currency: "USD",
      expectedBookRevision: 0,
      expectedHeadVersion: 0,
      source: null,
      validFrom: at,
      validUntil: null,
      changes: gifts.map((gift, index) => ({
        giftVariantId: gift.variantId,
        unitAmountMinor: 1500 + index * 1000,
      })),
    },
    "manager",
  );
  await content.write(
    "/api/v1/admin/gift-commerce/prices/publish",
    {
      market: "GLOBAL",
      currency: "USD",
      priceBookId: book.priceBookId,
      revision: book.revision,
      expectedHeadVersion: 0,
      expectedContentHash: book.contentHash,
    },
    "manager",
  );
  for (const gift of gifts) await content.publish(gift.owner, gift.revisionId);
  const policyOwner = { kind: "POLICY", policyKey: "delivery" };
  progress("publishing actually effective delivery policy");
  await content.write("/api/v1/admin/resources/policies/register", {
    policyKey: "delivery",
    kind: "DELIVERY",
    expectedVersion: 0,
  });
  const policyEffectiveAt = (
    await client.query(
      "SELECT to_char((clock_timestamp()+interval '2 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
    )
  ).rows[0].at;
  const policyRevision = await content.author(policyOwner, {
    kind: "POLICY",
    structure: {
      kind: "DELIVERY",
      effectiveAt: policyEffectiveAt,
    },
    translations: workspaceTranslations((locale) => ({
      title: copy[locale].gift,
      summary: copy[locale].gift,
      body: `<p>${copy[locale].care}</p>`,
    })),
  });
  await content.approve(policyOwner, policyRevision);
  // Publication must see an already effective policy, beyond the immediate clock boundary.
  const policyDeadline = globalThis.performance.now() + 10_000;
  let policyEffective = false;
  while (!policyEffective && globalThis.performance.now() < policyDeadline) {
    policyEffective = (
      await client.query(
        "SELECT clock_timestamp()>=$1::timestamptz+interval '1 second' AS effective",
        [policyEffectiveAt],
      )
    ).rows[0].effective;
    if (!policyEffective) await delay(100);
  }
  check(
    policyEffective,
    "policy publication waits until its actual configured effective time",
  );
  await content.publish(policyOwner, policyRevision);
  const family = families[0];
  const slots = [
    {
      slotKey: "hero",
      kind: "HERO_IDOL",
      idolId: artists[0].id,
      desktopMediaAssetId: family.desktop.assetId,
      desktopMediaMetadataRevisionId: family.desktop.revisionId,
      mobileMediaAssetId: family.mobile.assetId,
      mobileMediaMetadataRevisionId: family.mobile.revisionId,
      sortOrder: 0,
    },
    ...artists.slice(0, 3).map((artist, index) => ({
      slotKey: `artist-${index + 1}`,
      kind: "FEATURED_IDOL",
      idolId: artist.id,
      sortOrder: index + 1,
    })),
    ...gifts.map((gift, index) => ({
      slotKey: `gift-${index + 1}`,
      kind: "FEATURED_GIFT",
      giftId: gift.id,
      sortOrder: index + 4,
    })),
    {
      slotKey: "delivery-policy",
      kind: "POLICY_LINK",
      policyKey: "delivery",
      sortOrder: 7,
    },
  ];
  const homepageOwner = { kind: "HOMEPAGE" };
  progress("publishing actual configured homepage");
  const homepageRevision = await content.author(homepageOwner, {
    kind: "HOMEPAGE",
    structure: { slots },
    translations: workspaceTranslations((locale) => ({
      heroTitle: copy[locale].title,
      heroSubtitle: copy[locale].subtitle,
      ctaLabel: copy[locale].cta,
      slotLabels: slots.map((slot) => ({
        slotKey: slot.slotKey,
        label:
          slot.slotKey === "hero"
            ? family.name
            : slot.kind === "POLICY_LINK"
              ? copy[locale].gift
              : slot.kind === "FEATURED_GIFT"
                ? gifts.find((gift) => gift.id === slot.giftId).name
                : artists.find((artist) => artist.id === slot.idolId).name,
      })),
      seoTitle: copy[locale].title,
      seoDescription: copy[locale].subtitle,
    })),
  });
  await content.approve(homepageOwner, homepageRevision);
  const homepage = await content.publish(homepageOwner, homepageRevision);
  for (const locale of SUPPORTED_LOCALES)
    check(
      Boolean(copy[locale]),
      "fixture dynamic copy covers canonical locale",
    );
  return {
    artists,
    gifts,
    families,
    homepage: {
      owner: homepageOwner,
      revisionId: homepageRevision,
      publicationId: homepage.publicationId,
    },
    target: artists[99],
    paused: artists[4],
    configured: { market: "GLOBAL", currency: "USD" },
  };
}
