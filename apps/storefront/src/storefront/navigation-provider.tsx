"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  createDefaultStorefrontNavigation,
  type PublicStorefrontNavigationResponse,
  type StorefrontNavigation,
} from "@fan-support/contracts";
import { receivePreviewNavigation } from "./navigation-preview-protocol";

export type NavigationPreviewOptions = Readonly<{
  adminOrigin: string;
  channel: string;
  view: "header" | "menu" | "footer";
}>;
type NavigationContext = Readonly<{
  navigation: StorefrontNavigation;
  source: "DEFAULT" | "PUBLISHED" | "FALLBACK" | "PREVIEW";
  version: number | undefined;
  previewView?: NavigationPreviewOptions["view"] | undefined;
}>;
const context = createContext<NavigationContext>({
  navigation: createDefaultStorefrontNavigation(),
  source: "DEFAULT",
  version: 0,
});
export const useStorefrontNavigation = () => useContext(context);

/** The same SSR configuration drives every link; only a sandboxed preview accepts a draft. */
export function NavigationProvider({
  result,
  preview,
  children,
}: Readonly<{
  result: PublicStorefrontNavigationResponse;
  preview?: NavigationPreviewOptions | undefined;
  children: ReactNode;
}>) {
  const [draft, setDraft] = useState<StorefrontNavigation | null>(null);
  useEffect(() => {
    if (!preview || window.parent === window) return;
    const receive = (event: MessageEvent<unknown>) => {
      const navigation = receivePreviewNavigation(event, {
        ...preview,
        parent: window.parent,
      });
      if (navigation) setDraft(navigation);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage(
      {
        schemaVersion: 1,
        type: "STOREFRONT_NAVIGATION_PREVIEW_READY",
        channel: preview.channel,
      },
      preview.adminOrigin,
    );
    return () => window.removeEventListener("message", receive);
  }, [preview]);
  useEffect(() => {
    if (!preview) return;
    const destination =
      preview.view === "footer"
        ? document.querySelector(".storefront-footer")
        : document.querySelector(".storefront-header");
    const position = () => {
      const top =
        preview.view === "footer" && destination
          ? Math.max(
              0,
              window.scrollY +
                destination.getBoundingClientRect().bottom -
                window.innerHeight,
            )
          : 0;
      // scrollIntoView also moves the outer management page across iframe boundaries.
      window.scrollTo({ top, behavior: "instant" });
    };
    position();
    if (preview.view !== "footer") return;
    // Streamed directories can move the footer after the first preview paint.
    const observer = new ResizeObserver(position);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [draft, preview]);
  let value: NavigationContext = {
    navigation: createDefaultStorefrontNavigation(),
    source: "FALLBACK",
    version: undefined,
    previewView: preview?.view,
  };
  if (result.outcome === "SUCCESS")
    value = {
      ...value,
      navigation: result.navigation,
      source: result.source,
      version: result.version,
    };
  if (draft)
    value = {
      ...value,
      navigation: draft,
      source: "PREVIEW",
      version: undefined,
    };
  return <context.Provider value={value}>{children}</context.Provider>;
}
