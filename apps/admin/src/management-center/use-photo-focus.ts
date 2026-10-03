"use client";
import { useEffect, useRef, useState } from "react";
import type { DailyManagementImageKind } from "@fan-support/contracts";
import { dailyManagementFraming } from "@fan-support/content/media-framing";
import type { OriginalImage } from "./api";
import {
  sameFocus,
  type MediaFocalPoint,
  type OriginalPreview,
  type PhotoEdit,
} from "./focal-model";
import { measureImage } from "./image-size";
import { downloadOriginal } from "./original-download";
import { AdminClientError } from "../workspace/client";

/** Decodes one source at a time and releases its private bytes when replaced or closed. */
export function usePhotoFocus({
  file,
  kind,
  loadOriginal,
  onImageEdit,
}: {
  file: File | null;
  kind: DailyManagementImageKind;
  loadOriginal?: (() => Promise<OriginalImage>) | undefined;
  onImageEdit?: ((edit: PhotoEdit | null) => void) | undefined;
}) {
  const defaults = dailyManagementFraming(kind).focalPoint;
  const [preview, setPreview] = useState<string | null>(null);
  const [original, setOriginal] = useState<OriginalImage | null>(null);
  const [decoded, setDecoded] = useState<OriginalPreview | null>(null);
  const [point, setPoint] = useState<MediaFocalPoint>(defaults);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<unknown>(null);
  const sourceRequest = useRef<AbortController | null>(null);
  const sourceUrl = useRef<string | null>(null);
  function clearSource() {
    sourceRequest.current?.abort();
    if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current);
    sourceUrl.current = null;
  }
  useEffect(() => {
    clearSource();
    setOriginal(null);
    setDecoded(null);
    setPreview(null);
    setPoint(defaults);
    setSourceError(null);
    if (!file) {
      setSourceLoading(false);
      return;
    }
    let active = true;
    setSourceLoading(true);
    const url = URL.createObjectURL(file);
    sourceUrl.current = url;
    setPreview(url);
    void measureImage(file).then((size) => {
      if (!active) return;
      if (size) setDecoded({ url, ...size });
      else setSourceError(new AdminClientError("INVALID_RESPONSE"));
      setSourceLoading(false);
    });
    return () => {
      active = false;
      clearSource();
    };
    // Kind is stable within an editor; changing a file resets its focus.
  }, [file, kind]);
  useEffect(() => () => clearSource(), []);
  async function readOriginal() {
    if (file || !loadOriginal || sourceLoading) return;
    clearSource();
    const controller = new AbortController();
    sourceRequest.current = controller;
    setSourceLoading(true);
    setSourceError(null);
    try {
      const image = await loadOriginal();
      if (controller.signal.aborted) return;
      const blob = await downloadOriginal(image, controller.signal);
      const size = await measureImage(blob);
      if (controller.signal.aborted) return;
      if (
        !size ||
        size.width !== image.sourceWidth ||
        size.height !== image.sourceHeight
      )
        throw new AdminClientError("INVALID_RESPONSE");
      const url = URL.createObjectURL(blob);
      sourceUrl.current = url;
      setOriginal(image);
      setDecoded({ url, ...size });
      setPoint(image.focalPoint);
    } catch (failure) {
      if (!controller.signal.aborted) setSourceError(failure);
    } finally {
      if (!controller.signal.aborted) setSourceLoading(false);
    }
  }
  function changeFocus(next: MediaFocalPoint) {
    if (!decoded || (!file && !original)) return;
    setPoint(next);
    const initial = file ? defaults : original!.focalPoint;
    onImageEdit?.(
      sameFocus(next, initial)
        ? null
        : {
            focalPoint: next,
            ...(!file && original
              ? { currentImage: original.currentImage }
              : {}),
          },
    );
  }
  return {
    preview,
    decoded,
    point,
    sourceLoading,
    sourceError,
    readOriginal,
    changeFocus,
    resetFocus: () => changeFocus(file ? defaults : original!.focalPoint),
  };
}
