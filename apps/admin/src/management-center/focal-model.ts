import type {
  ManagementOriginalImage,
  MediaFramingRequest,
} from "@fan-support/contracts";

export type MediaFocalPoint = MediaFramingRequest["focalPoint"];
export type PhotoEdit = {
  focalPoint: MediaFocalPoint;
  currentImage?: ManagementOriginalImage["currentImage"];
};
export type OriginalPreview = {
  url: string;
  width: number;
  height: number;
};
const normalized = (value: number) =>
  Math.round(Math.max(0, Math.min(1, value)) * 100000) / 100000;
export function sameFocus(left: MediaFocalPoint, right: MediaFocalPoint) {
  return left.x === right.x && left.y === right.y;
}
export function focusAtPointer(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
): MediaFocalPoint {
  return {
    x: normalized((x - rect.left) / rect.width),
    y: normalized((y - rect.top) / rect.height),
  };
}
export function focusFromKey(
  point: MediaFocalPoint,
  key: string,
  coarse: boolean,
): MediaFocalPoint | null {
  const step = coarse ? 0.1 : 0.01;
  switch (key) {
    case "ArrowLeft":
      return { ...point, x: normalized(point.x - step) };
    case "ArrowRight":
      return { ...point, x: normalized(point.x + step) };
    case "ArrowUp":
      return { ...point, y: normalized(point.y - step) };
    case "ArrowDown":
      return { ...point, y: normalized(point.y + step) };
    default:
      return null;
  }
}
