import type { SupportedLocale } from "@fan-support/contracts";
import { DESIGN_TOKEN_CONTRACT } from "@fan-support/design-tokens";
import { loadStorefrontCopy } from "../server/storefront-copy";
export function createStorefrontNotFound(locale: SupportedLocale) {
  return async function NotFound() {
    const copy = await loadStorefrontCopy(locale);
    return (
      <main className="storefront" lang={locale}>
        <section className="storefront-state">
          <h1>{copy.notFound}</h1>
          <a className="storefront-primary" href={`/${locale}`}>
            {copy.navHome}
          </a>
        </section>
      </main>
    );
  };
}
export function createStorefrontLoading(locale: SupportedLocale) {
  return async function Loading() {
    const copy = await loadStorefrontCopy(locale);
    return (
      <main
        className="storefront"
        lang={locale}
        style={{
          fontFamily: DESIGN_TOKEN_CONTRACT.runtimeDefaults["--font-ui"],
        }}
      >
        <section className="storefront-state" aria-busy="true">
          <h1>{copy.loading}</h1>
          <p role="status">{copy.artistLoading}</p>
        </section>
      </main>
    );
  };
}
