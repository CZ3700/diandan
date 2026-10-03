import type { ManagementCenterIntent } from "@fan-support/contracts";

type ImageIntentKind = Exclude<
  ManagementCenterIntent["kind"],
  "RESTORE_POSTER"
>;

/**
 * Framing for images published through the daily management center (user decision
 * 2026-09-27, superseding the complete-image default of SPEC §9.0): every role is filled at
 * its own display ratio, enlarging a small source instead of letterboxing it. Artist photos
 * keep the upper third, where faces usually are; gifts and posters stay centred.
 */
export function dailyManagementFraming(kind: ImageIntentKind) {
  return Object.freeze({
    fit: "COVER_ALLOW_ENLARGE" as const,
    focalPoint: Object.freeze(
      kind === "SAVE_ARTIST" ? { x: 0.5, y: 0.3 } : { x: 0.5, y: 0.5 },
    ),
  });
}
