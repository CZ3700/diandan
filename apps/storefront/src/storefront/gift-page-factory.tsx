import "server-only";
import { readPublicStorefrontNavigation } from "../server/public-storefront-navigation";
import { NavigationProvider } from "./navigation-provider";
import { readCartRestorationHint } from "../server/cart-restoration-hint";
import "./cart.css";
import { CartProvider } from "./cart-provider";
import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  slugSchema,
  idolIdSchema,
  policyKeySchema,
  type StorefrontContextResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  loadStorefrontRuntimeConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import { loadStorefrontCopy } from "../server/storefront-copy";
import { readCommerceContext, policyRead, artistRead } from "./gift-page-reads";
import { readGiftDetailPage } from "./gift-detail-page-reads";
import { SiteHeader } from "./site-header";
import { SiteFooter, PageState } from "./page-parts";
import { MarketChoices, PolicyLinks } from "./commerce-context";
import type { GiftDirectorySection } from "./gift-directory-section";
import { giftDetailBody } from "./gift-detail-body";
import { GiftDetailPolicyLinks } from "./gift-detail-context-section";
import { PolicyBody } from "./gift-content";
import { formatStorefrontMessage } from "./copy";
import { queryString } from "./navigation";
import { createStorefrontLoading } from "./route-states";
import { GiftPageSeo, loadGiftSeo } from "./gift-seo";
import { regionEntries } from "./region-entry";
import { publicNavigationQuery } from "./navigation-target";
import { InformationPageFooter } from "./information-page-footer";

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
    const [copy, detail, restoreOnLoad, navigation] = await Promise.all([
      loadStorefrontCopy(locale),
      handle?.success
        ? readGiftDetailPage(locale, handle.data, values)
        : undefined,
      readCartRestorationHint(),
      readPublicStorefrontNavigation(),
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
      if (
        detail.result.outcome === "FAILURE" &&
        detail.result.code === "NOT_FOUND"
      )
        notFound();
      if (
        detail.scoped?.outcome === "FAILURE" &&
        detail.scoped.code === "NOT_FOUND"
      )
        notFound();
      content = giftDetailBody({
        locale,
        copy,
        detail,
        values,
        context: contextRead,
      });
    }
    const region = regionEntries(locale, copy, contextQuery);
    return (
      <NavigationProvider result={navigation}>
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
                  {...(routeParams.handle
                    ? { handle: routeParams.handle }
                    : {})}
                />
              </Suspense>
              {content}
            </main>
          </CartProvider>
          <SiteFooter
            locale={locale}
            copy={copy}
            name={name}
            contextQuery={publicNavigationQuery(contextQuery)}
            region={region.footer}
            // Lazy server elements handed to the client footer carry keys (see region-entry).
            informationLinks={
              <Suspense key="information-links" fallback={null}>
                <InformationPageFooter
                  locale={locale}
                  contextQuery={contextQuery}
                />
              </Suspense>
            }
            policyLinks={
              kind === "gift" || kind === "gifts" ? (
                <GiftDetailPolicyLinks
                  key="policy-links"
                  locale={locale}
                  copy={copy}
                  context={contextRead}
                  contextQuery={publicNavigationQuery(contextQuery)}
                />
              ) : (
                <PolicyLinks
                  key="policy-links"
                  locale={locale}
                  copy={copy}
                  context={await contextRead}
                  contextQuery={publicNavigationQuery(contextQuery)}
                />
              )
            }
          />
        </div>
      </NavigationProvider>
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
