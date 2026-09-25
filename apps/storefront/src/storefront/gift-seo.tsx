import "server-only";
import { cache } from "react";
import {
  SUPPORTED_LOCALES,
  slugSchema,
  policyKeySchema,
  type SupportedLocale,
  type PublishedMediaView,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "../server/storefront-copy";
import {
  loadStorefrontRuntimeConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import { readSeoEntity } from "../server/storefront-seo";
import {
  policyRead,
  giftDirectoryRead,
  readCommerceContext,
} from "./gift-page-reads";
import { readSelectedGiftContent } from "./gift-content-read";
import { parseGiftSelection, selectGiftOffer } from "./gift-selection";
import { prepareGiftQuery } from "./gift-query";
import { isMarketAvailable } from "./commerce-context";
import { createSeoIdentity, type SeoSearchValues } from "./seo-identity";
import { buildSeoMetadata, provenSeoLocales } from "./seo-metadata";
import {
  createProductJsonLd,
  createPageJsonLd,
  JsonLd,
} from "./seo-structured-data";
import { formatStorefrontMessage } from "./copy";

type Kind = "gift" | "gifts" | "policy" | "region";
const load = cache(
  async (
    locale: SupportedLocale,
    kind: Kind,
    rawHandle: string | undefined,
    query: string,
  ) => {
    const values = JSON.parse(query) as SeoSearchValues;
    const identity = createSeoIdentity(locale, kind, rawHandle, values);
    const origin = loadStorefrontRuntimeConfig().siteOrigin;
    const siteName = loadStorefrontPresentationConfig().name;
    const copy = await loadStorefrontCopy(locale);
    let title = kind === "region" ? copy.marketChoose : copy.giftTitle,
      description = copy.giftBody;
    let image: PublishedMediaView | undefined;
    let locales: readonly SupportedLocale[] = [],
      product: ReturnType<typeof createProductJsonLd> = null;
    let indexable = !identity.noindex;
    const url = new URL(identity.canonicalPath, origin).href;
    if (kind === "gift") {
      const handle = slugSchema.safeParse(rawHandle);
      if (handle.success) {
        const selection = parseGiftSelection(values);
        const [{ result: content, scoped }, entity] = await Promise.all([
          readSelectedGiftContent(locale, handle.data, selection),
          readSeoEntity({ kind: "GIFT", handle: handle.data }),
        ]);
        if (content.outcome === "SUCCESS") {
          const gift = content.content.view;
          title = gift.seoTitle;
          description = gift.seoDescription;
          image = gift.primaryMedia;
          locales = provenSeoLocales(
            entity,
            content.publication,
            gift.localeContext,
          );
          if (selection.kind === "INVALID_QUERY") indexable = false;
          if (selection.kind === "VALID") {
            if (scoped?.outcome === "SUCCESS" && locales.includes(locale)) {
              const offer = selectGiftOffer(scoped.offers, selection.variantId);
              if (
                !offer ||
                (scoped.recipient.kind === "PUBLISHED" &&
                  scoped.recipient.idol.localeContext.fallbackUsed)
              )
                indexable = false;
              if (indexable && offer)
                product = createProductJsonLd({
                  url,
                  gift: scoped.content.view,
                  offer,
                  currency: scoped.currency,
                });
            } else indexable = false;
          } else if (indexable && locales.includes(locale))
            product = createProductJsonLd({ url, gift });
        } else indexable = false;
      } else indexable = false;
    } else if (kind === "policy") {
      const key = policyKeySchema.safeParse(rawHandle);
      if (key.success) {
        const [content, entity] = await Promise.all([
          policyRead(locale, key.data),
          readSeoEntity({ kind: "POLICY", policyKey: key.data }),
        ]);
        if (
          content.outcome === "SUCCESS" &&
          content.content.kind === "POLICY"
        ) {
          title = content.content.view.title;
          description = content.content.view.summary;
          locales = provenSeoLocales(
            entity,
            content.publication,
            content.content.view.localeContext,
          );
        }
      }
    } else if (kind === "gifts") {
      const prepared = prepareGiftQuery(locale, values);
      if (
        prepared.valid &&
        isMarketAvailable(
          await readCommerceContext(),
          prepared.query.market,
          prepared.query.currency,
        )
      ) {
        const directory = await giftDirectoryRead(prepared.apiQuery);
        if (
          directory.outcome === "SUCCESS" &&
          directory.items.length > 0 &&
          directory.items.every((item) => !item.gift.localeContext.fallbackUsed)
        ) {
          // The directory requires whole-revision seven-language proof; UI-copy completeness has its own release gate.
          locales = SUPPORTED_LOCALES;
          image = directory.items[0]?.gift.primaryMedia;
          if (prepared.query.page > 1)
            title += ` · ${formatStorefrontMessage(copy, "giftPaginationPage", locale, { page: prepared.query.page, total: directory.pageInfo.totalPages })}`;
        }
      }
    }
    indexable = indexable && locales.includes(locale);
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
          locale,
          siteName,
          title,
          description,
          kind: kind === "gifts" ? "CollectionPage" : "WebPage",
          breadcrumbs: [
            { name: copy.navHome, url: new URL(`/${locale}`, origin).href },
            ...(kind === "gift"
              ? [
                  {
                    name: copy.navGifts,
                    url: new URL(`/${locale}/gifts`, origin).href,
                  },
                ]
              : []),
            { name: title, url },
          ],
        })
      : null;
    return { metadata, product: indexable ? product : null, page };
  },
);

export function loadGiftSeo(
  locale: SupportedLocale,
  kind: Kind,
  handle: string | undefined,
  values: SeoSearchValues,
) {
  return load(locale, kind, handle, JSON.stringify(values));
}
export async function GiftPageSeo(
  props: Readonly<{
    locale: SupportedLocale;
    kind: Kind;
    handle?: string;
    values: SeoSearchValues;
  }>,
) {
  const result = await loadGiftSeo(
    props.locale,
    props.kind,
    props.handle,
    props.values,
  );
  return (
    <>
      <JsonLd data={result.page} />
      <JsonLd data={result.product} />
    </>
  );
}
