import "server-only";
import { PolicyLinks } from "./commerce-context";
import { GiftDirectorySection } from "./gift-directory-section";
import { readCommerceContext } from "./gift-page-reads";
import { hasFallback } from "./content-safety";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { slugSchema, type SupportedLocale } from "@fan-support/contracts";
import {
  loadStorefrontRuntimeConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import { readPublicCatalog } from "../server/public-catalog";
import { loadStorefrontCopy } from "../server/storefront-copy";
import { queryString } from "./navigation";
import { SiteHeader } from "./site-header";
import { SiteFooter, PageState } from "./page-parts";
import { HomeContent } from "./home-content";
import { ArtistDirectory } from "./artist-directory";
import { ArtistContent } from "./artist-content";
import { prepareDirectoryQuery } from "./directory-query";
import { createStorefrontLoading } from "./route-states";

type Props = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
  params: Promise<{ handle?: string }>;
}>;
const homepage = cache((locale: SupportedLocale) =>
  readPublicCatalog(
    "/api/v1/storefront-homepage",
    new URLSearchParams({ locale }),
    "homepage",
  ),
);
const idol = cache((locale: SupportedLocale, handle: string) =>
  readPublicCatalog(
    `/api/v1/idols/${encodeURIComponent(handle)}`,
    new URLSearchParams({ locale }),
    "content",
  ),
);
const directoryRead = cache((query: string, valid: boolean) => {
  if (valid)
    return readPublicCatalog(
      "/api/v1/idols",
      new URLSearchParams(query),
      "directory",
    );
  return Promise.resolve({
    schemaVersion: 1 as const,
    outcome: "FAILURE" as const,
    code: "INVALID_QUERY" as const,
  });
});
type StorefrontPageKind = "home" | "artists" | "artist" | "unavailable";
function activeNavigation(kind: StorefrontPageKind) {
  if (kind === "home") return "home";
  if (kind === "artist" || kind === "artists") return "artists";
  return "other";
}
export function createStorefrontPage(
  locale: SupportedLocale,
  kind: StorefrontPageKind,
) {
  async function StorefrontPage({ searchParams, params }: Props) {
    loadStorefrontRuntimeConfig();
    const name = loadStorefrontPresentationConfig().name;
    const copy = await loadStorefrontCopy(locale);
    const values = await searchParams;
    const contextQuery = queryString(values);
    const directoryQuery = prepareDirectoryQuery(locale, values["anchorId"]);
    let content;
    if (kind === "home")
      content = (
        <HomeContent
          locale={locale}
          copy={copy}
          contextQuery={contextQuery}
          data={await homepage(locale)}
          directory={await directoryRead(
            directoryQuery.query,
            directoryQuery.valid,
          )}
          {...(directoryQuery.anchor
            ? { initialAnchor: directoryQuery.anchor }
            : {})}
        />
      );
    else if (kind === "artists") {
      const initial = await directoryRead(
        directoryQuery.query,
        directoryQuery.valid,
      );
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
    } else if (kind === "artist") {
      const handle = slugSchema.safeParse((await params).handle);
      if (!handle.success) notFound();
      const result = await idol(locale, handle.data);
      if (result.outcome === "FAILURE" && result.code === "NOT_FOUND")
        notFound();
      content =
        result.outcome === "SUCCESS" && result.content.kind === "IDOL" ? (
          <ArtistContent
            gifts={
              <GiftDirectorySection
                locale={locale}
                copy={copy}
                values={{ ...values, idol: result.content.view.id }}
                context={await readCommerceContext()}
                basePath={`/idols/${handle.data}`}
                headingLevel={2}
                artist={result.content.view}
              />
            }
            artist={result.content.view}
            locale={locale}
            copy={copy}
            contextQuery={contextQuery}
          />
        ) : (
          <PageState
            copy={copy}
            locale={locale}
            title={copy.contentError}
            body={copy.contentErrorBody}
            contextQuery={contextQuery}
            retryPath={`/idols/${handle.data}`}
          />
        );
    } else
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
    return (
      <div className="storefront" lang={locale}>
        <SiteHeader
          locale={locale}
          copy={copy}
          name={name}
          contextQuery={contextQuery}
          active={activeNavigation(kind)}
        />
        <main id="main-content" tabIndex={-1}>
          {content}
        </main>
        <SiteFooter
          policyLinks={
            <PolicyLinks
              locale={locale}
              copy={copy}
              context={await readCommerceContext()}
              contextQuery={contextQuery}
            />
          }
          locale={locale}
          copy={copy}
          name={name}
          contextQuery={contextQuery}
        />
      </div>
    );
  }
  // Entry pages can stream their loading UI. A detail must resolve existence
  // before any body is flushed, otherwise Next commits 200 before notFound().
  if (kind === "home" || kind === "artists") {
    const Loading = createStorefrontLoading(locale);
    return function StorefrontEntry(props: Props) {
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
    params,
    searchParams,
  }: Props): Promise<Metadata> {
    const copy = await loadStorefrontCopy(locale);
    let title = copy.artistTitle,
      description = copy.artistBody,
      noindex = kind === "unavailable";
    if (kind === "home") {
      const result = await homepage(locale);
      if (result.outcome === "SUCCESS") {
        title = result.homepage.content.view.seoTitle;
        description = result.homepage.content.view.seoDescription;
        noindex = hasFallback([
          result.homepage.content.view.localeContext,
          ...result.slots.flatMap((slot) =>
            slot.status === "AVAILABLE"
              ? [slot.content.content.view.localeContext]
              : [],
          ),
        ]);
      } else noindex = true;
    }
    if (kind === "artist") {
      const handle = slugSchema.safeParse((await params).handle);
      if (handle.success) {
        const result = await idol(locale, handle.data);
        if (result.outcome === "SUCCESS" && result.content.kind === "IDOL") {
          title = result.content.view.seoTitle;
          description = result.content.view.seoDescription;
          noindex = result.content.view.localeContext.fallbackUsed;
        } else noindex = true;
      } else noindex = true;
    }
    if (kind === "artists" || kind === "home") {
      const values = await searchParams;
      const query = prepareDirectoryQuery(locale, values["anchorId"]);
      const result = await directoryRead(query.query, query.valid);
      if (result.outcome === "FAILURE") noindex = true;
    }
    // Human copy and asset approval are a separate release gate; local fixture pages stay unindexed.
    const tier = process.env["FAN_SUPPORT_DEPLOYMENT_ENV"];
    return {
      title,
      description,
      robots: { index: !noindex && tier === "production", follow: true },
    };
  };
}
