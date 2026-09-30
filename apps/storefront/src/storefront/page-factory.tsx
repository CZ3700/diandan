import "server-only";
import type { Metadata } from "next";
import { BrowsePageSeo, loadBrowseSeo } from "./browse-seo";
import { Suspense } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import {
  loadStorefrontRuntimeConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import { loadStorefrontCopy } from "../server/storefront-copy";
import type { StorefrontCopy } from "./copy";
import { queryString } from "./navigation";
import { HomeContent } from "./home-content";
import { PageState } from "./page-parts";
import { readPublicHomeLayout } from "../server/public-home-layout";
import { GiftBrowseSection } from "./gift-browse-section";
import { prepareGiftBrowse } from "./gift-browse-query";
import { readGiftBrowse } from "../server/public-gift-browse";
import { HomepageDirectory } from "./homepage-directory";
import { ArtistDirectory } from "./artist-directory";
import { prepareDirectoryQuery } from "./directory-query";
import { createStorefrontLoading } from "./route-states";
import {
  readStorefrontHomepage,
  readStorefrontDirectory,
} from "./storefront-page-reads";
import {
  StorefrontPageShell,
  type StorefrontPageProps,
} from "./storefront-page-shell";

type StorefrontPageKind = "home" | "artists" | "unavailable";

export function createStorefrontPage(
  locale: SupportedLocale,
  kind: StorefrontPageKind,
) {
  async function StorefrontPage({ searchParams }: StorefrontPageProps) {
    loadStorefrontRuntimeConfig();
    const name = loadStorefrontPresentationConfig().name;
    const values = await searchParams;
    const contextQuery = queryString(values);
    const directoryQuery = prepareDirectoryQuery(locale, values["anchorId"]);
    const copyPromise = loadStorefrontCopy(locale);
    let copy: StorefrontCopy;
    let content;
    if (kind === "home") {
      const browseQuery = prepareGiftBrowse(locale, values);
      const gifts = browseQuery ? readGiftBrowse(browseQuery) : undefined;
      const homepage = readStorefrontHomepage(locale);
      const layout = readPublicHomeLayout();
      const directory = readStorefrontDirectory(
        directoryQuery.query,
        directoryQuery.valid,
      );
      const [resolvedCopy, data, layoutResult] = await Promise.all([
        copyPromise,
        homepage,
        layout,
      ]);
      copy = resolvedCopy;
      content =
        layoutResult.outcome === "FAILURE" ? (
          <PageState
            locale={locale}
            copy={copy}
            contextQuery={contextQuery}
            title={copy.contentError}
            body={copy.contentErrorBody}
          />
        ) : (
          <HomeContent
            locale={locale}
            copy={copy}
            contextQuery={contextQuery}
            data={data}
            layout={layoutResult.layout}
            giftDirectory={
              <GiftBrowseSection
                locale={locale}
                copy={copy}
                values={values}
                basePath="/"
                headingLevel={2}
                initial={gifts}
                pricing={{}}
              />
            }
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
                  contextQuery={contextQuery}
                  {...(directoryQuery.anchor
                    ? { initialAnchor: directoryQuery.anchor }
                    : {})}
                />
              </Suspense>
            }
          />
        );
    } else if (kind === "artists") {
      const [resolvedCopy, initial] = await Promise.all([
        copyPromise,
        readStorefrontDirectory(directoryQuery.query, directoryQuery.valid),
      ]);
      copy = resolvedCopy;
      content = (
        <section className="storefront-section storefront-directory">
          <div className="storefront-section-heading">
            <div>
              <p className="storefront-eyebrow">{copy.artistEyebrow}</p>
              <h1>{copy.artistTitle}</h1>
            </div>
            <p>{copy.artistBody}</p>
          </div>
          <ArtistDirectory
            headingLevel={1}
            locale={locale}
            copy={copy}
            initial={initial}
            contextQuery={contextQuery}
            {...(directoryQuery.anchor
              ? { initialAnchor: directoryQuery.anchor }
              : {})}
          />
        </section>
      );
    } else {
      copy = await copyPromise;
      content = (
        <section className="storefront-state">
          <h1>{copy.unavailableTitle}</h1>
          <p>{copy.unavailableBody}</p>
          <a
            className="storefront-primary"
            href={`/${locale}/idols${contextQuery ? `?${contextQuery}` : ""}`}
          >
            {copy.backArtists}
          </a>
        </section>
      );
    }
    return (
      <StorefrontPageShell
        locale={locale}
        copy={copy}
        name={name}
        contextQuery={contextQuery}
        active={kind === "unavailable" ? "other" : kind}
      >
        <Suspense fallback={null}>
          <BrowsePageSeo locale={locale} kind={kind} values={values} />
        </Suspense>
        {content}
      </StorefrontPageShell>
    );
  }
  if (kind === "home" || kind === "artists") {
    const Loading = createStorefrontLoading(locale);
    return function StorefrontEntry(props: StorefrontPageProps) {
      return (
        <Suspense fallback={<Loading />}>
          <StorefrontPage {...props} />
        </Suspense>
      );
    };
  }
  return StorefrontPage;
}

export function createStorefrontMetadata(
  locale: SupportedLocale,
  kind: StorefrontPageKind,
) {
  return async function generateMetadata({
    searchParams,
  }: StorefrontPageProps): Promise<Metadata> {
    return (await loadBrowseSeo(locale, kind, undefined, await searchParams))
      .metadata;
  };
}
