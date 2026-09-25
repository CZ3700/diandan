import {
  idolIdSchema,
  type IdolId,
  type SupportedLocale,
} from "@fan-support/contracts";
export function prepareDirectoryQuery(
  locale: SupportedLocale,
  value: string | string[] | undefined,
): Readonly<{ valid: boolean; query: string; anchor?: IdolId }> {
  const query = new URLSearchParams({ locale });
  if (value === undefined) return { valid: true, query: query.toString() };
  const parsed = idolIdSchema.safeParse(value);
  if (!parsed.success) return { valid: false, query: query.toString() };
  query.set("anchorId", parsed.data);
  return { valid: true, query: query.toString(), anchor: parsed.data };
}

export { directoryContextQuery } from "./directory-model";
