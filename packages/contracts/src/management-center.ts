import { z } from "zod";
import { schemaVersionSchema } from "./versioning.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { idempotencyKeySchema } from "./identifiers.js";
import {
  adminContentFailureSchema,
  adminOpaqueTokenSchema,
} from "./admin-content.js";
import { currencySchema, marketSchema, minorAmountSchema } from "./commerce.js";
import { giftCategorySchema } from "./catalog-content.js";
import { artistSearchTermSchema } from "./catalog-discovery.js";
import { giftKindSchema } from "./gift-commerce-profile.js";
import { wishGiftSummarySchema } from "./wish-binding.js";
import { publicMediaViewSchema, slugSchema } from "./presentation.js";
import { mediaMimeTypeSchema } from "./media-content.js";
import { MEDIA_IMAGE_PROFILE } from "./media-processing.js";
import { mediaUploadGrantResponseSchema } from "./resource-management.js";

import {
  managementImageInputSchema,
  managementImageTargetSchema,
  managementOriginalImageSchema,
} from "./management-image.js";

const uuid = z.uuid();
const version = schemaVersionSchema;
const sequence = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 1);
const text = (limit: number) => z.string().trim().min(1).max(limit);
const image = managementImageInputSchema;
const scope = { market: marketSchema, currency: currencySchema };
export const managementCenterPriceSchema = z.strictObject({
  ...scope,
  amountMinor: minorAmountSchema,
});
export const managementCenterInventorySchema = z.discriminatedUnion("policy", [
  z.strictObject({
    policy: z.literal("TRACKED"),
    locationId: uuid,
    quantity: sequence,
  }),
  z.strictObject({ policy: z.literal("PROCURE_ON_DEMAND") }),
  z.strictObject({ policy: z.literal("PREORDER") }),
]);
const editable = {
  sourceLocale: supportedLocaleSchema,
  id: uuid.nullable(),
  expectedVersion: sequence,
  name: text(40),
  description: text(600),
  image: image.nullable(),
};
export const managementCommerceEditSchema = z.strictObject({
  price: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("PRESERVE") }),
    z.strictObject({
      mode: z.literal("SET"),
      baseline: managementCenterPriceSchema,
    }),
  ]),
  inventory: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("PRESERVE") }),
    z.strictObject({
      mode: z.literal("SET"),
      baseline: managementCenterInventorySchema,
    }),
  ]),
});
const giftEditable = {
  kind: z.literal("SAVE_GIFT"),
  ...editable,
  name: text(100),
  giftKind: giftKindSchema,
  category: giftCategorySchema,
  price: managementCenterPriceSchema,
  inventory: managementCenterInventorySchema,
  eligibility: z.discriminatedUnion("rule", [
    z.strictObject({ rule: z.literal("ALL_ACTIVE_ARTISTS") }),
    z.strictObject({ rule: z.literal("SINGLE_ARTIST"), idolId: uuid }),
  ]),
};
export const managementCenterIntentSchema = z
  .union([
    z.strictObject({ kind: z.literal("SAVE_ARTIST"), ...editable }),
    z.union([
      z.strictObject(giftEditable),
      z.strictObject({
        ...giftEditable,
        commerceEdit: managementCommerceEditSchema,
      }),
    ]),
    z.strictObject({
      kind: z.literal("REPLACE_POSTER"),
      sourceLocale: supportedLocaleSchema,
      expectedVersion: sequence.positive(),
      image,
    }),
    z.strictObject({
      kind: z.literal("RESTORE_POSTER"),
      sourceLocale: supportedLocaleSchema,
      expectedVersion: sequence.positive(),
      sourceRevisionId: uuid,
    }),
  ])
  .superRefine((value, context) => {
    if (
      value.kind === "SAVE_GIFT" &&
      value.eligibility.rule === "SINGLE_ARTIST" &&
      value.giftKind !== "WISH"
    )
      context.addIssue({
        code: "custom",
        path: ["eligibility"],
        message: "Only wish gifts bind a single artist",
      });
    if (
      value.kind === "SAVE_GIFT" &&
      "commerceEdit" in value &&
      value.id === null
    )
      context.addIssue({
        code: "custom",
        path: ["commerceEdit"],
        message: "Commerce baselines require an existing gift",
      });
    if (value.kind === "SAVE_ARTIST" || value.kind === "SAVE_GIFT") {
      if ((value.id === null) !== (value.expectedVersion === 0))
        context.addIssue({
          code: "custom",
          path: ["expectedVersion"],
          message:
            "New targets require version zero; edits require the current version",
        });
      if (
        value.id === null &&
        (value.image === null || "currentImage" in value.image)
      )
        context.addIssue({
          code: "custom",
          path: ["image"],
          message: "A new target requires an uploaded image",
        });
    }
  });
export const managementCenterFailureSchema = adminContentFailureSchema.extend({
  code: z.union([
    adminContentFailureSchema.shape.code,
    z.enum([
      "MANAGEMENT_UNAVAILABLE",
      "NEEDS_AUTHORIZATION",
      "MEDIA_FAILED",
      "REUPLOAD_REQUIRED",
      "UPLOAD_NOT_READY",
      "HERO_NOT_CONFIGURED",
      "DEFAULTS_NOT_CONFIGURED",
      "TARGET_CONFLICT",
      "PUBLICATION_FAILED",
      "INVENTORY_POLICY_LOCKED",
    ]),
  ]),
});
export const managementCenterOperationSchema = z
  .strictObject({
    operationId: uuid,
    version: sequence.positive(),
    kind: z.enum([
      "SAVE_ARTIST",
      "SAVE_GIFT",
      "REPLACE_POSTER",
      "RESTORE_POSTER",
    ]),
    sourceLocale: supportedLocaleSchema,
    status: z.enum(["PROCESSING", "PUBLISHED", "FAILED"]),
    targetId: uuid.nullable(),
    updatedAt: contentTimestampSchema,
    result: z
      .strictObject({
        targetId: uuid,
        handle: slugSchema.nullable(),
        revisionId: uuid,
        publicationId: uuid,
        version: sequence.positive(),
      })
      .nullable(),
    failure: z
      .strictObject({
        code: managementCenterFailureSchema.shape.code,
        retryable: z.boolean(),
      })
      .nullable(),
  })
  .superRefine((value, context) => {
    const valid =
      value.status === "PUBLISHED"
        ? value.result !== null &&
          value.failure === null &&
          value.targetId === value.result.targetId
        : value.status === "FAILED"
          ? value.result === null && value.failure !== null
          : value.result === null && value.failure === null;
    if (!valid)
      context.addIssue({
        code: "custom",
        message: "Operation status and committed result must agree",
      });
  });
const mutation = { idempotencyKey: idempotencyKeySchema };
const pagination = {
  page: sequence.positive().max(1_000_000),
  pageSize: z.number().int().min(1).max(50),
};
/** ADR-022: the broker an artist belongs to. `brokerId` is the staff identity; no login name or contact detail. */
export const managementCenterBrokerSchema = z.strictObject({
  brokerId: uuid,
  displayName: z.string().min(1).max(80),
  /** False once the account is suspended or no longer a broker; the artist then needs reassigning. */
  active: z.boolean(),
});
const assignmentFilter = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("UNASSIGNED") }),
  z.strictObject({ kind: z.literal("BROKER"), brokerId: uuid }),
]);
export const managementCenterCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ schemaVersion: version, action: z.literal("CONTEXT") }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("READ_IMAGE_SOURCE"),
    target: managementImageTargetSchema,
  }),
  z
    .strictObject({
      schemaVersion: version,
      action: z.literal("LIST"),
      section: z.enum(["ARTISTS", "GIFTS", "POSTERS"]),
      ...pagination,
      /** Omitted lists every artist the account may manage. */
      assignment: assignmentFilter.optional(),
      /** Literal, case-insensitive matching against the displayed artist name. */
      search: artistSearchTermSchema.optional(),
      giftKind: giftKindSchema.optional(),
      /** Omitted keeps newest first; price sorts use the published management defaults. */
      sort: z.enum(["NEWEST", "PRICE_ASC", "PRICE_DESC"]).optional(),
    })
    .refine(
      (value) => value.assignment === undefined || value.section === "ARTISTS",
      { path: ["assignment"], message: "Only artists are assigned" },
    )
    .refine(
      (value) => value.search === undefined || value.section === "ARTISTS",
      { path: ["search"], message: "Only artists support name search" },
    )
    .refine(
      (value) =>
        (value.giftKind === undefined && value.sort === undefined) ||
        value.section === "GIFTS",
      { message: "Only gifts support kind filters and price ordering" },
    ),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("PREPARE_UPLOAD"),
    checksumSha256: sourceHashSchema,
    byteSize: z
      .number()
      .int()
      .positive()
      .max(MEDIA_IMAGE_PROFILE.sourceByteLimit),
    mimeType: mediaMimeTypeSchema,
    rightsConfirmed: z.literal(true),
    ...mutation,
  }),
  z
    .strictObject({
      schemaVersion: version,
      action: z.literal("SUBMIT"),
      intent: managementCenterIntentSchema,
      ...mutation,
    })
    .superRefine(({ intent }, context) => {
      if (intent.kind !== "SAVE_GIFT" || intent.giftKind !== "WISH") return;
      // Historical operation intents remain parseable; only new submissions require a binding.
      if (intent.eligibility.rule !== "SINGLE_ARTIST")
        context.addIssue({
          code: "custom",
          path: ["intent", "eligibility"],
          message: "Wish gifts require one artist",
        });
      if (
        intent.inventory.policy !== "TRACKED" ||
        intent.inventory.quantity > 1 ||
        (intent.id === null && intent.inventory.quantity !== 1)
      )
        context.addIssue({
          code: "custom",
          path: ["intent", "inventory"],
          message:
            "Wish gifts require one tracked unit; existing stock may be preserved",
        });
    }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("READ_OPERATION"),
    operationId: uuid,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("RETRY_OPERATION"),
    operationId: uuid,
    expectedVersion: sequence.positive(),
    ...mutation,
  }),
  // L2-09: removes an old poster from the list; the poster on the homepage cannot be archived.
  z.strictObject({
    schemaVersion: version,
    action: z.literal("ARCHIVE_POSTER"),
    revisionId: uuid,
    expectedVersion: sequence.positive(),
    sourceLocale: supportedLocaleSchema,
    ...mutation,
  }),
  // L3-11: `idols.assign` only. `expectedBrokerId` is the assignment the editor showed.
  z.strictObject({
    schemaVersion: version,
    action: z.literal("ASSIGN_ARTIST"),
    artistId: uuid,
    brokerId: uuid.nullable(),
    expectedBrokerId: uuid.nullable(),
    ...mutation,
  }),
]);
export const managementCenterRequestSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: managementCenterCommandSchema,
});
const listingBase = {
  id: uuid,
  version: sequence.positive(),
  sourceLocale: supportedLocaleSchema,
  name: text(160),
  description: z.string().max(600),
  image: publicMediaViewSchema.nullable(),
  status: z.enum(["draft", "active", "paused", "archived"]),
  handle: slugSchema,
};
const managementCenterGiftListItemSchema = z.strictObject({
  kind: z.literal("GIFT"),
  ...listingBase,
  giftKind: giftKindSchema,
  category: giftCategorySchema,
  price: managementCenterPriceSchema.nullable(),
  /** Display-only comparison price; never an edit baseline. Present only with LIST.priceScope. */
  sortPrice: managementCenterPriceSchema.nullable().exactOptional(),
  inventory: managementCenterInventorySchema.nullable(),
  eligibility: z.strictObject({
    rule: z.enum(["ALL_ACTIVE_ARTISTS", "EXPLICIT_ARTISTS"]),
  }),
  canEdit: z.boolean(),
  inventoryPolicyLocked: z.boolean(),
});
export const managementCenterListItemSchema = z.union([
  z.strictObject({
    kind: z.literal("ARTIST"),
    ...listingBase,
    /** The broker the artist belongs to; null is unassigned. A broker's list holds only its own. */
    assignment: managementCenterBrokerSchema.nullable(),
  }),
  managementCenterGiftListItemSchema,
  managementCenterGiftListItemSchema.extend({ wish: wishGiftSummarySchema }),
  z
    .strictObject({
      kind: z.literal("POSTER"),
      id: uuid,
      version: sequence.positive(),
      sourceLocale: supportedLocaleSchema,
      sourceRevisionId: uuid,
      current: z.boolean(),
      image: publicMediaViewSchema.nullable(),
      canRestore: z.boolean(),
      canDelete: z.boolean(),
      createdAt: contentTimestampSchema,
    })
    .refine((value) => !value.canRestore || value.image !== null)
    .refine((value) => !(value.current && value.canDelete)),
]);
const success = { schemaVersion: version, outcome: z.literal("SUCCESS") };
export const managementCenterResponseSchema = z.union([
  managementCenterFailureSchema,
  managementOriginalImageSchema,
  mediaUploadGrantResponseSchema.options[0],
  z.strictObject({
    ...success,
    kind: z.literal("OPERATION"),
    operation: managementCenterOperationSchema,
  }),
  z.strictObject({
    ...success,
    kind: z.literal("POSTER_ARCHIVED"),
    revisionId: uuid,
  }),
  z.strictObject({
    ...success,
    kind: z.literal("ARTIST_ASSIGNED"),
    artistId: uuid,
    assignment: managementCenterBrokerSchema.nullable(),
  }),
  z
    .strictObject({
      ...success,
      kind: z.literal("LIST"),
      section: z.enum(["ARTISTS", "GIFTS", "POSTERS"]),
      ...pagination,
      totalItems: sequence,
      items: z.array(managementCenterListItemSchema).max(50),
      priceScope: z.strictObject(scope).exactOptional(),
    })
    .superRefine((value, context) => {
      const expected = Math.max(
        0,
        Math.min(
          value.pageSize,
          value.totalItems - (value.page - 1) * value.pageSize,
        ),
      );
      const kind =
        value.section === "ARTISTS"
          ? "ARTIST"
          : value.section === "GIFTS"
            ? "GIFT"
            : "POSTER";
      if (
        value.items.length !== expected ||
        value.items.some((item) => item.kind !== kind)
      )
        context.addIssue({
          code: "custom",
          message: "Listing scope and cardinality must match",
        });
      const validPrices = value.priceScope
        ? value.section === "GIFTS" &&
          value.items.every(
            (item) =>
              item.kind === "GIFT" &&
              item.sortPrice !== undefined &&
              (item.sortPrice === null ||
                (item.sortPrice.market === value.priceScope?.market &&
                  item.sortPrice.currency === value.priceScope.currency)),
          )
        : value.items.every(
            (item) => item.kind !== "GIFT" || item.sortPrice === undefined,
          );
      if (!validPrices)
        context.addIssue({
          code: "custom",
          message: "Sort prices must match the gift list price scope",
        });
    }),
  z.strictObject({
    ...success,
    kind: z.literal("CONTEXT"),
    capability: z.literal("DIRECT_OPERATOR_V1"),
    markets: z
      .array(
        z.strictObject({
          market: marketSchema,
          currencies: z.array(currencySchema).min(1).max(100),
        }),
      )
      .max(250),
    defaults: z
      .strictObject({
        priceScope: z.strictObject(scope).nullable(),
        inventoryPolicy: z.enum(["TRACKED", "PROCURE_ON_DEMAND", "PREORDER"]),
        inventoryLocationId: uuid.nullable(),
        eligibility: z.literal("ALL_ACTIVE_ARTISTS"),
      })
      .nullable(),
    giftKinds: z.array(giftKindSchema).min(1).max(5),
    categories: z.array(giftCategorySchema).min(1).max(5),
    poster: z
      .strictObject({
        available: z.boolean(),
        version: sequence,
        currentRevisionId: uuid.nullable(),
      })
      .refine((value) =>
        value.available
          ? value.version > 0 && value.currentRevisionId !== null
          : value.version === 0 && value.currentRevisionId === null,
      ),
    operations: z.array(managementCenterOperationSchema).max(10),
    /** ADR-022: ASSIGNED accounts (brokers) manage only their own artists and no other section. */
    artists: z
      .strictObject({
        scope: z.enum(["ALL", "ASSIGNED"]),
        canAssign: z.boolean(),
        brokers: z.array(managementCenterBrokerSchema).max(500),
      })
      .refine(
        (value) =>
          value.scope === "ALL" ||
          (!value.canAssign && value.brokers.length === 0),
      ),
  }),
]);
export type ManagementCenterIntent = z.infer<
  typeof managementCenterIntentSchema
>;
export type ManagementCenterCommand = z.infer<
  typeof managementCenterCommandSchema
>;
export type ManagementCenterRequest = z.infer<
  typeof managementCenterRequestSchema
>;
export type ManagementCenterResponse = z.infer<
  typeof managementCenterResponseSchema
>;
export type ManagementCenterOperation = z.infer<
  typeof managementCenterOperationSchema
>;
export type ManagementCenterFailure = z.infer<
  typeof managementCenterFailureSchema
>;
export type ManagementCenterListItem = z.infer<
  typeof managementCenterListItemSchema
>;
export type ManagementCenterBroker = z.infer<
  typeof managementCenterBrokerSchema
>;
