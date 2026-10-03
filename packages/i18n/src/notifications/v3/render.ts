import { IntlMessageFormat } from "intl-messageformat";
import type {
  OrderNotificationContent,
  OrderNotificationRenderCommand,
  SupportedLocale,
} from "@fan-support/contracts";
import { copyV3 } from "./copy.js";
import {
  digitalItemTemplateV3,
  digitalNoteTemplateV3,
  htmlTemplateV3,
  itemTemplateV3,
  summaryItemLimitV3,
  summaryTemplateV3,
  textTemplateV3,
  variantTemplateV3,
} from "./layout.js";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

function fill(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\[\[([A-Z_]+)\]\]/gu, (_, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error("NOTIFICATION_TEMPLATE_INVALID");
    return value;
  });
}

function message(
  template: string,
  locale: SupportedLocale,
  values: Readonly<Record<string, string | number>> = {},
): string {
  const output = new IntlMessageFormat(template, locale, undefined, {
    ignoreTag: true,
  }).format(values);
  if (typeof output !== "string")
    throw new Error("NOTIFICATION_TEMPLATE_INVALID");
  return output;
}

/** Version-local formatter. BigInt preserves the last cent at MAX_SAFE_INTEGER. */
function money(
  amount: number,
  currency: string,
  locale: SupportedLocale,
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  const scale = 10n ** BigInt(digits);
  const integer = BigInt(amount);
  const fraction = (integer % scale).toString().padStart(digits, "0");
  const digitFormatter = new Intl.NumberFormat(locale, {
    useGrouping: false,
    maximumFractionDigits: 0,
  });
  const localizedFraction = [...fraction]
    .map((digit) => digitFormatter.format(Number(digit)))
    .join("");
  return formatter
    .formatToParts(integer / scale)
    .map((part) => (part.type === "fraction" ? localizedFraction : part.value))
    .join("");
}

export function renderV3(
  command: OrderNotificationRenderCommand,
): OrderNotificationContent {
  const locale = command.locale.resolvedLocale;
  const copy = copyV3[locale];
  const event = copy.events[command.eventType];
  const data = command.variables;
  // The fan-facing number; the UUID stays inside the link fragment (F1-2).
  if (data.publicOrderNo === null)
    throw new Error("NOTIFICATION_VARIABLES_INVALID");
  const subject = message(event.subject, locale, { siteName: data.siteName });
  const preheader = message(event.preheader, locale);
  const heading = message(event.heading, locale);
  const body = message(event.body, locale);
  const date =
    new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "UTC",
      calendar: "gregory",
    }).format(new Date(data.orderedAt)) + " UTC";
  const shared = {
    LANG: locale,
    SUBJECT: subject,
    PREHEADER: preheader,
    SITE_NAME: data.siteName,
    HEADING: heading,
    BODY: body,
    ORDER_LABEL: copy.orderLabel,
    ORDER_ID: data.publicOrderNo,
    ORDERED_AT_LABEL: copy.orderedAt,
    ORDERED_AT_ISO: new Date(data.orderedAt).toISOString(),
    ORDERED_AT: date,
    ITEMS_LABEL: copy.items,
    TOTAL_LABEL: copy.total,
    TOTAL: money(data.totalMinor, data.currency, locale),
    ORDER_URL: data.orderUrl,
    VIEW_ORDER: copy.viewOrder,
    SECURITY: copy.security,
    SOURCE_NOTE: copy.sourceNote,
  };
  // ADR-019: a VIRTUAL gift is delivered as the artist's support record, not by the studio.
  const digital = data.items.some((item) => item.giftKind === "VIRTUAL");
  const summaryItems = data.items.slice(0, summaryItemLimitV3);
  const remainder = data.items.length - summaryItems.length;
  const summary =
    remainder === 0
      ? ""
      : message(copy.moreItems, locale, { count: remainder });
  const itemsHtml = summaryItems
    .map((item) =>
      fill(itemTemplateV3, {
        IDOL_LOCALE: item.idolLocale,
        IDOL_NAME: escapeHtml(item.idolName),
        GIFT_LOCALE: item.giftLocale,
        GIFT_NAME: escapeHtml(item.giftName),
        VARIANT:
          item.variantName === null
            ? ""
            : fill(variantTemplateV3, {
                VARIANT_LOCALE: item.variantLocale!,
                VARIANT_NAME: escapeHtml(item.variantName),
              }),
        KIND:
          item.giftKind === "VIRTUAL"
            ? fill(digitalItemTemplateV3, {
                DIGITAL_ITEM: escapeHtml(copy.digitalItem),
              })
            : "",
        QUANTITY: escapeHtml(
          message(copy.quantity, locale, { quantity: item.quantity }),
        ),
        AMOUNT: escapeHtml(money(item.lineTotalMinor, data.currency, locale)),
      }),
    )
    .join("\n");
  const itemsText = summaryItems
    .map((item) =>
      [
        item.idolName,
        item.giftName,
        item.variantName,
        item.giftKind === "VIRTUAL" ? copy.digitalItem : null,
        message(copy.quantity, locale, { quantity: item.quantity }),
        money(item.lineTotalMinor, data.currency, locale),
      ]
        .filter((value) => value !== null)
        .join("\n"),
    )
    .join("\n\n");
  const escaped = Object.fromEntries(
    Object.entries(shared).map(([key, value]) => [key, escapeHtml(value)]),
  );
  return {
    subject,
    preheader,
    html: fill(htmlTemplateV3, {
      ...escaped,
      NOTE: digital
        ? fill(digitalNoteTemplateV3, {
            DIGITAL_NOTE: escapeHtml(copy.digitalSupport),
          })
        : "",
      ITEMS: itemsHtml,
      SUMMARY:
        summary === ""
          ? ""
          : fill(summaryTemplateV3, { SUMMARY_TEXT: escapeHtml(summary) }),
    }),
    text: fill(textTemplateV3, {
      ...shared,
      NOTE: digital ? copy.digitalSupport : "",
      ITEMS: itemsText,
      SUMMARY: summary,
    }),
  };
}
