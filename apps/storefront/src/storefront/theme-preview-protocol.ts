import {
  storefrontThemePreviewMessageSchema,
  type StorefrontTheme,
} from "@fan-support/contracts";

export function receivePreviewTheme(
  event: Readonly<{ origin: string; source: unknown; data: unknown }>,
  context: Readonly<{ adminOrigin: string; channel: string; parent: unknown }>,
): StorefrontTheme | null {
  if (event.origin !== context.adminOrigin || event.source !== context.parent)
    return null;
  const message = storefrontThemePreviewMessageSchema.safeParse(event.data);
  return message.success && message.data.channel === context.channel
    ? message.data.theme
    : null;
}
