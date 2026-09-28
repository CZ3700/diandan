import {
  informationPagePreviewMessageSchema,
  type InformationPageKey,
  type InformationPagePreviewDocument,
  type SupportedLocale,
} from "@fan-support/contracts";

export function receiveInformationPreview(
  event: Readonly<{ origin: string; source: unknown; data: unknown }>,
  context: Readonly<{
    adminOrigin: string;
    channel: string;
    parent: unknown;
    pageKey: InformationPageKey;
    locale: SupportedLocale;
  }>,
): InformationPagePreviewDocument | null {
  if (event.origin !== context.adminOrigin || event.source !== context.parent)
    return null;
  const result = informationPagePreviewMessageSchema.safeParse(event.data);
  return result.success &&
    result.data.channel === context.channel &&
    result.data.document.pageKey === context.pageKey &&
    result.data.document.locale === context.locale
    ? result.data.document
    : null;
}
