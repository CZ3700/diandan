import "server-only";
import { cache } from "react";
import {
  SUPPORTED_LOCALES,
  currencySchema,
  marketSchema,
  slugSchema,
  type PublishedMediaView,
  type SupportedLocale,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "../server/storefront-copy";
import {
  loadStorefrontRuntimeConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import { readSeoEntity } from "../server/storefront-seo";
import {
  readStorefrontHomepage,
  readStorefrontIdol,
  readStorefrontDirectory,
  readCommerceContext,
} from "./storefront-page-reads";
import { prepareDirectoryQuery } from "./directory-query";
import { hasFallback } from "./content-safety";
import { isMarketAvailable } from "./commerce-context";
import { createSeoIdentity, type SeoSearchValues } from "./seo-identity";
import { readSoleCommerceScope } from "./sole-scope-read";
import { buildSeoMetadata, provenSeoLocales } from "./seo-metadata";
import { createPageJsonLd, JsonLd } from "./seo-structured-data";

type Kind = "home" | "artists" | "artist" | "unavailable";
const load = cache(
  async (
    locale: SupportedLocale,
    kind: Kind,
    handle: string | undefined,
    query: string,
  ) => {
    const values = JSON.parse(query) as SeoSearchValues;
    // Only an artist URL can carry a market; drop it from the canonical when it is the sole one.
    const implicitScope =
      kind === "artist" &&
      (values["market"] !== undefined || values["currency"] !== undefined)
        ? await readSoleCommerceScope()
        : undefined;
    const identity = createSeoIdentity(
      locale,
      kind,
      handle,
      values,
      implicitScope,
    );
    const origin = loadStorefrontRuntimeConfig().siteOrigin,
      siteName = loadStorefrontPresentationConfig().name;
    const copy = await loadStorefrontCopy(locale);
    let title = copy.artistTitle,
      description = copy.artistBody;
    let locales: readonly SupportedLocale[] = [],
      image: PublishedMediaView | undefined;
    let person: { name: string; image: string } | undefined;
    let indexable = !identity.noindex;
    if (kind === "home" || kind === "artists") {
      const prepared = prepareDirectoryQuery(locale, values["anchorId"]);
      const [directory, home, entity] = await Promise.all([
        readStorefrontDirectory(prepared.query, prepared.valid),
        kind === "home" ? readStorefrontHomepage(locale) : undefined,
        kind === "home" ? readSeoEntity({ kind: "HOMEPAGE" }) : undefined,
      ]);
      if (directory.outcome !== "SUCCESS") indexable = false;
      else if (kind === "artists") {
        locales = SUPPORTED_LOCALES;
        image = directory.items[0]?.portrait;
      }
      if (home?.outcome === "SUCCESS") {
        const content = home.homepage.content.view;
        title = content.seoTitle;
        description = content.seoDescription;
        image = content.heroDesktop;
        locales = provenSeoLocales(
          entity,
          home.homepage.publication,
          content.localeContext,
        );
        if (
          hasFallback([
            content.localeContext,
            ...home.slots.flatMap((slot) =>
              slot.status === "AVAILABLE"
                ? [slot.content.content.view.localeContext]
                : [],
            ),
          ])
        )
          indexable = false;
      } else if (kind === "home") indexable = false;
    } else if (kind === "artist") {
      if (values["market"] !== undefined || values["currency"] !== undefined) {
        const market = marketSchema.safeParse(values["market"]);
        const currency = currencySchema.safeParse(values["currency"]);
        if (
          !market.success ||
          !currency.success ||
          !isMarketAvailable(
            await readCommerceContext(),
            market.data,
            currency.data,
          )
        )
          indexable = false;
      }
      const parsed = slugSchema.safeParse(handle);
      if (parsed.success) {
        const [content, entity] = await Promise.all([
          readStorefrontIdol(locale, parsed.data),
          readSeoEntity({ kind: "IDOL", handle: parsed.data }),
        ]);
        if (content.outcome === "SUCCESS" && content.content.kind === "IDOL") {
          const artist = content.content.view;
          title = artist.seoTitle;
          description = artist.seoDescription;
          image = artist.heroDesktop;
          person = { name: artist.displayName, image: artist.portrait.url };
          locales = provenSeoLocales(
            entity,
            content.publication,
            artist.localeContext,
          );
        }
      }
    }
    indexable = indexable && locales.includes(locale);
    const url = new URL(identity.canonicalPath, origin).href;
    const metadata = buildSeoMetadata({
      origin,
      siteName,
      locale,
      identity,
      title,
      description,
      availableLocales: locales,
      indexable,
      production: process.env["FAN_SUPPORT_DEPLOYMENT_ENV"] === "production",
      ...(image ? { image } : {}),
    });
    const page = indexable
      ? createPageJsonLd({
          url,
          origin,
          siteName,
          locale,
          title,
          description,
          kind:
            kind === "artists"
              ? "CollectionPage"
              : kind === "artist"
                ? "ProfilePage"
                : "WebPage",
          ...(person ? { person } : {}),
          breadcrumbs: [
            { name: copy.navHome, url: new URL(`/${locale}`, origin).href },
            ...(kind === "artist"
              ? [
                  {
                    name: copy.navArtists,
                    url: new URL(`/${locale}/idols`, origin).href,
                  },
                ]
              : []),
            ...(kind !== "home" ? [{ name: title, url }] : []),
          ],
        })
      : null;
    return { metadata, page };
  },
);
export function loadBrowseSeo(
  locale: SupportedLocale,
  kind: Kind,
  handle: string | undefined,
  values: SeoSearchValues,
) {
  return load(locale, kind, handle, JSON.stringify(values));
}
export async function BrowsePageSeo(
  props: Readonly<{
    locale: SupportedLocale;
    kind: Kind;
    handle?: string;
    values: SeoSearchValues;
  }>,
) {
  return (
    <JsonLd
      data={
        (
          await loadBrowseSeo(
            props.locale,
            props.kind,
            props.handle,
            props.values,
          )
        ).page
      }
    />
  );
}
