"use client";
import { useEffect, useRef, useState } from "react";
import {
  homeLayoutPreviewReadySchema,
  storefrontThemePreviewReadySchema,
  type StorefrontTheme,
  type HomeLayout,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { DecorationCopy } from "./copy";
import type { ThemeCopy } from "./theme-copy";

type PreviewFrameProps = {
  locale: SupportedLocale;
  origin: string | undefined;
  copy: Omit<DecorationCopy, "sections">;
};
export function LayoutPreviewFrame({
  layout,
  ...props
}: PreviewFrameProps & { layout: HomeLayout }) {
  return (
    <DecorationPreviewFrame
      {...props}
      configuration={{ mode: "layout", layout }}
    />
  );
}
export function ThemePreviewFrame({
  theme,
  replayLabel,
  pageCopy,
  ...props
}: PreviewFrameProps & {
  theme: StorefrontTheme;
  replayLabel?: string | undefined;
  pageCopy?: ThemeCopy["previewPages"] | undefined;
}) {
  return (
    <DecorationPreviewFrame
      {...props}
      configuration={{ mode: "theme", theme }}
      replayLabel={replayLabel}
      pageCopy={pageCopy}
    />
  );
}
function DecorationPreviewFrame({
  configuration,
  locale,
  origin,
  copy,
  replayLabel,
  pageCopy,
}: PreviewFrameProps & {
  configuration:
    | { mode: "layout"; layout: HomeLayout }
    | { mode: "theme"; theme: StorefrontTheme };
  replayLabel?: string | undefined;
  pageCopy?: ThemeCopy["previewPages"] | undefined;
}) {
  const mode = configuration.mode;
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [navigation, setNavigation] = useState<{
    channel: string | null;
    page: "home" | "artist" | "gift";
  }>({ channel: null, page: "home" });
  const { channel, page } = navigation;
  const [viewport, setViewport] = useState<"mobile" | "desktop">("mobile");
  const [width, setWidth] = useState(0);
  const [readyChannel, setReadyChannel] = useState<string | null>(null);
  const ready = channel !== null && readyChannel === channel;
  const [failed, setFailed] = useState(false);
  const dimensions =
    viewport === "mobile"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 };
  const scale = width ? Math.min(1, width / dimensions.width) : 1;
  const previewQuery = new URLSearchParams();
  if (channel) previewQuery.set("channel", channel);
  if (mode === "theme") {
    previewQuery.set("mode", "theme");
    if (page !== "home") previewQuery.set("page", page);
  }
  function restart(nextPage = page) {
    setReadyChannel(null);
    setFailed(false);
    setNavigation({ page: nextPage, channel: crypto.randomUUID() });
  }
  useEffect(() => {
    setNavigation((current) => ({ ...current, channel: crypto.randomUUID() }));
  }, [locale, origin]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () => setWidth(element.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [origin, channel, mode]);
  useEffect(() => {
    setReadyChannel(null);
    setFailed(false);
    if (!origin || !channel) return;
    const timer = setTimeout(() => setFailed(true), 30_000);
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      const message = (
        mode === "layout"
          ? homeLayoutPreviewReadySchema
          : storefrontThemePreviewReadySchema
      ).safeParse(event.data);
      if (!message.success || message.data.channel !== channel) return;
      clearTimeout(timer);
      setReadyChannel(channel);
      setFailed(false);
    };
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
  }, [origin, channel, mode]);
  useEffect(() => {
    if (ready && origin && channel)
      frame.current?.contentWindow?.postMessage(
        configuration.mode === "layout"
          ? {
              schemaVersion: 1,
              type: "HOME_LAYOUT_PREVIEW",
              channel,
              layout: configuration.layout,
            }
          : {
              schemaVersion: 1,
              type: "STOREFRONT_THEME_PREVIEW",
              channel,
              theme: configuration.theme,
            },
        origin,
      );
  }, [ready, origin, channel, configuration]);
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
      {mode === "theme" && pageCopy && (
        <>
          <label className="decoration-preview-page">
            <span>{pageCopy.label}</span>
            <select
              data-theme-preview-page
              value={page}
              disabled={!origin}
              aria-describedby="theme-preview-sample"
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === "home" || value === "artist" || value === "gift")
                  restart(value);
              }}
            >
              {Object.entries(pageCopy.options).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p
            className="mc-hint"
            id="theme-preview-sample"
            data-theme-preview-sample
          >
            {pageCopy.sampleHint}
          </p>
        </>
      )}
      {mode === "theme" && origin && replayLabel && (
        <Button
          type="button"
          variant="quiet"
          data-theme-preview-replay
          disabled={!channel}
          onClick={() => restart()}
        >
          {replayLabel}
        </Button>
      )}
      {!origin ? (
        <p role="status">{copy.previewUnavailable}</p>
      ) : (
        <>
          {!ready && (
            <p role={failed ? "alert" : "status"}>
              {failed ? copy.previewFailed : copy.loading}
              {failed && (
                <Button variant="quiet" onClick={() => restart()}>
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
                data-layout-preview-frame={mode === "layout" || undefined}
                data-theme-preview-frame={mode === "theme" || undefined}
                title={`${copy.preview}${mode === "theme" && pageCopy ? ` — ${pageCopy.options[page]}` : ""} — ${copy[viewport]}`}
                src={`${origin}/${locale}/layout-preview?${previewQuery}`}
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
