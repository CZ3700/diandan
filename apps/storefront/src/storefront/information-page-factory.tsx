import "server-only";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type {
  InformationPageKey,
  SupportedLocale,
} from "@fan-support/contracts";
import { readPublicInformationPage } from "../server/public-information-pages";
import { loadStorefrontCopy } from "../server/storefront-copy";
import {
  loadStorefrontRuntimeConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import { InformationPageBody } from "./information-page-body";
import {
  StorefrontPageShell,
  type StorefrontPageProps,
} from "./storefront-page-shell";
import { informationPagePath } from "./information-page-path";
import { buildSeoMetadata } from "./seo-metadata";
import { publicNavigationQuery } from "./navigation-target";
import { queryString } from "./navigation";

export function createInformationPage(
  locale: SupportedLocale,
  pageKey: InformationPageKey,
) {
  async function Page({ searchParams }: StorefrontPageProps) {
    const result = await readPublicInformationPage(pageKey, locale);
    if (result.outcome === "FAILURE") {
      if (result.code === "NOT_FOUND") notFound();
      // An outage between the proxy preflight and this snapshot must not render a successful empty page.
      throw new Error("Information page unavailable");
    }
    const copy = await loadStorefrontCopy(locale);
    return (
      <StorefrontPageShell
        locale={locale}
        copy={copy}
        name={loadStorefrontPresentationConfig().name}
        contextQuery={publicNavigationQuery(queryString(await searchParams))}
        active="other"
      >
        {result.fallbackUsed && (
          <p className="storefront-announcement">{copy.fallbackNotice}</p>
        )}
        <InformationPageBody document={result.document} />
      </StorefrontPageShell>
    );
  }
  async function generateMetadata({
    searchParams,
  }: StorefrontPageProps): Promise<Metadata> {
    const result = await readPublicInformationPage(pageKey, locale);
    if (result.outcome !== "SUCCESS")
      return { robots: { index: false, follow: false } };
    const config = loadStorefrontRuntimeConfig();
    const values = await searchParams;
    return buildSeoMetadata({
      origin: config.siteOrigin,
      siteName: loadStorefrontPresentationConfig().name,
      locale: result.resolvedLocale,
      identity: {
        canonicalPath: informationPagePath(locale, pageKey),
        noindex:
          Object.values(values).some((value) => value !== undefined) ||
          result.fallbackUsed,
      },
      title: result.document.fields.title,
      description:
        result.document.fields.summary ||
        result.document.fields.sections[0]?.body.slice(0, 300) ||
        "",
      availableLocales: result.availableLocales,
      indexable: !result.fallbackUsed,
      production: process.env["FAN_SUPPORT_DEPLOYMENT_ENV"] === "production",
    });
  }
  return { Page, generateMetadata };
}
