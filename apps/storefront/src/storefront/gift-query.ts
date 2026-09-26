import {
  giftDiscoveryQuerySchema,
  minorAmountSchema,
  slugSchema,
  type CurrencyCode,
  type GiftDiscoveryQuery,
  type MinorAmount,
  type SupportedLocale,
} from "@fan-support/contracts";
import { queryString, storefrontHref } from "./navigation";

/** A gift entry chooses a new product; a variant belongs only to its original gift. */
export function giftDetailHref(
  locale: SupportedLocale,
  handle: string,
  contextQuery: string,
): string {
  const query = new URLSearchParams(contextQuery);
  query.delete("variant");
  return storefrontHref(
    locale,
    `/gifts/${slugSchema.parse(handle)}`,
    query.toString(),
  );
}

type SearchValues = Readonly<Record<string, string | string[] | undefined>>;

export type PreparedGiftQuery =
  | Readonly<{
      valid: true;
      query: GiftDiscoveryQuery;
      apiQuery: string;
      contextQuery: string;
    }>
  | Readonly<{
      valid: false;
      reason: "CONTEXT_REQUIRED" | "INVALID_QUERY";
      contextQuery: string;
    }>;

export type GiftFilters = Readonly<
  Pick<
    GiftDiscoveryQuery,
    | "sort"
    | "category"
    | "kind"
    | "priceMinMinor"
    | "priceMaxMinor"
    | "availability"
  >
>;

const fields = [
  "market",
  "currency",
  "idol",
  "page",
  "pageSize",
  "sort",
  "category",
  "kind",
  "priceMinMinor",
  "priceMaxMinor",
  "availability",
] as const;
const numericFields = new Set<string>([
  "page",
  "pageSize",
  "priceMinMinor",
  "priceMaxMinor",
]);

function serializeQuery(query: GiftDiscoveryQuery): URLSearchParams {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key !== "schemaVersion" && value !== undefined)
      values.set(key === "idolId" ? "idol" : key, String(value));
  }
  return values;
}

/** Parse only directory-owned fields; unrelated navigation context is retained in links. */
export function prepareGiftQuery(
  locale: SupportedLocale,
  values: SearchValues,
): PreparedGiftQuery {
  const contextQuery = queryString(values);
  const invalid = {
    valid: false,
    reason: "INVALID_QUERY",
    contextQuery,
  } as const;
  const input: Record<string, unknown> = { schemaVersion: 1, locale };
  for (const key of fields) {
    const value = values[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return invalid;
    if (numericFields.has(key)) {
      if (!/^(?:0|[1-9]\d{0,15})$/u.test(value)) return invalid;
      const number = Number(value);
      if (!Number.isSafeInteger(number)) return invalid;
      input[key] = number;
    } else input[key === "idol" ? "idolId" : key] = value;
  }
  if (values["market"] === undefined || values["currency"] === undefined)
    return { valid: false, reason: "CONTEXT_REQUIRED", contextQuery };
  const parsed = giftDiscoveryQuerySchema.safeParse(input);
  if (!parsed.success) return invalid;
  return {
    valid: true,
    query: parsed.data,
    apiQuery: serializeQuery(parsed.data).toString(),
    contextQuery,
  };
}

function directoryHref(
  query: GiftDiscoveryQuery,
  basePath: string,
  contextQuery: string,
): string {
  const context = new URLSearchParams(contextQuery);
  for (const field of fields) context.delete(field);
  for (const [key, value] of serializeQuery(query)) {
    if (key !== "locale") context.set(key, value);
  }
  return storefrontHref(query.locale, basePath, context.toString());
}

export function giftPageHref(
  query: GiftDiscoveryQuery,
  basePath: string,
  contextQuery: string,
  page: number,
): string {
  return directoryHref(
    giftDiscoveryQuerySchema.parse({ ...query, page }),
    basePath,
    contextQuery,
  );
}

export function giftFilterHref(
  query: GiftDiscoveryQuery,
  basePath: string,
  contextQuery: string,
  filters: GiftFilters,
): string {
  return directoryHref(
    giftDiscoveryQuerySchema.parse({
      ...query,
      ...filters,
      category: filters.category,
      kind: filters.kind,
      priceMinMinor: filters.priceMinMinor,
      priceMaxMinor: filters.priceMaxMinor,
      page: 1,
    }),
    basePath,
    contextQuery,
  );
}

export function giftResetHref(
  query: GiftDiscoveryQuery,
  basePath: string,
  contextQuery: string,
): string {
  return giftFilterHref(query, basePath, contextQuery, {
    sort: "RECOMMENDED",
    availability: "ALL",
  });
}

function priceNotation(locale: SupportedLocale, currency: CurrencyCode) {
  const digits =
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 0;
  const number = new Intl.NumberFormat(locale, {
    useGrouping: false,
    maximumFractionDigits: 0,
  });
  const decimal = new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumFractionDigits: 1,
  })
    .formatToParts(1n)
    .find((part) => part.type === "decimal")!.value;
  return { digits, number, decimal };
}

/** Price editing uses local decimal notation, no grouping, and exact integer arithmetic. */
export function parseGiftPriceInput(
  input: string,
  locale: SupportedLocale,
  currency: CurrencyCode,
):
  | Readonly<{ valid: true; amountMinor?: MinorAmount }>
  | Readonly<{ valid: false }> {
  let value = input.normalize("NFKC").trim();
  if (value === "") return { valid: true };
  const { digits, number, decimal } = priceNotation(locale, currency);
  for (let digit = 0; digit <= 9; digit++)
    value = value.replaceAll(number.format(digit), String(digit));
  const parts = value.split(decimal);
  const whole = parts[0] ?? "";
  const fraction = parts[1] ?? "";
  if (
    parts.length > 2 ||
    !/^\d+$/u.test(whole) ||
    (parts.length === 2 && (!/^\d+$/u.test(fraction) || digits === 0)) ||
    fraction.length > digits ||
    whole.length > 16
  )
    return { valid: false };
  const amount =
    BigInt(whole) * 10n ** BigInt(digits) +
    BigInt(fraction.padEnd(digits, "0") || "0");
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return { valid: false };
  return { valid: true, amountMinor: minorAmountSchema.parse(Number(amount)) };
}

export function formatGiftPriceInput(
  amount: MinorAmount | undefined,
  locale: SupportedLocale,
  currency: CurrencyCode,
): string {
  if (amount === undefined) return "";
  const { digits, number, decimal } = priceNotation(locale, currency);
  const scale = 10n ** BigInt(digits);
  const value = BigInt(amount);
  const whole = number.format(value / scale);
  if (digits === 0) return whole;
  const fraction = (value % scale).toString().padStart(digits, "0");
  return `${whole}${decimal}${[...fraction].map((digit) => number.format(Number(digit))).join("")}`;
}
