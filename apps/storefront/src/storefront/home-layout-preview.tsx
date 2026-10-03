"use client";
import { useEffect, useState, type ComponentProps } from "react";
import { HomeContent } from "./home-content";
import { receivePreviewLayout } from "./home-layout-preview-protocol";

/** Only published content arrives from the server; the parent can change layout alone. */
export function HomeLayoutPreview({
  adminOrigin,
  channel,
  ...props
}: ComponentProps<typeof HomeContent> & {
  adminOrigin: string;
  channel: string;
}) {
  const [layout, setLayout] = useState(props.layout);
  useEffect(() => {
    if (window.parent === window) return;
    const receive = (event: MessageEvent<unknown>) => {
      const next = receivePreviewLayout(event, {
        adminOrigin,
        channel,
        parent: window.parent,
      });
      if (next) setLayout(next);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage(
      { schemaVersion: 1, type: "HOME_LAYOUT_PREVIEW_READY", channel },
      adminOrigin,
    );
    return () => window.removeEventListener("message", receive);
  }, [adminOrigin, channel]);
  return <HomeContent {...props} {...(layout ? { layout } : {})} />;
}
