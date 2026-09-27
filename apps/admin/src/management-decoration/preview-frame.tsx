"use client";
import { useEffect, useRef, useState } from "react";
import {
  homeLayoutPreviewReadySchema,
  type HomeLayout,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { DecorationCopy } from "./copy";

export function LayoutPreviewFrame({
  layout,
  locale,
  origin,
  copy,
}: {
  layout: HomeLayout;
  locale: SupportedLocale;
  origin: string | undefined;
  copy: DecorationCopy;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [viewport, setViewport] = useState<"mobile" | "desktop">("mobile");
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const dimensions =
    viewport === "mobile"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 };
  const scale = width ? Math.min(1, width / dimensions.width) : 1;
  useEffect(() => {
    setChannel(crypto.randomUUID());
  }, [locale, origin]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () => setWidth(element.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [origin, channel]);
  useEffect(() => {
    setReady(false);
    setFailed(false);
    if (!origin || !channel) return;
    const timer = setTimeout(() => setFailed(true), 30_000);
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      const message = homeLayoutPreviewReadySchema.safeParse(event.data);
      if (!message.success || message.data.channel !== channel) return;
      clearTimeout(timer);
      setReady(true);
      setFailed(false);
    };
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
  }, [origin, channel]);
  useEffect(() => {
    if (ready && origin && channel)
      frame.current?.contentWindow?.postMessage(
        { schemaVersion: 1, type: "HOME_LAYOUT_PREVIEW", channel, layout },
        origin,
      );
  }, [ready, origin, channel, layout]);
  return (
    <section
      className="decoration-preview"
      aria-labelledby="decoration-preview-title"
    >
      <div className="decoration-preview-heading">
        <h2 id="decoration-preview-title">{copy.preview}</h2>
        <div className="decoration-preview-switch" aria-label={copy.preview}>
          {(["mobile", "desktop"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={viewport === value}
              onClick={() => setViewport(value)}
            >
              {copy[value]}
            </button>
          ))}
        </div>
      </div>
      <p className="mc-hint">{copy.previewHint}</p>
      {!origin ? (
        <p role="status">{copy.previewUnavailable}</p>
      ) : (
        <>
          {!ready && (
            <p role={failed ? "alert" : "status"}>
              {failed ? copy.previewFailed : copy.loading}
              {failed && (
                <Button
                  variant="quiet"
                  onClick={() => setChannel(crypto.randomUUID())}
                >
                  {copy.reload}
                </Button>
              )}
            </p>
          )}
          <div
            ref={container}
            className="decoration-preview-viewport"
            data-preview-viewport={viewport}
            style={{ height: dimensions.height * scale }}
          >
            {channel && (
              <iframe
                ref={frame}
                key={channel}
                data-layout-preview-frame
                title={`${copy.preview} — ${copy[viewport]}`}
                src={`${origin}/${locale}/layout-preview?channel=${channel}`}
                sandbox="allow-scripts allow-same-origin"
                referrerPolicy="no-referrer"
                style={{
                  width: dimensions.width,
                  height: dimensions.height,
                  transform: `scale(${scale})`,
                }}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
