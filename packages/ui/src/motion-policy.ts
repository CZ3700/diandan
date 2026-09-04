import type { CompositeMedia } from "./composite-types.js";

export type MotionMode = "instant" | "opacity" | "spatial";

export type IdolSwitchState = Readonly<{
  activeId: string;
  mode: MotionMode;
  outgoingId: string | null;
  phase: "prepare" | "settled";
  revision: number;
}>;

export type IdolSwitchItem = Readonly<{
  description: string;
  id: string;
  media: CompositeMedia;
  name: string;
}>;

export function mediaPresentationReady({
  fallbackVisible,
  imageComplete,
  imageNaturalWidth,
}: Readonly<{
  fallbackVisible: boolean;
  imageComplete: boolean;
  imageNaturalWidth: number;
}>): boolean {
  return (
    fallbackVisible ||
    (imageComplete &&
      Number.isFinite(imageNaturalWidth) &&
      imageNaturalWidth > 0)
  );
}

export function mediaPresentationSettleReady({
  decodeOutcome,
  fallbackVisible,
  imageComplete,
  imageNaturalWidth,
  imageUnchanged,
}: Readonly<{
  decodeOutcome: "failed" | "not-required" | "succeeded";
  fallbackVisible: boolean;
  imageComplete: boolean;
  imageNaturalWidth: number;
  imageUnchanged: boolean;
}>): boolean {
  return (
    fallbackVisible ||
    (decodeOutcome !== "failed" &&
      imageUnchanged &&
      mediaPresentationReady({
        fallbackVisible: false,
        imageComplete,
        imageNaturalWidth,
      }))
  );
}

export function nextIdolSwitchState(
  current: IdolSwitchState,
  nextId: string,
  mode: MotionMode,
): IdolSwitchState {
  if (current.activeId === nextId) {
    return current;
  }
  const revision = current.revision + 1;
  if (current.phase === "prepare" && current.outgoingId === nextId) {
    return {
      activeId: nextId,
      mode: "instant",
      outgoingId: null,
      phase: "settled",
      revision,
    };
  }
  const presentedId =
    current.phase === "prepare" && current.outgoingId !== null
      ? current.outgoingId
      : current.activeId;
  return {
    activeId: nextId,
    mode,
    outgoingId: presentedId,
    phase: "prepare",
    revision,
  };
}

export function motionModeForActivation({
  clickDetail,
  pointerType,
  reduced,
}: Readonly<{
  clickDetail: number;
  pointerType: string | undefined;
  reduced: boolean;
}>): MotionMode {
  if (reduced || clickDetail <= 0) {
    return "instant";
  }
  if (pointerType === "mouse") {
    return "spatial";
  }
  if (pointerType === "pen" || pointerType === "touch") {
    return "opacity";
  }
  return "instant";
}

function requireCopy(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`Idol switch ${label} must be non-empty.`);
  }
}

export function validateIdolSwitchItems(
  items: readonly IdolSwitchItem[],
  initialId: string,
): void {
  if (items.length < 2) {
    throw new TypeError("Idol switch requires at least two items.");
  }
  requireCopy(initialId, "initial id");

  const ids = new Set<string>();
  for (const item of items) {
    requireCopy(item.id, "id");
    requireCopy(item.name, "name");
    requireCopy(item.description, "description");
    if (ids.has(item.id)) {
      throw new TypeError("Idol switch item ids must be unique.");
    }
    ids.add(item.id);
  }

  if (!ids.has(initialId)) {
    throw new TypeError("Idol switch initial id must identify an item.");
  }
}
