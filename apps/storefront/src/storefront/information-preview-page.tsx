import "server-only";
import { notFound } from "next/navigation";
import {
  informationPagePreviewReadySchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  loadStorefrontPreviewConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import { loadStorefrontCopy } from "../server/storefront-copy";
import {
  StorefrontPageShell,
  type StorefrontPageProps,
} from "./storefront-page-shell";
import { InformationPreview } from "./information-preview";
import { informationPageKeyFromPath } from "./information-page-path";

export function createInformationPreviewPage(locale: SupportedLocale) {
  return async function InformationPreviewPage({
    searchParams,
  }: StorefrontPageProps) {
    const { adminOrigin } = loadStorefrontPreviewConfig();
    const values = await searchParams;
    const ready = informationPagePreviewReadySchema.safeParse({
      schemaVersion: 1,
      type: "INFORMATION_PAGE_PREVIEW_READY",
      channel: values["channel"],
    });
    const pageKey = informationPageKeyFromPath(values["page"]);
    if (
      !adminOrigin ||
      !ready.success ||
      !pageKey ||
      Object.keys(values).some((key) => !["channel", "page"].includes(key))
    )
      notFound();
    const copy = await loadStorefrontCopy(locale);
    return (
      <StorefrontPageShell
        preview
        locale={locale}
        copy={copy}
        name={loadStorefrontPresentationConfig().name}
        active="other"
        contextQuery=""
      >
        <InformationPreview
          key={ready.data.channel}
          adminOrigin={adminOrigin}
          channel={ready.data.channel}
          locale={locale}
          pageKey={pageKey}
          waiting={copy.loading}
        />
      </StorefrontPageShell>
    );
  };
}
