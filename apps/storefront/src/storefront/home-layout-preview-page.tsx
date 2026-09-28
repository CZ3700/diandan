import "server-only";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  homeLayoutPreviewReadySchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  loadStorefrontPreviewConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import { loadStorefrontCopy } from "../server/storefront-copy";
import { readPublicHomeLayout } from "../server/public-home-layout";
import {
  readStorefrontHomepage,
  readStorefrontDirectory,
} from "./storefront-page-reads";
import { prepareDirectoryQuery } from "./directory-query";
import { HomeLayoutPreview } from "./home-layout-preview";
import { ThemePreview } from "./theme-preview";
import { HomepageDirectory } from "./homepage-directory";
import { GiftBrowseSection } from "./gift-browse-section";
import {
  StorefrontPageShell,
  type StorefrontPageProps,
} from "./storefront-page-shell";
import { PageState } from "./page-parts";
import { DetailPreviewContent } from "./detail-preview-content";

export function createHomeLayoutPreviewPage(locale: SupportedLocale) {
  return async function HomeLayoutPreviewPage({
    searchParams,
  }: StorefrontPageProps) {
    const { adminOrigin } = loadStorefrontPreviewConfig();
    const values = await searchParams;
    const query = homeLayoutPreviewReadySchema.safeParse({
      schemaVersion: 1,
      type: "HOME_LAYOUT_PREVIEW_READY",
      channel: values["channel"],
    });
    if (
      !adminOrigin ||
      !query.success ||
      Object.keys(values).some(
        (key) => !["channel", "mode", "page"].includes(key),
      ) ||
      (values["mode"] !== undefined && values["mode"] !== "theme") ||
      (values["page"] !== undefined &&
        (values["mode"] !== "theme" ||
          (values["page"] !== "home" &&
            values["page"] !== "artist" &&
            values["page"] !== "gift")))
    )
      notFound();
    if (values["page"] === "artist" || values["page"] === "gift") {
      const copy = await loadStorefrontCopy(locale);
      return (
        <StorefrontPageShell
          preview
          locale={locale}
          copy={copy}
          name={loadStorefrontPresentationConfig().name}
          active={values["page"] === "artist" ? "artists" : "gifts"}
          contextQuery=""
        >
          <ThemePreview
            adminOrigin={adminOrigin}
            channel={query.data.channel}
          />
          <DetailPreviewContent
            page={values["page"]}
            locale={locale}
            copy={copy}
          />
        </StorefrontPageShell>
      );
    }
    const directoryQuery = prepareDirectoryQuery(locale, undefined);
    const directory = readStorefrontDirectory(
      directoryQuery.query,
      directoryQuery.valid,
    );
    const [data, layout, copy] = await Promise.all([
      readStorefrontHomepage(locale),
      readPublicHomeLayout(),
      loadStorefrontCopy(locale),
    ]);
    return (
      <StorefrontPageShell
        preview
        locale={locale}
        copy={copy}
        name={loadStorefrontPresentationConfig().name}
        active="home"
        contextQuery=""
      >
        {values["mode"] === "theme" && (
          <ThemePreview
            adminOrigin={adminOrigin}
            channel={query.data.channel}
          />
        )}
        {layout.outcome === "FAILURE" ? (
          <PageState
            locale={locale}
            copy={copy}
            title={copy.contentError}
            body={copy.contentErrorBody}
          />
        ) : (
          <HomeLayoutPreview
            adminOrigin={adminOrigin}
            channel={query.data.channel}
            locale={locale}
            copy={copy}
            data={data}
            layout={layout.layout}
            contextQuery=""
            directory={
              <Suspense
                fallback={
                  <p role="status" aria-busy="true">
                    {copy.artistLoading}
                  </p>
                }
              >
                <HomepageDirectory
                  locale={locale}
                  copy={copy}
                  initial={directory}
                  contextQuery=""
                />
              </Suspense>
            }
            giftDirectory={
              <GiftBrowseSection
                locale={locale}
                copy={copy}
                values={{}}
                basePath="/"
                headingLevel={2}
                pricing={{}}
              />
            }
          />
        )}
      </StorefrontPageShell>
    );
  };
}
