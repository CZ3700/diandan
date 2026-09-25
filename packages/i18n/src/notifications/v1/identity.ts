import { createHash } from "node:crypto";
import {
  SUPPORTED_LOCALES,
  type OrderNotificationEventType,
  type SupportedLocale,
} from "@fan-support/contracts";
import { copyV1 } from "./copy.js";
import {
  htmlTemplateV1,
  itemTemplateV1,
  rendererVersionV1,
  summaryItemLimitV1,
  summaryTemplateV1,
  textTemplateV1,
  variantTemplateV1,
} from "./layout.js";
import variablesSchema from "./variables.schema.json" with { type: "json" };

export const eventTemplateKeys = {
  PAYMENT_CONFIRMED: "order.payment.confirmed",
  PREPARING: "order.preparing",
  DELIVERED: "order.delivered",
} as const;

/** JSON Schema cannot encode these custom refinements; they are versioned alongside it. */
const variableRefinementsV1 = {
  text: "No U+0000..U+001F or U+007F in names or siteName.",
  variant:
    "variantName and variantLocale are either both null or both non-null.",
  orderUrl:
    "HTTPS; no userinfo or query; /<SupportedLocale>/order-access#token=<43 base64url characters matching ^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$>&order=<uuid>; fragment order equals publicOrderId ignoring UUID case.",
  money:
    "Nonnegative safe integer minor units; BigInt quotient/remainder using ISO currency minor digits from Intl; no floating-point conversion.",
  date: "orderedAt rendered in UTC, never worker local time. No inferred fulfillment timestamp.",
};

export function hashMaterial(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export const variablesHashV1 = hashMaterial({
  schema: variablesSchema,
  refinements: variableRefinementsV1,
});

export function localeMaterialV1(
  eventType: OrderNotificationEventType,
  locale: SupportedLocale,
) {
  const { events, ...shared } = copyV1[locale];
  return {
    event: events[eventType],
    shared,
    html: htmlTemplateV1,
    item: itemTemplateV1,
    variant: variantTemplateV1,
    text: textTemplateV1,
    rendererVersion: rendererVersionV1,
    summaryItemLimit: summaryItemLimitV1,
    summaryHtml: summaryTemplateV1,
    variablesHash: variablesHashV1,
  };
}

export function templateVersionV1(
  eventType: OrderNotificationEventType,
): string {
  return `v1.${hashMaterial({ schemaVersion: 1, templateKey: eventTemplateKeys[eventType], locales: SUPPORTED_LOCALES.map((locale) => ({ locale, material: localeMaterialV1(eventType, locale) })) })}`;
}

export const variableSchemaV1 = variablesSchema;
