import { createHash } from "node:crypto";
import {
  SUPPORTED_LOCALES,
  type OrderNotificationEventType,
  type SupportedLocale,
} from "@fan-support/contracts";
import { copyV2 } from "./copy.js";
import {
  digitalItemTemplateV2,
  digitalNoteTemplateV2,
  htmlTemplateV2,
  itemTemplateV2,
  rendererVersionV2,
  summaryItemLimitV2,
  summaryTemplateV2,
  textTemplateV2,
  variantTemplateV2,
} from "./layout.js";
import variablesSchema from "./variables.schema.json" with { type: "json" };

export const eventTemplateKeys = {
  PAYMENT_CONFIRMED: "order.payment.confirmed",
  PREPARING: "order.preparing",
  DELIVERED: "order.delivered",
} as const;

/** JSON Schema cannot encode these custom refinements; they are versioned alongside it. */
const variableRefinementsV2 = {
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
};

export function hashMaterial(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export const variablesHashV2 = hashMaterial({
  schema: variablesSchema,
  refinements: variableRefinementsV2,
});

export function localeMaterialV2(
  eventType: OrderNotificationEventType,
  locale: SupportedLocale,
) {
  const { events, ...shared } = copyV2[locale];
  return {
    event: events[eventType],
    shared,
    html: htmlTemplateV2,
    item: itemTemplateV2,
    variant: variantTemplateV2,
    digitalItem: digitalItemTemplateV2,
    digitalNote: digitalNoteTemplateV2,
    text: textTemplateV2,
    rendererVersion: rendererVersionV2,
    summaryItemLimit: summaryItemLimitV2,
    summaryHtml: summaryTemplateV2,
    variablesHash: variablesHashV2,
  };
}

export function templateVersionV2(
  eventType: OrderNotificationEventType,
): string {
  return `v2.${hashMaterial({ schemaVersion: 1, templateKey: eventTemplateKeys[eventType], locales: SUPPORTED_LOCALES.map((locale) => ({ locale, material: localeMaterialV2(eventType, locale) })) })}`;
}

export const variableSchemaV2 = variablesSchema;
