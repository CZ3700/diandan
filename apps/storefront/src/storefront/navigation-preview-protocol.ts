import {
  storefrontNavigationPreviewMessageSchema,
  type StorefrontNavigation,
} from "@fan-support/contracts";

export function receivePreviewNavigation(
  event: Readonly<{ origin: string; source: unknown; data: unknown }>,
  context: Readonly<{ adminOrigin: string; channel: string; parent: unknown }>,
): StorefrontNavigation | null {
  if (event.origin !== context.adminOrigin || event.source !== context.parent)
    return null;
  const message = storefrontNavigationPreviewMessageSchema.safeParse(
    event.data,
  );
  return message.success && message.data.channel === context.channel
    ? message.data.navigation
    : null;
}
