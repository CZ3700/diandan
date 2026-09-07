import { idolIdSchema, type SupportedLocale } from "@fan-support/contracts";
export function prepareDirectoryQuery(
  locale: SupportedLocale,
  value: string | string[] | undefined,
): Readonly<{ valid: boolean; query: string; anchor?: string }> {
  const query = new URLSearchParams({ locale });
  if (value === undefined) return { valid: true, query: query.toString() };
  const parsed = idolIdSchema.safeParse(value);
  if (!parsed.success) return { valid: false, query: query.toString() };
  query.set("anchorId", parsed.data);
  return { valid: true, query: query.toString(), anchor: parsed.data };
}

export function directoryContextQuery(query: string, anchor?: string): string {
  const context = new URLSearchParams(query);
  context.delete("q");
  context.delete("after");
  context.delete("anchorId");
  if (anchor !== undefined) context.set("anchorId", idolIdSchema.parse(anchor));
  return context.toString();
}
