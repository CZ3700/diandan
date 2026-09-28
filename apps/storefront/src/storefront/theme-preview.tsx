"use client";
import { useEffect } from "react";
import { storefrontThemeAttributes } from "@fan-support/design-tokens";
import { receivePreviewTheme } from "./theme-preview-protocol";

/** Only the sandboxed preview document adopts a parent draft; it never persists it. */
export function ThemePreview({
  adminOrigin,
  channel,
}: {
  adminOrigin: string;
  channel: string;
}) {
  useEffect(() => {
    if (window.parent === window) return;
    const root = document.documentElement;
    const keys = [
      "data-storefront-palette",
      "data-storefront-typography",
      "data-storefront-density",
      "data-storefront-corners",
      "data-theme-source",
      "data-theme-status",
      "data-theme-version",
    ];
    const original = keys.map((key) => [key, root.getAttribute(key)] as const);
    const receive = (event: MessageEvent<unknown>) => {
      const theme = receivePreviewTheme(event, {
        adminOrigin,
        channel,
        parent: window.parent,
      });
      if (!theme) return;
      for (const [key, value] of Object.entries(
        storefrontThemeAttributes(theme),
      ))
        root.setAttribute(key, value);
      root.setAttribute("data-theme-source", "PREVIEW");
      root.setAttribute("data-theme-status", "AVAILABLE");
      root.removeAttribute("data-theme-version");
    };
    window.addEventListener("message", receive);
    window.parent.postMessage(
      { schemaVersion: 1, type: "STOREFRONT_THEME_PREVIEW_READY", channel },
      adminOrigin,
    );
    return () => {
      window.removeEventListener("message", receive);
      for (const [key, value] of original) {
        if (value === null) root.removeAttribute(key);
        else root.setAttribute(key, value);
      }
    };
  }, [adminOrigin, channel]);
  return null;
}
