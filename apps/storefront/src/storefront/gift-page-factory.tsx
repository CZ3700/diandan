import "server-only";
import { readCartRestorationHint } from "../server/cart-restoration-hint";
import "./cart.css";
import { CartProvider } from "./cart-provider";
import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  slugSchema,
  idolIdSchema,
  giftVariantIdSchema,
  policyKeySchema,
  type StorefrontContextResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  loadStorefrontRuntimeConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import { loadStorefrontCopy } from "../server/storefront-copy";
import {
  readCommerceContext,
  commerceRead,
  policyRead,
  artistRead,
} from "./gift-page-reads";
import { soleCommerceScope } from "./commerce-scope";
import { readGiftDetailPage } from "./gift-detail-page-reads";
import { SiteHeader } from "./site-header";
import { SiteFooter, PageState } from "./page-parts";
import { MarketChoices, PolicyLinks } from "./commerce-context";
import type { GiftDirectorySection } from "./gift-directory-section";
import { GiftDetail } from "./gift-detail";
import { GiftDetailPolicyLinks } from "./gift-detail-context-section";
import { PolicyBody } from "./gift-content";
import { formatStorefrontMessage } from "./copy";
import { giftRecoveryQuery } from "./gift-selection";
import { queryString } from "./navigation";
import { createStorefrontLoading } from "./route-states";
import { GiftPageSeo, loadGiftSeo } from "./gift-seo";
import { regionEntries } from "./region-entry";

type Kind = "gifts" | "gift" | "policy" | "region";
type PageDefinition =
  | [kind: Exclude<Kind, "gifts">]
  | [kind: "gifts", DirectorySection: typeof GiftDirectorySection];
type Props = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
  params: Promise<{ handle?: string }>;
}>;
export function createGiftStorefrontPage(
  locale: SupportedLocale,
  ...[kind, DirectorySection]: PageDefinition
) {
  async function Page({ searchParams, params }: Props) {
    loadStorefrontRuntimeConfig();
    const name = loadStorefrontPresentationConfig().name;
    const [values, routeParams] = await Promise.all([searchParams, params]);
    const handle =
      kind === "gift" ? slugSchema.safeParse(routeParams.handle) : undefined;
    if (handle && !handle.success) notFound();
    const contextRead = readCommerceContext().catch(
      (error: unknown): StorefrontContextResponse => {
        if (kind !== "gift" && kind !== "gifts") throw error;
        return {
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "COMMERCE_UNAVAILABLE",
        };
      },
    );
    const [copy, detail, restoreOnLoad] = await Promise.all([
      loadStorefrontCopy(locale),
      handle?.success
        ? readGiftDetailPage(locale, handle.data, values)
        : undefined,
      readCartRestorationHint(),
      kind === "gift" || kind === "gifts" ? undefined : contextRead,
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
        <DirectorySection
          locale={locale}
          copy={copy}
          values={values}
          context={contextRead}
          {...(artist ? { artist } : {})}
        />
      );
    } else if (kind === "region") {
      const context = await contextRead;
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
    } else if (kind === "policy") {
      const context = await contextRead;
      const key = policyKeySchema.safeParse(routeParams.handle);
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
      if (!detail) notFound();
      const { handle, result, scoped, artists, selection } = detail;
      const soleIdol = idolIdSchema.safeParse(values["idol"]);
      const soleVariant = giftVariantIdSchema.safeParse(values["variant"]);
      if (result.outcome === "FAILURE" && result.code === "NOT_FOUND")
        notFound();
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
            retryPath={`/gifts/${handle}`}
          />
        );
      else
        content = (
          <GiftDetail
            locale={locale}
            copy={copy}
            content={scoped?.outcome === "SUCCESS" ? scoped : result}
            {...(scoped?.outcome === "SUCCESS" ? { commerce: scoped } : {})}
            context={contextRead}
            artists={artists}
            contextQuery={contextQuery}
            {...(selection.kind === "VALID" && selection.variantId
              ? { variantId: selection.variantId }
              : selection.kind === "CONTEXT_REQUIRED" && soleVariant.success
                ? { variantId: soleVariant.data }
                : {})}
            marketError={scoped?.outcome === "FAILURE"}
            {...(selection.kind === "CONTEXT_REQUIRED"
              ? {
                  // V2 §4-2: one published market prices the page as its offer streams in.
                  soleOffer: async (resolved: StorefrontContextResponse) => {
                    const scope = soleCommerceScope(resolved);
                    if (!scope) return undefined;
                    const read = await commerceRead(
                      locale,
                      handle,
                      scope.market,
                      scope.currency,
                      soleIdol.success ? soleIdol.data : undefined,
                    ).catch(() => undefined);
                    return read?.outcome === "SUCCESS" ? read : undefined;
                  },
                }
              : {})}
          />
        );
    }
    const region = regionEntries(locale, copy, contextQuery);
    return (
      <div className="storefront" lang={locale}>
        <CartProvider
          key={locale}
          locale={locale}
          restoreOnLoad={restoreOnLoad}
        >
          <SiteHeader
            locale={locale}
            copy={copy}
            name={name}
            contextQuery={contextQuery}
            active={kind === "gifts" || kind === "gift" ? "gifts" : "other"}
            regionEntry={region.header}
          />
          <main id="main-content" tabIndex={-1}>
            <Suspense fallback={null}>
              <GiftPageSeo
                locale={locale}
                kind={kind}
                values={values}
                {...(routeParams.handle ? { handle: routeParams.handle } : {})}
              />
            </Suspense>
            {content}
          </main>
        </CartProvider>
        <SiteFooter
          locale={locale}
          copy={copy}
          name={name}
          contextQuery={contextQuery}
          region={region.footer}
          policyLinks={
            kind === "gift" || kind === "gifts" ? (
              <GiftDetailPolicyLinks
                locale={locale}
                copy={copy}
                context={contextRead}
                contextQuery={contextQuery}
              />
            ) : (
              <PolicyLinks
                locale={locale}
                copy={copy}
                context={await contextRead}
                contextQuery={contextQuery}
              />
            )
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
  return async function generateMetadata({
    params,
    searchParams,
  }: Props): Promise<Metadata> {
    return (
      await loadGiftSeo(locale, kind, (await params).handle, await searchParams)
    ).metadata;
  };
}
