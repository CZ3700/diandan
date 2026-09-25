import "server-only";
import type { Metadata } from "next";
import { Suspense } from "react";
import { BrowsePageSeo, loadBrowseSeo } from "./browse-seo";
import { notFound } from "next/navigation";
import { slugSchema, type SupportedLocale } from "@fan-support/contracts";
import {
  loadStorefrontRuntimeConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import { loadStorefrontCopy } from "../server/storefront-copy";
import { ArtistContent } from "./artist-content";
import { ArtistGiftDirectory } from "./artist-gift-directory";
import { PageState } from "./page-parts";
import { queryString } from "./navigation";
import { readStorefrontIdol } from "./storefront-page-reads";
import {
  StorefrontPageShell,
  type StorefrontPageProps,
} from "./storefront-page-shell";

export function createArtistStorefrontPage(locale: SupportedLocale) {
  return async function ArtistStorefrontPage({
    searchParams,
    params,
  }: StorefrontPageProps) {
    loadStorefrontRuntimeConfig();
    const name = loadStorefrontPresentationConfig().name;
    const handle = slugSchema.safeParse((await params).handle);
    if (!handle.success) notFound();
    const [copy, values, result] = await Promise.all([
      loadStorefrontCopy(locale),
      searchParams,
      readStorefrontIdol(locale, handle.data),
    ]);
    // Resolve existence before returning a shell or Suspense boundary: a flushed
    // loading state would commit HTTP 200 before Next can return this 404.
    if (result.outcome === "FAILURE" && result.code === "NOT_FOUND") notFound();
    const contextQuery = queryString(values);
    const content =
      result.outcome === "SUCCESS" && result.content.kind === "IDOL" ? (
        <ArtistContent
          gifts={
            <Suspense
              fallback={
                <section
                  className="storefront-section storefront-directory storefront-gifts"
                  id="artist-gifts"
                  aria-busy="true"
                >
                  <p role="status">{copy.loading}</p>
                </section>
              }
            >
              <ArtistGiftDirectory
                locale={locale}
                copy={copy}
                values={{ ...values, idol: result.content.view.id }}
                basePath={`/idols/${handle.data}`}
                headingLevel={2}
                artist={result.content.view}
              />
            </Suspense>
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
    return (
      <StorefrontPageShell
        locale={locale}
        copy={copy}
        name={name}
        contextQuery={contextQuery}
        active="artists"
      >
        <Suspense fallback={null}>
          <BrowsePageSeo
            locale={locale}
            kind="artist"
            handle={handle.data}
            values={values}
          />
        </Suspense>
        {content}
      </StorefrontPageShell>
    );
  };
}

export function createArtistStorefrontMetadata(locale: SupportedLocale) {
  return async function generateMetadata({
    params,
    searchParams,
  }: StorefrontPageProps): Promise<Metadata> {
    return (
      await loadBrowseSeo(
        locale,
        "artist",
        (await params).handle,
        await searchParams,
      )
    ).metadata;
  };
}
