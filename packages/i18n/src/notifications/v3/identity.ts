import { createHash } from "node:crypto";
import {
  SUPPORTED_LOCALES,
  type OrderNotificationEventType,
  type SupportedLocale,
} from "@fan-support/contracts";
import { copyV3 } from "./copy.js";
import {
  digitalItemTemplateV3,
  digitalNoteTemplateV3,
  htmlTemplateV3,
  itemTemplateV3,
  rendererVersionV3,
  summaryItemLimitV3,
  summaryTemplateV3,
  textTemplateV3,
  variantTemplateV3,
} from "./layout.js";
import variablesSchema from "./variables.schema.json" with { type: "json" };

export const eventTemplateKeys = {
  PAYMENT_CONFIRMED: "order.payment.confirmed",
  PREPARING: "order.preparing",
  DELIVERED: "order.delivered",
} as const;

/** JSON Schema cannot encode these custom refinements; they are versioned alongside it. */
const variableRefinementsV3 = {
  text: "No U+0000..U+001F or U+007F in names or siteName.",
  variant:
    "variantName and variantLocale are either both null or both non-null.",
  orderUrl:
    "HTTPS; no userinfo or query; /<SupportedLocale>/order-access#token=<43 base64url characters matching ^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$>&order=<uuid>; fragment order equals publicOrderId ignoring UUID case.",
  money:
    "Nonnegative safe integer minor units; BigInt quotient/remainder using ISO currency minor digits from Intl; no floating-point conversion.",
  date: "orderedAt rendered in UTC, never worker local time. No inferred fulfillment timestamp.",
  giftKind:
    "Optional per item; VIRTUAL marks a digital support record (ADR-019) and adds the digital note once per message.",
  publicOrderNo:
    "Required by v2 and shown as the order number (F1-2, FS- plus six Crockford base32 characters); publicOrderId only binds the link fragment.",
};

export function hashMaterial(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export const variablesHashV3 = hashMaterial({
  schema: variablesSchema,
  refinements: variableRefinementsV3,
});

export function localeMaterialV3(
  eventType: OrderNotificationEventType,
  locale: SupportedLocale,
) {
  const { events, ...shared } = copyV3[locale];
  return {
    event: events[eventType],
    shared,
    html: htmlTemplateV3,
    item: itemTemplateV3,
    variant: variantTemplateV3,
    digitalItem: digitalItemTemplateV3,
    digitalNote: digitalNoteTemplateV3,
    text: textTemplateV3,
    rendererVersion: rendererVersionV3,
    summaryItemLimit: summaryItemLimitV3,
    summaryHtml: summaryTemplateV3,
    variablesHash: variablesHashV3,
  };
}

export function templateVersionV3(
  eventType: OrderNotificationEventType,
): string {
  return `v3.${hashMaterial({ schemaVersion: 1, templateKey: eventTemplateKeys[eventType], locales: SUPPORTED_LOCALES.map((locale) => ({ locale, material: localeMaterialV3(eventType, locale) })) })}`;
}

export const variableSchemaV3 = variablesSchema;
