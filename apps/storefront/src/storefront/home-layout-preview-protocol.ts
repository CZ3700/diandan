import {
  homeLayoutPreviewMessageSchema,
  type HomeLayout,
} from "@fan-support/contracts";

export function receivePreviewLayout(
  event: Readonly<{ origin: string; source: unknown; data: unknown }>,
  expected: Readonly<{ adminOrigin: string; parent: unknown; channel: string }>,
): HomeLayout | null {
  if (event.origin !== expected.adminOrigin || event.source !== expected.parent)
    return null;
  const parsed = homeLayoutPreviewMessageSchema.safeParse(event.data);
  return parsed.success && parsed.data.channel === expected.channel
    ? parsed.data.layout
    : null;
}
