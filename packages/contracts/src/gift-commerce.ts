import { z } from "zod";
import { schemaVersionSchema } from "./versioning.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  contentTimestampSchema,
  revisionLifecycleSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { idempotencyKeySchema } from "./identifiers.js";
import { currencySchema, marketSchema, minorAmountSchema } from "./commerce.js";
import { slugSchema } from "./presentation.js";
import {
  giftBaseSchema,
  giftVariantDefinitionSchema,
} from "./catalog-content.js";
import {
  contentAuthoringCommandSchema,
  contentAuthoringContentSchema,
  contentAuthoringChangesSchema,
} from "./content-authoring.js";
import {
  inventoryBalanceSchema,
  inventoryItemSchema,
  inventoryLedgerEntrySchema,
  inventoryLocationSchema,
} from "./pricing-inventory-content.js";
import {
  adminContentFailureSchema,
  adminOpaqueTokenSchema,
  adminPrincipalSchema,
} from "./admin-content.js";
import {
  giftKindSchema,
  giftRevisionProfileStateSchema,
} from "./gift-commerce-profile.js";

const version = schemaVersionSchema;
const uuid = z.uuid();
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const expectedSequence = sequence.max(Number.MAX_SAFE_INTEGER - 1);
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u);
const mutation = { reasonCode: reason, idempotencyKey: idempotencyKeySchema };
const pagination = {
  page: z.number().int().min(1).max(1000),
  pageSize: z.number().int().min(1).max(50),
};
const locales = z
  .array(supportedLocaleSchema)
  .max(7)
  .refine((values) => new Set(values).size === values.length);
const scope = { market: marketSchema, currency: currencySchema };
function distinctIds(values: readonly string[]) {
  return (
    new Set(values.map((value) => value.toLowerCase())).size === values.length
  );
}

/** New operations preserve the database's microseconds; old timestamp roots remain unchanged. */
export const giftCommerceTimestampSchema = contentTimestampSchema
  .regex(/^[^.]+(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u)
  .refine(
    (value) =>
      Number(value.slice(0, 4)) >= 1 &&
      new Date(value).getUTCFullYear() >= 1 &&
      new Date(value).getUTCFullYear() <= 9999,
  );
function instant(value: string): bigint {
  const fraction = /\.(\d+)/u.exec(value)?.[1] ?? "";
  return (
    BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3))
  );
}
function validWindow(value: { validFrom: string; validUntil: string | null }) {
  return (
    value.validUntil === null ||
    instant(value.validFrom) < instant(value.validUntil)
  );
}

export const giftCommercePermissionSchema = z.enum([
  "commerce.read",
  "gift.manage",
  "pricing.manage",
  "inventory.manage",
]);
export const giftCommerceFailureSchema = adminContentFailureSchema.extend({
  code: z.union([
    adminContentFailureSchema.shape.code,
    z.enum([
      "COMMERCE_UNAVAILABLE",
      "UNSUPPORTED_PRICE_SOURCE",
      "INVALID_PRICE_WINDOW",
      "PRICE_BOOK_NOT_READY",
      "INVENTORY_POLICY_LOCKED",
      "INSUFFICIENT_INVENTORY",
      "INVENTORY_NOT_TRACKED",
      "GIFT_NOT_READY",
    ]),
  ]),
});
const digests = {
  schemaVersion: version,
  sessionTokenDigest: sourceHashSchema,
  csrfTokenDigest: sourceHashSchema,
};
export const giftCommerceAuthorizationCommandSchema = z.strictObject({
  ...digests,
  permission: giftCommercePermissionSchema,
  locales,
});
export const giftCommerceAuthorizationResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    principal: adminPrincipalSchema,
  }),
  giftCommerceFailureSchema,
]);
export const giftCommerceAccessContextCommandSchema = z.strictObject(digests);
const capabilities = {
  permissions: z
    .array(giftCommercePermissionSchema)
    .max(4)
    .refine((values) => new Set(values).size === values.length),
  localeScopes: locales,
};
export const giftCommerceAccessContextResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    principal: adminPrincipalSchema,
    ...capabilities,
  }),
  giftCommerceFailureSchema,
]);

const contentCreate = contentAuthoringCommandSchema.options[1]
  .omit({ idempotencyKey: true, reasonCode: true })
  .extend({
    target: z.strictObject({ kind: z.literal("GIFT"), giftId: uuid }),
    content: contentAuthoringContentSchema.options[1],
  });
const contentCopy = contentAuthoringCommandSchema.options[2]
  .omit({ idempotencyKey: true, reasonCode: true })
  .extend({
    target: z.strictObject({ kind: z.literal("GIFT"), giftId: uuid }),
    changes: contentAuthoringChangesSchema.options[1],
  });
export const giftCommerceContentAuthoringSchema = z.discriminatedUnion(
  "action",
  [contentCreate, contentCopy],
);

const contextCommand = z.strictObject({
  schemaVersion: version,
  action: z.literal("CONTEXT"),
});
const readGift = z.strictObject({
  schemaVersion: version,
  action: z.literal("READ_GIFT"),
  giftId: uuid,
  locale: supportedLocaleSchema,
  revisionId: uuid.optional(),
});
/** revision null lists book history; a positive revision reads that immutable book's prices. */
const readPrices = z.strictObject({
  schemaVersion: version,
  action: z.literal("READ_PRICES"),
  ...scope,
  revision: sequence.positive().nullable(),
  ...pagination,
});
const readInventory = z.strictObject({
  schemaVersion: version,
  action: z.literal("READ_INVENTORY"),
  giftVariantId: uuid,
  inventoryLocationId: uuid.nullable(),
  view: z.enum(["BALANCES", "LEDGER"]),
  ...pagination,
});
const createGift = z.strictObject({
  schemaVersion: version,
  action: z.literal("CREATE_GIFT"),
  handle: slugSchema,
  expectedBaseVersion: z.literal(0),
  ...mutation,
});
const setGiftStatus = z.strictObject({
  schemaVersion: version,
  action: z.literal("SET_GIFT_STATUS"),
  giftId: uuid,
  expectedBaseVersion: expectedSequence.positive(),
  status: z.enum(["active", "paused", "archived"]),
  ...mutation,
});
const saveVariant = z
  .strictObject({
    schemaVersion: version,
    action: z.literal("SAVE_VARIANT"),
    giftId: uuid,
    giftVariantId: uuid.nullable(),
    expectedBaseVersion: expectedSequence.positive(),
    expectedVariantVersion: expectedSequence,
    sku: giftVariantDefinitionSchema.shape.sku,
    status: giftVariantDefinitionSchema.shape.status,
    inventoryPolicy: giftVariantDefinitionSchema.shape.inventoryPolicy,
    eligibleIdolIds: z.array(uuid).max(2000).refine(distinctIds),
    ...mutation,
  })
  .superRefine((value, context) => {
    if (
      (value.giftVariantId === null) !== (value.expectedVariantVersion === 0) ||
      (value.giftVariantId === null && value.status !== "draft")
    )
      context.addIssue({
        code: "custom",
        message: "a new variant starts draft at version zero",
        path: ["expectedVariantVersion"],
      });
  });
const saveGiftContent = z.strictObject({
  schemaVersion: version,
  action: z.literal("SAVE_GIFT_CONTENT"),
  expectedBaseVersion: expectedSequence.positive(),
  giftKind: giftKindSchema,
  authoring: giftCommerceContentAuthoringSchema,
  ...mutation,
});
const createPrice = z
  .strictObject({
    schemaVersion: version,
    action: z.literal("CREATE_PRICE_REVISION"),
    ...scope,
    expectedBookRevision: expectedSequence,
    expectedHeadVersion: expectedSequence,
    source: z
      .strictObject({
        priceBookId: uuid,
        revision: sequence.positive(),
        contentHash: sourceHashSchema,
      })
      .nullable(),
    validFrom: giftCommerceTimestampSchema,
    validUntil: giftCommerceTimestampSchema.nullable(),
    changes: z
      .array(
        z.strictObject({
          giftVariantId: uuid,
          unitAmountMinor: minorAmountSchema,
        }),
      )
      .min(1)
      .max(500)
      .refine((values) =>
        distinctIds(values.map((value) => value.giftVariantId)),
      ),
    ...mutation,
  })
  .superRefine((value, context) => {
    if (!validWindow(value))
      context.addIssue({
        code: "custom",
        message: "price window is nonempty and half open",
        path: ["validUntil"],
      });
    if (
      (value.source === null) !== (value.expectedBookRevision === 0) ||
      (value.source !== null &&
        value.source.revision > value.expectedBookRevision)
    )
      context.addIssue({
        code: "custom",
        message: "source belongs to existing authoring history",
        path: ["source"],
      });
    if (value.expectedBookRevision === 0 && value.expectedHeadVersion !== 0)
      context.addIssue({
        code: "custom",
        message: "a first book has no publication head",
        path: ["expectedHeadVersion"],
      });
  });
const pricePublication = {
  schemaVersion: version,
  ...scope,
  priceBookId: uuid,
  revision: sequence.positive(),
  expectedHeadVersion: expectedSequence,
  expectedContentHash: sourceHashSchema,
  ...mutation,
};
const publishPrice = z.strictObject({
  ...pricePublication,
  action: z.literal("PUBLISH_PRICE_BOOK"),
});
const rollbackPrice = z.strictObject({
  ...pricePublication,
  action: z.literal("ROLLBACK_PRICE_BOOK"),
  expectedHeadVersion: expectedSequence.positive(),
});
const createLocation = z.strictObject({
  schemaVersion: version,
  action: z.literal("CREATE_INVENTORY_LOCATION"),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  expectedVersion: z.literal(0),
  ...mutation,
});
const adjustInventory = z
  .strictObject({
    schemaVersion: version,
    action: z.literal("ADJUST_INVENTORY"),
    giftVariantId: uuid,
    inventoryLocationId: uuid,
    expectedVariantVersion: expectedSequence.positive(),
    expectedBalanceVersion: expectedSequence,
    deltaOnHand: z
      .number()
      .int()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER)
      .refine((value) => value !== 0),
    ...mutation,
  })
  .refine(
    (value) => value.expectedBalanceVersion !== 0 || value.deltaOnHand > 0,
    "first stock receipt must add on-hand units",
  );
export const giftCommerceReadCommandSchema = z.discriminatedUnion("action", [
  contextCommand,
  readGift,
  readPrices,
  readInventory,
]);
export const giftCommerceMutationCommandSchema = z.discriminatedUnion(
  "action",
  [
    createGift,
    setGiftStatus,
    saveVariant,
    saveGiftContent,
    createPrice,
    publishPrice,
    rollbackPrice,
    createLocation,
    adjustInventory,
  ],
);
export const giftCommerceCommandSchema = z.union([
  giftCommerceReadCommandSchema,
  giftCommerceMutationCommandSchema,
]);
export const giftCommerceRequestSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: giftCommerceCommandSchema,
});
export const giftCommerceWriteCommandSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  principal: adminPrincipalSchema,
  command: giftCommerceMutationCommandSchema,
});
export const giftCommerceReceiptReadCommandSchema = z.strictObject({
  schemaVersion: version,
  resultId: uuid,
  actorId: uuid,
});

export const giftCommerceVariantSchema = giftVariantDefinitionSchema.extend({
  version: sequence.positive(),
  eligibleIdolIds: z.array(uuid).max(2000).refine(distinctIds),
  inventoryItemId: uuid.nullable(),
  policyLocked: z.boolean(),
});
export const giftCommerceGiftSchema = z
  .strictObject({
    schemaVersion: version,
    gift: giftBaseSchema,
    locale: supportedLocaleSchema,
    label: z.string().max(160).nullable(),
    authoringVersion: sequence,
    publicationHeadVersion: sequence,
    latestRevisionId: uuid.nullable(),
    latestProfile: giftRevisionProfileStateSchema.nullable(),
    publishedProfile: giftRevisionProfileStateSchema.nullable(),
    selectedRevisionId: uuid.nullable(),
    selectedProfile: giftRevisionProfileStateSchema.nullable(),
    variants: z.array(giftCommerceVariantSchema).max(2000),
  })
  .superRefine((value, context) => {
    const profileRevision = (
      profile: z.infer<typeof giftRevisionProfileStateSchema> | null,
    ) =>
      profile?.kind === "PROFILE"
        ? profile.profile.giftRevisionId
        : profile?.giftRevisionId;
    if (
      (value.latestRevisionId === null) !== (value.latestProfile === null) ||
      (value.gift.publishedRevisionId === null) !==
        (value.publishedProfile === null) ||
      (value.selectedRevisionId === null) !== (value.selectedProfile === null)
    )
      context.addIssue({
        code: "custom",
        message: "profile state records each existing revision",
        path: ["latestProfile"],
      });
    for (const [profile, revisionId] of [
      [value.latestProfile, value.latestRevisionId],
      [value.publishedProfile, value.gift.publishedRevisionId],
      [value.selectedProfile, value.selectedRevisionId],
    ] as const)
      if (
        profile !== null &&
        (profileRevision(profile)?.toLowerCase() !==
          revisionId?.toLowerCase() ||
          (profile.kind === "PROFILE" &&
            profile.profile.giftId.toLowerCase() !==
              value.gift.id.toLowerCase()))
      )
        context.addIssue({
          code: "custom",
          message: "classification belongs to the selected gift revision",
          path: ["latestProfile"],
        });
    if (
      !distinctIds(value.variants.map((variant) => variant.id)) ||
      value.variants.some(
        (variant) =>
          variant.giftId.toLowerCase() !== value.gift.id.toLowerCase(),
      )
    )
      context.addIssue({
        code: "custom",
        message: "variants uniquely belong to this gift",
        path: ["variants"],
      });
  });
export const giftCommercePriceHeadSchema = z.strictObject({
  priceBookId: uuid,
  revision: sequence.positive(),
  publicationId: uuid,
  version: sequence.positive(),
});
export const giftCommercePriceBookSchema = z
  .strictObject({
    schemaVersion: version,
    priceBookId: uuid,
    revision: sequence.positive(),
    ...scope,
    lifecycle: revisionLifecycleSchema,
    validFrom: giftCommerceTimestampSchema,
    validUntil: giftCommerceTimestampSchema.nullable(),
    contentHash: sourceHashSchema,
    priceCount: sequence,
    singleWindow: z.boolean(),
  })
  .refine(validWindow);
export const giftCommercePriceSchema = z
  .strictObject({
    schemaVersion: version,
    priceId: uuid,
    priceRevision: sequence.positive(),
    priceBookId: uuid,
    priceBookRevision: sequence.positive(),
    giftVariantId: uuid,
    unitAmountMinor: minorAmountSchema,
    validFrom: giftCommerceTimestampSchema,
    validUntil: giftCommerceTimestampSchema.nullable(),
  })
  .refine(validWindow);
export const giftCommerceRawContextSchema = z
  .strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("COMMERCE_CONTEXT"),
    markets: z
      .array(
        z.strictObject({
          marketId: uuid,
          market: marketSchema,
          currencies: z
            .array(currencySchema)
            .min(1)
            .max(100)
            .refine((values) => new Set(values).size === values.length),
        }),
      )
      .max(500),
    inventoryLocations: z.array(inventoryLocationSchema).max(2000),
  })
  .superRefine((value, context) => {
    if (
      !distinctIds(value.markets.map((market) => market.marketId)) ||
      new Set(value.markets.map((market) => market.market)).size !==
        value.markets.length
    )
      context.addIssue({
        code: "custom",
        message: "discovered markets have unique identities and codes",
        path: ["markets"],
      });
    if (
      !distinctIds(value.inventoryLocations.map((location) => location.id)) ||
      new Set(value.inventoryLocations.map((location) => location.code))
        .size !== value.inventoryLocations.length
    )
      context.addIssue({
        code: "custom",
        message: "discovered locations have unique identities and codes",
        path: ["inventoryLocations"],
      });
  });
export const giftCommerceContextResponseSchema =
  giftCommerceRawContextSchema.safeExtend(capabilities);
const readSuccess = { schemaVersion: version, outcome: z.literal("SUCCESS") };
const paged = { ...readSuccess, ...pagination, totalItems: sequence };
const bookContext = {
  ...scope,
  authoringVersion: sequence,
  head: giftCommercePriceHeadSchema.nullable(),
};
export const giftCommerceReadResponseSchema = z
  .union([
    giftCommerceContextResponseSchema,
    z.strictObject({
      ...readSuccess,
      kind: z.literal("GIFT"),
      value: giftCommerceGiftSchema,
    }),
    z.strictObject({
      ...paged,
      ...bookContext,
      kind: z.literal("PRICE_BOOKS"),
      items: z.array(giftCommercePriceBookSchema).max(50),
    }),
    z
      .strictObject({
        ...paged,
        ...bookContext,
        kind: z.literal("PRICES"),
        book: giftCommercePriceBookSchema,
        items: z.array(giftCommercePriceSchema).max(50),
      })
      .superRefine((value, context) => {
        if (
          value.book.market !== value.market ||
          value.book.currency !== value.currency ||
          value.items.some(
            (item) =>
              item.priceBookId.toLowerCase() !==
                value.book.priceBookId.toLowerCase() ||
              item.priceBookRevision !== value.book.revision,
          )
        )
          context.addIssue({
            code: "custom",
            message:
              "price rows belong to the requested book and commerce context",
            path: ["items"],
          });
      }),
    z.strictObject({
      ...paged,
      kind: z.literal("INVENTORY_BALANCES"),
      giftVariantId: uuid,
      inventoryLocationId: uuid.nullable(),
      item: inventoryItemSchema.nullable(),
      items: z.array(inventoryBalanceSchema).max(50),
    }),
    z.strictObject({
      ...paged,
      kind: z.literal("INVENTORY_LEDGER"),
      giftVariantId: uuid,
      inventoryLocationId: uuid.nullable(),
      item: inventoryItemSchema.nullable(),
      items: z
        .array(inventoryLedgerEntrySchema.omit({ idempotencyKey: true }))
        .max(50),
    }),
    giftCommerceFailureSchema,
  ])
  .superRefine((value, context) => {
    if (
      value.outcome !== "SUCCESS" ||
      (value.kind !== "INVENTORY_BALANCES" && value.kind !== "INVENTORY_LEDGER")
    )
      return;
    if (
      value.items.length > value.pageSize ||
      value.items.length > value.totalItems ||
      (value.item === null && value.items.length !== 0) ||
      (value.item !== null &&
        value.item.giftVariantId.toLowerCase() !==
          value.giftVariantId.toLowerCase())
    )
      context.addIssue({
        code: "custom",
        message:
          "inventory page belongs to the actual variant and bounded count",
        path: ["items"],
      });
    const keys = value.items.map((item) =>
      "id" in item
        ? item.id
        : `${item.inventoryItemId}:${item.inventoryLocationId}`,
    );
    if (
      !distinctIds(keys) ||
      value.items.some(
        (item) =>
          item.inventoryItemId.toLowerCase() !== value.item?.id.toLowerCase() ||
          (value.inventoryLocationId !== null &&
            item.inventoryLocationId.toLowerCase() !==
              value.inventoryLocationId.toLowerCase()),
      )
    )
      context.addIssue({
        code: "custom",
        message: "inventory rows bind the actual item and selected location",
        path: ["items"],
      });
  });
const result = {
  ...readSuccess,
  kind: z.literal("MUTATION"),
  resultId: uuid,
  replayed: z.boolean(),
};
export const giftCommerceMutationSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...result,
    action: z.literal("CREATE_GIFT"),
    giftId: uuid,
    baseVersion: sequence.positive(),
  }),
  z.strictObject({
    ...result,
    action: z.literal("SET_GIFT_STATUS"),
    giftId: uuid,
    baseVersion: sequence.positive(),
  }),
  z.strictObject({
    ...result,
    action: z.literal("SAVE_VARIANT"),
    giftId: uuid,
    giftVariantId: uuid,
    variantVersion: sequence.positive(),
  }),
  z.strictObject({
    ...result,
    action: z.literal("SAVE_GIFT_CONTENT"),
    giftId: uuid,
    giftRevisionId: uuid,
    authoringVersion: sequence.positive(),
    profileHash: sourceHashSchema,
  }),
  z.strictObject({
    ...result,
    action: z.literal("CREATE_PRICE_REVISION"),
    ...scope,
    priceBookId: uuid,
    revision: sequence.positive(),
    headVersion: sequence,
    contentHash: sourceHashSchema,
  }),
  z.strictObject({
    ...result,
    action: z.literal("PUBLISH_PRICE_BOOK"),
    ...scope,
    priceBookId: uuid,
    revision: sequence.positive(),
    headVersion: sequence.positive(),
    contentHash: sourceHashSchema,
    publicationId: uuid,
  }),
  z.strictObject({
    ...result,
    action: z.literal("ROLLBACK_PRICE_BOOK"),
    ...scope,
    priceBookId: uuid,
    revision: sequence.positive(),
    headVersion: sequence.positive(),
    contentHash: sourceHashSchema,
    publicationId: uuid,
  }),
  z.strictObject({
    ...result,
    action: z.literal("CREATE_INVENTORY_LOCATION"),
    inventoryLocationId: uuid,
  }),
  z.strictObject({
    ...result,
    action: z.literal("ADJUST_INVENTORY"),
    giftVariantId: uuid,
    inventoryItemId: uuid,
    inventoryLocationId: uuid,
    balanceVersion: sequence.positive(),
  }),
]);
export const giftCommerceResponseSchema = z.union([
  giftCommerceReadResponseSchema,
  giftCommerceMutationSchema,
]);

export type GiftCommercePermission = z.infer<
  typeof giftCommercePermissionSchema
>;
export type GiftCommerceFailure = z.infer<typeof giftCommerceFailureSchema>;
export type GiftCommerceAuthorizationCommand = z.infer<
  typeof giftCommerceAuthorizationCommandSchema
>;
export type GiftCommerceAuthorizationResponse = z.infer<
  typeof giftCommerceAuthorizationResponseSchema
>;
export type GiftCommerceAccessContextCommand = z.infer<
  typeof giftCommerceAccessContextCommandSchema
>;
export type GiftCommerceAccessContextResponse = z.infer<
  typeof giftCommerceAccessContextResponseSchema
>;
export type GiftCommerceCommand = z.infer<typeof giftCommerceCommandSchema>;
export type GiftCommerceCommandInput = z.input<
  typeof giftCommerceCommandSchema
>;
export type GiftCommerceReadCommand = z.infer<
  typeof giftCommerceReadCommandSchema
>;
export type GiftCommerceMutationCommand = z.infer<
  typeof giftCommerceMutationCommandSchema
>;
export type GiftCommerceRequest = z.infer<typeof giftCommerceRequestSchema>;
export type GiftCommerceWriteCommand = z.infer<
  typeof giftCommerceWriteCommandSchema
>;
export type GiftCommerceReceiptReadCommand = z.infer<
  typeof giftCommerceReceiptReadCommandSchema
>;
export type GiftCommerceResponse = z.infer<typeof giftCommerceResponseSchema>;
export type GiftCommerceReadResponse = z.infer<
  typeof giftCommerceReadResponseSchema
>;
export type GiftCommerceMutation = z.infer<typeof giftCommerceMutationSchema>;
export type GiftCommerceRawContext = z.infer<
  typeof giftCommerceRawContextSchema
>;
export type GiftCommerceContextResponse = z.infer<
  typeof giftCommerceContextResponseSchema
>;
export type GiftCommerceGift = z.infer<typeof giftCommerceGiftSchema>;
export type GiftCommerceVariant = z.infer<typeof giftCommerceVariantSchema>;
export type GiftCommercePriceHead = z.infer<typeof giftCommercePriceHeadSchema>;
export type GiftCommercePriceBook = z.infer<typeof giftCommercePriceBookSchema>;
export type GiftCommercePrice = z.infer<typeof giftCommercePriceSchema>;
