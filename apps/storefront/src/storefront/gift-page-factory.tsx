import "server-only";
import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  slugSchema,
  idolIdSchema,
  policyKeySchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  loadStorefrontRuntimeConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import { loadStorefrontCopy } from "../server/storefront-copy";
import {
  readCommerceContext,
  giftRead,
  policyRead,
  artistRead,
  commerceRead,
  giftDirectoryRead,
} from "./gift-page-reads";
import { SiteHeader } from "./site-header";
import { SiteFooter, PageState } from "./page-parts";
import {
  MarketChoices,
  PolicyLinks,
  isMarketAvailable,
} from "./commerce-context";
import { GiftDirectorySection } from "./gift-directory-section";
import { GiftDetail } from "./gift-detail";
import { PolicyBody } from "./gift-content";
import { formatStorefrontMessage } from "./copy";
import {
  parseGiftSelection,
  giftRecoveryQuery,
  giftCanonicalPath,
} from "./gift-selection";
import { prepareGiftQuery } from "./gift-query";
import { queryString } from "./navigation";
import { createStorefrontLoading } from "./route-states";

type Kind = "gifts" | "gift" | "policy" | "region";
type Props = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
  params: Promise<{ handle?: string }>;
}>;
export function createGiftStorefrontPage(locale: SupportedLocale, kind: Kind) {
  async function Page({ searchParams, params }: Props) {
    loadStorefrontRuntimeConfig();
    const name = loadStorefrontPresentationConfig().name;
    const [copy, values, context] = await Promise.all([
      loadStorefrontCopy(locale),
      searchParams,
      readCommerceContext(),
    ]);
    const contextQuery = queryString(values);
    let content: ReactNode;
    if (kind === "gifts") {
      const selectedId = idolIdSchema.safeParse(values["idol"]);
      const directory = selectedId.success
        ? await artistRead(locale, selectedId.data)
        : undefined;
      const artist =
        directory?.outcome === "SUCCESS" && selectedId.success
          ? directory.items.find(
              (item) => item.id.toLowerCase() === selectedId.data.toLowerCase(),
            )
          : undefined;
      content = (
        <GiftDirectorySection
          locale={locale}
          copy={copy}
          values={values}
          context={context}
          {...(artist ? { artist } : {})}
        />
      );
    } else if (kind === "region")
      content = (
        <div className="storefront-section storefront-directory">
          <MarketChoices
            locale={locale}
            copy={copy}
            context={context}
            contextQuery={contextQuery}
            headingLevel={1}
          />
        </div>
      );
    else if (kind === "policy") {
      const key = policyKeySchema.safeParse((await params).handle);
      if (!key.success) notFound();
      const result = await policyRead(locale, key.data);
      if (result.outcome === "FAILURE" && result.code === "NOT_FOUND")
        notFound();
      if (
        result.outcome !== "SUCCESS" ||
        result.content.kind !== "POLICY" ||
        result.content.view.localeContext.fallbackUsed ||
        result.content.view.policyKey !== key.data
      )
        content = (
          <PageState
            locale={locale}
            copy={copy}
            title={copy.policyUnavailable}
            body={copy.contentErrorBody}
            contextQuery={contextQuery}
            retryPath={`/policies/${key.data}`}
          />
        );
      else {
        const policy = result.content.view;
        const date = new Intl.DateTimeFormat(locale, {
          dateStyle: "long",
          timeZone: "UTC",
        }).format(new Date(policy.effectiveAt));
        content = (
          <article
            className="gift-policy"
            data-policy={policy.policyKey}
            lang={policy.localeContext.resolvedLocale}
          >
            <h1 id="gift-policy-title">{policy.title}</h1>
            <p className="gift-policy-summary">{policy.summary}</p>
            <time dateTime={policy.effectiveAt}>
              {formatStorefrontMessage(copy, "policyEffective", locale, {
                date,
              })}
            </time>
            <PolicyBody body={policy.body} />
            <PolicyLinks
              labelledBy="gift-policy-title"
              locale={locale}
              copy={copy}
              context={context}
              contextQuery={contextQuery}
            />
          </article>
        );
      }
    } else {
      const handle = slugSchema.safeParse((await params).handle);
      if (!handle.success) notFound();
      const result = await giftRead(locale, handle.data);
      if (result.outcome === "FAILURE" && result.code === "NOT_FOUND")
        notFound();
      const selection = parseGiftSelection(values);
      const scoped =
        selection.kind === "VALID"
          ? await commerceRead(
              locale,
              handle.data,
              selection.market,
              selection.currency,
              selection.idolId,
            )
          : undefined;
      if (scoped?.outcome === "FAILURE" && scoped.code === "NOT_FOUND")
        notFound();
      if (
        result.outcome !== "SUCCESS" ||
        selection.kind === "INVALID_QUERY" ||
        (scoped?.outcome === "FAILURE" && scoped.code !== "MARKET_UNAVAILABLE")
      )
        content = (
          <PageState
            locale={locale}
            copy={copy}
            title={copy.contentError}
            body={
              selection.kind === "INVALID_QUERY"
                ? copy.marketInvalid
                : copy.contentErrorBody
            }
            contextQuery={
              selection.kind === "INVALID_QUERY"
                ? giftRecoveryQuery(contextQuery)
                : contextQuery
            }
            retryPath={`/gifts/${handle.data}`}
          />
        );
      else
        content = (
          <GiftDetail
            locale={locale}
            copy={copy}
            content={scoped?.outcome === "SUCCESS" ? scoped : result}
            {...(scoped?.outcome === "SUCCESS" ? { commerce: scoped } : {})}
            context={context}
            artists={await artistRead(
              locale,
              typeof values["idol"] === "string" ? values["idol"] : undefined,
            )}
            contextQuery={contextQuery}
            {...(selection.kind === "VALID" && selection.variantId
              ? { variantId: selection.variantId }
              : {})}
            marketError={scoped?.outcome === "FAILURE"}
          />
        );
    }
    return (
      <div className="storefront" lang={locale}>
        <SiteHeader
          locale={locale}
          copy={copy}
          name={name}
          contextQuery={contextQuery}
          active={kind === "gifts" || kind === "gift" ? "gifts" : "other"}
        />
        <main id="main-content" tabIndex={-1}>
          {content}
        </main>
        <SiteFooter
          locale={locale}
          copy={copy}
          name={name}
          contextQuery={contextQuery}
          policyLinks={
            <PolicyLinks
              locale={locale}
              copy={copy}
              context={context}
              contextQuery={contextQuery}
            />
          }
        />
      </div>
    );
  }
  if (kind === "gifts" || kind === "region") {
    const Loading = createStorefrontLoading(locale);
    return function Entry(props: Props) {
      return (
        <Suspense fallback={<Loading />}>
          <Page {...props} />
        </Suspense>
      );
    };
  }
  return Page;
}

export function createGiftStorefrontMetadata(
  locale: SupportedLocale,
  kind: Kind,
) {
  return async ({ searchParams, params }: Props): Promise<Metadata> => {
    const [copy, values] = await Promise.all([
      loadStorefrontCopy(locale),
      searchParams,
    ]);
    const query = queryString(values);
    const rawHandle = (await params).handle;
    let title = kind === "region" ? copy.marketChoose : copy.giftTitle,
      description = copy.giftBody,
      noindex = kind === "region";
    let path = kind === "region" ? "/region" : "/gifts";
    if (kind === "gift") {
      const handle = slugSchema.safeParse(rawHandle);
      if (handle.success) {
        path = `/gifts/${handle.data}`;
        const result = await giftRead(locale, handle.data);
        if (result.outcome === "SUCCESS") {
          title = result.content.view.seoTitle;
          description = result.content.view.seoDescription;
          noindex = result.content.view.localeContext.fallbackUsed;
        } else noindex = true;
        const selection = parseGiftSelection(values);
        if (selection.kind !== "VALID") noindex = true;
        else {
          const scoped = await commerceRead(
            locale,
            handle.data,
            selection.market,
            selection.currency,
            selection.idolId,
          );
          const selectedVariantId = selection.variantId;
          if (
            scoped.outcome !== "SUCCESS" ||
            scoped.content.view.localeContext.fallbackUsed ||
            (scoped.recipient.kind === "PUBLISHED" &&
              scoped.recipient.idol.localeContext.fallbackUsed) ||
            (selectedVariantId &&
              !scoped.offers.some(
                (offer) =>
                  offer.giftVariantId.toLowerCase() ===
                  selectedVariantId.toLowerCase(),
              ))
          )
            noindex = true;
        }
      } else noindex = true;
    } else if (kind === "policy") {
      const key = policyKeySchema.safeParse(rawHandle);
      if (key.success) {
        path = `/policies/${key.data}`;
        const result = await policyRead(locale, key.data);
        if (result.outcome === "SUCCESS" && result.content.kind === "POLICY") {
          title = result.content.view.title;
          description = result.content.view.summary;
          noindex = result.content.view.localeContext.fallbackUsed;
        } else noindex = true;
      } else noindex = true;
    } else if (kind === "gifts") {
      const prepared = prepareGiftQuery(locale, values);
      if (!prepared.valid) noindex = true;
      else {
        const context = await readCommerceContext();
        if (
          !isMarketAvailable(
            context,
            prepared.query.market,
            prepared.query.currency,
          )
        )
          noindex = true;
        else {
          const result = await giftDirectoryRead(prepared.apiQuery);
          noindex =
            result.outcome !== "SUCCESS" ||
            result.items.some((item) => item.gift.localeContext.fallbackUsed) ||
            result.items.length === 0;
        }
        if (
          prepared.query.sort !== "RECOMMENDED" ||
          prepared.query.category ||
          prepared.query.availability !== "ALL" ||
          prepared.query.priceMinMinor !== undefined ||
          prepared.query.priceMaxMinor !== undefined ||
          prepared.query.idolId
        )
          noindex = true;
      }
    }
    return {
      title,
      description,
      alternates: {
        canonical: new URL(
          giftCanonicalPath(locale, path, query),
          loadStorefrontRuntimeConfig().siteOrigin,
        ).href,
      },
      robots: {
        index:
          !noindex &&
          process.env["FAN_SUPPORT_DEPLOYMENT_ENV"] === "production",
        follow: true,
      },
    };
  };
}
