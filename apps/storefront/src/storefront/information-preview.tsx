"use client";
import { useEffect, useState } from "react";
import type {
  InformationPageKey,
  InformationPagePreviewDocument,
  SupportedLocale,
} from "@fan-support/contracts";
import { receiveInformationPreview } from "./information-preview-protocol";
import { InformationPageBody } from "./information-page-body";

export function InformationPreview({
  adminOrigin,
  channel,
  pageKey,
  locale,
  waiting,
}: {
  adminOrigin: string;
  channel: string;
  pageKey: InformationPageKey;
  locale: SupportedLocale;
  waiting: string;
}) {
  const [document, setDocument] =
    useState<InformationPagePreviewDocument | null>(null);
  useEffect(() => {
    if (window.parent === window) return;
    const receive = (event: MessageEvent<unknown>) => {
      const next = receiveInformationPreview(event, {
        adminOrigin,
        channel,
        pageKey,
        locale,
        parent: window.parent,
      });
      if (next) setDocument(next);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage(
      { schemaVersion: 1, type: "INFORMATION_PAGE_PREVIEW_READY", channel },
      adminOrigin,
    );
    return () => window.removeEventListener("message", receive);
  }, [adminOrigin, channel, pageKey, locale]);
  return document ? (
    <InformationPageBody document={document} expandedQuestions />
  ) : (
    <p className="information-page" role="status" aria-busy="true">
      {waiting}
    </p>
  );
}
