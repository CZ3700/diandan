"use client";
import { useEffect, useRef, useState } from "react";
import {
  homeLayoutPreviewReadySchema,
  storefrontBrandPreviewReadySchema,
  createDefaultStorefrontTheme,
  type StorefrontBrandView,
  informationPagePreviewReadySchema,
  type InformationPagePreviewDocument,
  storefrontThemePreviewReadySchema,
  storefrontNavigationPreviewReadySchema,
  type StorefrontNavigation,
  type StorefrontTheme,
  type HomeLayout,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { DecorationCopy } from "./copy";
import type { ThemeCopy } from "./theme-copy";
import type { InformationCopy } from "../management-info-pages/copy";
import type { NavigationCopy } from "./navigation-copy";
import type { BrandCopy } from "./brand-copy";

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
export function NavigationPreviewFrame({
  navigation,
  viewCopy,
  ...props
}: PreviewFrameProps & {
  navigation: StorefrontNavigation;
  viewCopy: NavigationCopy["previewViews"];
}) {
  return (
    <DecorationPreviewFrame
      {...props}
      configuration={{ mode: "navigation", navigation }}
      viewCopy={viewCopy}
    />
  );
}
export function BrandPreviewFrame({
  brand,
  copy,
  ...props
}: Omit<PreviewFrameProps, "copy"> & {
  brand: StorefrontBrandView;
  copy: BrandCopy;
}) {
  return (
    <DecorationPreviewFrame
      {...props}
      copy={copy}
      configuration={{ mode: "brand", brand }}
      brandCopy={copy}
    />
  );
}
export function InformationPreviewFrame({
  document,
  copy,
  ...props
}: PreviewFrameProps & {
  document: InformationPagePreviewDocument | null;
  copy: InformationCopy;
}) {
  return (
    <div className="info-preview">
      {!document && (
        <p className="mc-hint" data-info-preview-saved>
          {copy.savedOnly}
        </p>
      )}
      {document ? (
        <DecorationPreviewFrame
          key={`${document.pageKey}:${document.locale}`}
          {...props}
          copy={{ ...copy, previewHint: copy.savedOnly }}
          configuration={{ mode: "information", document }}
        />
      ) : (
        <p role="status">{copy.previewMissing}</p>
      )}
    </div>
  );
}
function DecorationPreviewFrame({
  configuration,
  locale,
  origin,
  copy,
  replayLabel,
  pageCopy,
  viewCopy,
  brandCopy,
}: PreviewFrameProps & {
  configuration:
    | { mode: "layout"; layout: HomeLayout }
    | { mode: "theme"; theme: StorefrontTheme }
    | { mode: "navigation"; navigation: StorefrontNavigation }
    | { mode: "brand"; brand: StorefrontBrandView }
    | { mode: "information"; document: InformationPagePreviewDocument };
  replayLabel?: string | undefined;
  pageCopy?: ThemeCopy["previewPages"] | undefined;
  viewCopy?: NavigationCopy["previewViews"] | undefined;
  brandCopy?: BrandCopy | undefined;
}) {
  const mode = configuration.mode;
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [navigation, setNavigation] = useState<{
    channel: string | null;
    page: "home" | "artist" | "gift";
    view: "header" | "menu" | "footer";
  }>({ channel: null, page: "home", view: "header" });
  const { channel, page, view } = navigation;
  const [viewport, setViewport] = useState<"mobile" | "desktop">("mobile");
  const [width, setWidth] = useState(0);
  const [readyChannel, setReadyChannel] = useState<string | null>(null);
  const ready = channel !== null && readyChannel === channel;
  const [failed, setFailed] = useState(false);
  const [scheme, setScheme] = useState<"light" | "dark">("dark");
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
  if (mode === "navigation") {
    previewQuery.set("mode", "navigation");
    if (view !== "header") previewQuery.set("view", view);
  }
  if (mode === "brand") previewQuery.set("mode", "brand");
  if (mode === "information")
    previewQuery.set("page", configuration.document.pageKey.toLowerCase());
  const previewPath =
    configuration.mode === "information"
      ? `${configuration.document.locale}/information-preview`
      : `${locale}/layout-preview`;
  function restart(nextPage = page, nextView = view) {
    setReadyChannel(null);
    setFailed(false);
    setNavigation({
      page: nextPage,
      view: nextView,
      channel: crypto.randomUUID(),
    });
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
    const acknowledgments = new Set<string>();
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      const readySchemas = {
        layout: homeLayoutPreviewReadySchema,
        theme: storefrontThemePreviewReadySchema,
        navigation: storefrontNavigationPreviewReadySchema,
        information: informationPagePreviewReadySchema,
        brand: storefrontBrandPreviewReadySchema,
      };
      if (mode === "brand") {
        const brandReady = storefrontBrandPreviewReadySchema.safeParse(
          event.data,
        );
        const themeReady = storefrontThemePreviewReadySchema.safeParse(
          event.data,
        );
        if (brandReady.success && brandReady.data.channel === channel)
          acknowledgments.add("brand");
        if (themeReady.success && themeReady.data.channel === channel)
          acknowledgments.add("theme");
        if (acknowledgments.size !== 2) return;
        clearTimeout(timer);
        setReadyChannel(channel);
        setFailed(false);
        return;
      }
      const message = readySchemas[mode].safeParse(event.data);
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
    if (!ready || !origin || !channel) return;
    const envelope = { schemaVersion: 1, channel };
    let message;
    switch (configuration.mode) {
      case "layout":
        message = {
          ...envelope,
          type: "HOME_LAYOUT_PREVIEW",
          layout: configuration.layout,
        };
        break;
      case "theme":
        message = {
          ...envelope,
          type: "STOREFRONT_THEME_PREVIEW",
          theme: configuration.theme,
        };
        break;
      case "information":
        message = {
          ...envelope,
          type: "INFORMATION_PAGE_PREVIEW_RENDER",
          document: configuration.document,
        };
        break;
      case "navigation":
        message = {
          ...envelope,
          type: "STOREFRONT_NAVIGATION_PREVIEW",
          navigation: configuration.navigation,
        };
        break;
      case "brand":
        message = {
          ...envelope,
          type: "STOREFRONT_BRAND_PREVIEW",
          brand: configuration.brand,
        };
        break;
    }
    frame.current?.contentWindow?.postMessage(message, origin);
    if (configuration.mode === "brand")
      frame.current?.contentWindow?.postMessage(
        {
          ...envelope,
          type: "STOREFRONT_THEME_PREVIEW",
          theme: {
            ...createDefaultStorefrontTheme(),
            palette: scheme === "light" ? "IVORY_GOLD" : "BLACK_GOLD",
          },
        },
        origin,
      );
  }, [ready, origin, channel, configuration, scheme]);
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
      {mode === "brand" && brandCopy && (
        <label className="decoration-preview-page">
          <span>{brandCopy.previewScheme}</span>
          <select
            data-brand-preview-scheme
            value={scheme}
            disabled={!origin}
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (next === "light" || next === "dark") setScheme(next);
            }}
          >
            <option value="light">{brandCopy.light}</option>
            <option value="dark">{brandCopy.dark}</option>
          </select>
        </label>
      )}
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
      {mode === "navigation" && viewCopy && (
        <label className="decoration-preview-page">
          <span>{viewCopy.label}</span>
          <select
            data-navigation-preview-view
            value={view}
            disabled={!origin}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "header" || value === "menu" || value === "footer")
                restart(page, value);
            }}
          >
            {Object.entries(viewCopy.options).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
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
                data-info-preview-frame={mode === "information" || undefined}
                data-layout-preview-frame={mode === "layout" || undefined}
                data-theme-preview-frame={mode === "theme" || undefined}
                data-brand-preview-frame={mode === "brand" || undefined}
                data-navigation-preview-frame={
                  mode === "navigation" || undefined
                }
                title={`${copy.preview}${mode === "theme" && pageCopy ? ` — ${pageCopy.options[page]}` : ""}${mode === "navigation" && viewCopy ? ` — ${viewCopy.options[view]}` : ""} — ${copy[viewport]}`}
                src={`${origin}/${previewPath}?${previewQuery}`}
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
