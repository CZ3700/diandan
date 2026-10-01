import {
  storefrontBrandPreviewMessageSchema,
  type StorefrontBrandView,
} from "@fan-support/contracts";

export function receivePreviewBrand(
  event: Readonly<{ origin: string; source: unknown; data: unknown }>,
  context: Readonly<{ adminOrigin: string; channel: string; parent: unknown }>,
): StorefrontBrandView | null {
  if (event.origin !== context.adminOrigin || event.source !== context.parent)
    return null;
  const message = storefrontBrandPreviewMessageSchema.safeParse(event.data);
  return message.success && message.data.channel === context.channel
    ? message.data.brand
    : null;
}
