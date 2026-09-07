import type { SupportedLocale } from "@fan-support/contracts";
import { loadStorefrontCopy } from "../server/storefront-copy";
import { PageState } from "./page-parts";
export function createStorefrontNotFound(locale: SupportedLocale) {
  return async function NotFound() {
    const copy = await loadStorefrontCopy(locale);
    return (
      <main className="storefront" lang={locale}>
        <PageState
          locale={locale}
          copy={copy}
          title={copy.notFound}
          body={copy.artistEmptyDescription}
          retryPath="/idols"
        />
      </main>
    );
  };
}
export function createStorefrontLoading(locale: SupportedLocale) {
  return async function Loading() {
    const copy = await loadStorefrontCopy(locale);
    return (
      <main className="storefront" lang={locale}>
        <section className="storefront-state" aria-busy="true">
          <h1>{copy.loading}</h1>
          <p role="status">{copy.artistLoading}</p>
        </section>
      </main>
    );
  };
}
