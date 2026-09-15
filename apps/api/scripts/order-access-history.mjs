/** All current-content changes below use the existing authenticated authoring and publication commands. */
export async function changeOrderAccessCatalog(context) {
  const { content, fixtures, check } = context;
  const artist = fixtures.artists[0],
    gift = fixtures.gifts[0];
  const source = (
    await content.request("/api/v1/admin/content-authoring/read", {
      target: artist.owner,
      revisionId: artist.revisionId,
    })
  ).snapshot;
  const replacementArtist = (
    await content.request("/api/v1/admin/content-authoring/read", {
      target: fixtures.artists[1].owner,
      revisionId: fixtures.artists[1].revisionId,
    })
  ).snapshot;
  const copied = await content.write("/api/v1/admin/content-authoring/copy", {
    target: artist.owner,
    sourceRevisionId: source.revisionId,
    expectedSourceHash: source.contentHash,
    expectedVersion: source.headVersion,
    changes: {
      kind: "IDOL",
      translations: source.content.translations.map((row) => ({
        ...row,
        fields: { ...row.fields, displayName: `${row.fields.displayName} v2` },
      })),
      media: source.content.media.map((row) =>
        row.role === "PORTRAIT"
          ? {
              ...row,
              ...replacementArtist.content.media.find(
                (image) => image.role === "PORTRAIT",
              ),
            }
          : row,
      ),
    },
  });
  await content.approve(artist.owner, copied.resultId);
  await content.publish(artist.owner, copied.resultId);
  check(
    copied.resultId !== source.revisionId,
    "Normal artist republishing creates a distinct name and portrait revision",
  );

  const giftSource = (
    await content.request("/api/v1/admin/content-authoring/read", {
      target: gift.owner,
      revisionId: gift.revisionId,
    })
  ).snapshot;
  const giftCurrent = (
    await content.request("/api/v1/admin/gift-commerce/gifts/read", {
      giftId: gift.id,
      locale: "en",
    })
  ).value;
  const replacementGift = (
    await content.request("/api/v1/admin/content-authoring/read", {
      target: fixtures.gifts[1].owner,
      revisionId: fixtures.gifts[1].revisionId,
    })
  ).snapshot;
  const replacementImage = replacementGift.content.media.find(
    (image) => image.role === "PRIMARY",
  );
  check(
    Boolean(replacementImage),
    "Published replacement gift has a primary image",
  );
  const metadata = (
    await context.client.query(
      `SELECT head.media_metadata_revision_id AS id,revision.lifecycle,
       (SELECT prior.lifecycle FROM public.media_metadata_revisions prior WHERE prior.id=$2::uuid AND prior.media_asset_id=head.media_asset_id) AS prior_lifecycle
       FROM public.media_metadata_publication_heads head
       JOIN public.media_metadata_revisions revision ON revision.id=head.media_metadata_revision_id AND revision.media_asset_id=head.media_asset_id
       WHERE head.media_asset_id=$1::uuid`,
      [replacementImage.mediaAssetId, replacementImage.mediaMetadataRevisionId],
    )
  ).rows[0];
  check(
    metadata?.lifecycle === "PUBLISHED",
    "Replacement image metadata uses the real current published head",
  );
  console.log(
    `Order access historical media metadata ${JSON.stringify({
      currentLifecycle: metadata.lifecycle,
      priorReferenceLifecycle: metadata.prior_lifecycle,
      referenceAdvanced:
        metadata.id !== replacementImage.mediaMetadataRevisionId,
    })}`,
  );
  const details = giftSource.content.details;
  for (const block of details?.blocks ?? []) {
    if (block.kind !== "MEDIA") continue;
    const previous = (
      await content.request("/api/v1/admin/content-authoring/read", {
        target: { kind: "MEDIA_METADATA", mediaAssetId: block.mediaAssetId },
        revisionId: block.mediaMetadataRevisionId,
      })
    ).snapshot;
    console.log(
      `Order access historical detail media ${JSON.stringify({
        priorLifecycle: previous.lifecycle.status,
        replacementLifecycle: metadata.lifecycle,
        differentAsset: block.mediaAssetId !== replacementImage.mediaAssetId,
      })}`,
    );
  }
  const changedDetailIds = new Set(
    details?.blocks
      .filter((block) => block.kind === "MEDIA")
      .map((block) => block.id),
  );
  const changedDetails = details
    ? {
        ...details,
        blocks: details.blocks.map((block) =>
          block.kind === "MEDIA"
            ? {
                ...block,
                mediaAssetId: replacementImage.mediaAssetId,
                mediaMetadataRevisionId: metadata.id,
              }
            : block,
        ),
        translations: details.translations.map((translation) => ({
          ...translation,
          blocks: translation.blocks.map((block) =>
            block.kind === "MEDIA" && changedDetailIds.has(block.blockId)
              ? { ...block, mediaMetadataRevisionId: metadata.id }
              : block,
          ),
        })),
      }
    : undefined;
  const revised = await content.write(
    "/api/v1/admin/gift-commerce/content/save",
    {
      expectedBaseVersion: giftCurrent.gift.version,
      giftKind: gift.giftKind,
      authoring: {
        schemaVersion: 1,
        action: "COPY",
        target: gift.owner,
        sourceRevisionId: giftSource.revisionId,
        expectedSourceHash: giftSource.contentHash,
        expectedVersion: giftSource.headVersion,
        changes: {
          kind: "GIFT",
          ...(changedDetails ? { details: changedDetails } : {}),
          translations: giftSource.content.translations.map((row) => ({
            ...row,
            fields: { ...row.fields, title: `${row.fields.title} v2` },
          })),
          media: giftSource.content.media.map((row) =>
            row.role === "PRIMARY"
              ? {
                  ...row,
                  mediaAssetId: replacementImage.mediaAssetId,
                  mediaMetadataRevisionId: metadata.id,
                }
              : row,
          ),
        },
      },
    },
  );
  await content.approve(gift.owner, revised.giftRevisionId);
  if (gift.hasDetails)
    await content.approveExtension({
      schemaVersion: 1,
      kind: "GIFT_DETAILS",
      giftRevisionId: revised.giftRevisionId,
    });
  await content.publish(gift.owner, revised.giftRevisionId);
  check(
    revised.giftRevisionId !== giftSource.revisionId,
    "Normal gift republishing creates a distinct title and image revision",
  );

  const scope = fixtures.markets[0];
  const history = await content.request(
    "/api/v1/admin/gift-commerce/prices/read",
    { ...scope, revision: null, page: 1, pageSize: 50 },
  );
  const current = await content.request(
    "/api/v1/admin/gift-commerce/prices/read",
    { ...scope, revision: history.head.revision, page: 1, pageSize: 50 },
  );
  const originalPrice = (
    await context.client.query(
      "SELECT amount_minor::text AS amount FROM prices WHERE price_book_id=$1::uuid AND price_book_revision=$2::integer AND gift_variant_id=$3::uuid AND status='PUBLISHED'",
      [current.book.priceBookId, current.book.revision, gift.variants[0].id],
    )
  ).rows[0];
  const newAmount = Number(originalPrice.amount) + 137;
  const book = await content.write(
    "/api/v1/admin/gift-commerce/prices/create",
    {
      ...scope,
      expectedBookRevision: current.authoringVersion,
      expectedHeadVersion: current.head.version,
      source: {
        priceBookId: current.book.priceBookId,
        revision: current.book.revision,
        contentHash: current.book.contentHash,
      },
      validFrom: current.book.validFrom,
      validUntil: current.book.validUntil,
      changes: [
        { giftVariantId: gift.variants[0].id, unitAmountMinor: newAmount },
      ],
    },
    "manager",
  );
  await content.write(
    "/api/v1/admin/gift-commerce/prices/publish",
    {
      ...scope,
      priceBookId: book.priceBookId,
      revision: book.revision,
      expectedHeadVersion: current.head.version,
      expectedContentHash: book.contentHash,
    },
    "manager",
  );
  check(
    newAmount !== Number(originalPrice.amount),
    "Normal published price revision changes the real current price",
  );

  const currentArtist = await content.request(
    "/api/v1/admin/catalog/owners/read",
    { target: artist.owner, locale: "en" },
  );
  await content.write("/api/v1/admin/catalog/idols/status", {
    idolId: artist.id,
    status: "archived",
    acceptingGifts: false,
    expectedBaseVersion: currentArtist.owner.baseVersion,
  });
  const currentGift = (
    await content.request("/api/v1/admin/gift-commerce/gifts/read", {
      giftId: gift.id,
      locale: "en",
    })
  ).value;
  await content.write("/api/v1/admin/gift-commerce/gifts/status", {
    giftId: gift.id,
    status: "archived",
    expectedBaseVersion: currentGift.gift.version,
  });
  return {
    artistRepublished: true,
    giftRepublished: true,
    portraitAndGiftImageReplaced: true,
    currentArtistAndGiftArchived: true,
    oldAmount: Number(originalPrice.amount),
    newAmount,
  };
}
