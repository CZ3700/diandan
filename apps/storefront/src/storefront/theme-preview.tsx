"use client";
import { useEffect } from "react";
import { createDefaultStorefrontTheme } from "@fan-support/contracts";
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
      ...Object.keys(storefrontThemeAttributes(createDefaultStorefrontTheme())),
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
      const attributes = Object.entries(storefrontThemeAttributes(theme));
      const changed = attributes.some(
        ([key, value]) => root.getAttribute(key) !== value,
      );
      for (const [key, value] of attributes) root.setAttribute(key, value);
      root.setAttribute("data-theme-source", "PREVIEW");
      root.setAttribute("data-theme-status", "AVAILABLE");
      root.removeAttribute("data-theme-version");
      // A draft arrives after SSR. Replay only the CSS hero entrance under its
      // new settings; NONE/reduced motion have no CSS animations to replay.
      if (changed) {
        for (const element of root.querySelectorAll(
          "[data-home-hero] .storefront-hero-copy h1, [data-home-hero] .storefront-hero-copy > .storefront-primary",
        )) {
          for (const animation of element.getAnimations()) {
            animation.cancel();
            animation.play();
          }
        }
      }
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
