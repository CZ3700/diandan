import type { SupportedLocale } from "@fan-support/contracts";
import { Icon } from "@fan-support/ui";
import type { ReactNode } from "react";
import type { StorefrontCopy } from "./copy";
import { storefrontHref } from "./navigation";

export function PageState({
  copy,
  locale,
  title,
  body,
  contextQuery = "",
  retryPath = "/",
}: Readonly<{
  copy: StorefrontCopy;
  locale: SupportedLocale;
  title: string;
  body: string;
  contextQuery?: string;
  retryPath?: string;
}>) {
  return (
    <section className="storefront-state">
      <p className="storefront-eyebrow">{copy.navArtists}</p>
      <h1>{title}</h1>
      <p>{body}</p>
      <a
        className="storefront-primary"
        href={storefrontHref(locale, retryPath, contextQuery)}
      >
        {copy.artistRetry}
        <Icon name="arrow-right" decorative />
      </a>
      <a
        className="storefront-text-link"
        href={storefrontHref(locale, "/idols", contextQuery)}
      >
        {copy.backArtists}
      </a>
    </section>
  );
}
export function HowItWorks({ copy }: Readonly<{ copy: StorefrontCopy }>) {
  const steps = [
    [copy.howSelect, copy.howSelectBody],
    [copy.howPay, copy.howPayBody],
    [copy.howDeliver, copy.howDeliverBody],
  ];
  return (
    <section
      className="storefront-section storefront-how"
      aria-labelledby="how-title"
    >
      <h2 id="how-title">{copy.howTitle}</h2>
      <ol>
        {steps.map(([title, body], i) => (
          <li key={title}>
            <span className="storefront-eyebrow" aria-hidden="true">
              0{i + 1}
            </span>
            <h3>{title}</h3>
            <p>{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
export function StudioPromise({ copy }: Readonly<{ copy: StorefrontCopy }>) {
  return (
    <section className="storefront-section storefront-trust">
      <h2>{copy.trustTitle}</h2>
      <p>{copy.trustBody}</p>
      <p>{copy.giftHandover}</p>
    </section>
  );
}
export function SiteFooter({
  copy,
  locale,
  name,
  contextQuery,
  policyLinks,
}: Readonly<{
  copy: StorefrontCopy;
  locale: SupportedLocale;
  name: string;
  contextQuery: string;
  policyLinks?: ReactNode;
}>) {
  return (
    <footer className="storefront-footer">
      <span className="storefront-wordmark">
        {name}
        <span aria-hidden="true">.</span>
      </span>
      <p>{copy.giftHandover}</p>
      <a href={storefrontHref(locale, "/region", contextQuery)}>
        {copy.region}
      </a>
      <a href={storefrontHref(locale, "/idols", contextQuery)}>
        {copy.backArtists}
        <Icon name="arrow-right" decorative />
      </a>
      {policyLinks}
    </footer>
  );
}
