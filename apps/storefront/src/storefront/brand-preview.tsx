"use client";
import { useEffect } from "react";
import { useStorefrontBrand } from "./branding-provider";
import { receivePreviewBrand } from "./brand-preview-protocol";

/** Only the sandboxed, inert document accepts this independently versioned brand draft. */
export function BrandPreview({
  adminOrigin,
  channel,
}: Readonly<{ adminOrigin: string; channel: string }>) {
  const { setPreview } = useStorefrontBrand();
  useEffect(() => {
    if (window.parent === window) return;
    const receive = (event: MessageEvent<unknown>) => {
      const brand = receivePreviewBrand(event, {
        adminOrigin,
        channel,
        parent: window.parent,
      });
      if (brand) setPreview(brand);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage(
      { schemaVersion: 1, type: "STOREFRONT_BRAND_PREVIEW_READY", channel },
      adminOrigin,
    );
    return () => {
      window.removeEventListener("message", receive);
      setPreview(null);
    };
  }, [adminOrigin, channel, setPreview]);
  return null;
}
