import { verifyStorefrontProtocol } from "./storefront-protocol.mjs";
import { verifyGiftStorefrontProtocol } from "./gift-storefront-protocol.mjs";
import { verifyGiftStorefrontScoped } from "./gift-storefront-scoped.mjs";

/** Baseline publication/media/commerce evidence only; SEO/cache acceptance is composed separately. */
export async function verifyAcceptanceProtocol(context) {
  const storefront = await verifyStorefrontProtocol({
    ...context,
    mutate: false,
  });
  // Preserve the original four recipient states without expanding its matrix 40-fold.
  const commerce = {
    ...context,
    fixtures: {
      ...context.fixtures,
      artists: context.fixtures.artists.slice(0, 3),
    },
  };
  const directory = await verifyGiftStorefrontProtocol(commerce);
  const offers = await verifyGiftStorefrontScoped(commerce);
  const seo = await (
    await import(`./storefront-acceptance-seo.mjs?attempt=${Date.now()}`)
  ).verifyAcceptanceSeo(context);
  const concurrentReads = await (
    await import(
      `./storefront-acceptance-concurrency.mjs?attempt=${Date.now()}`
    )
  ).verifyAcceptanceConcurrentReads(context);
  return {
    schemaVersion: 1,
    scope:
      "Real HTTP publication/media/commerce and SEO proof, enumeration, validators and normal lifecycle mutations; excludes compiled HTML/cache convergence, performance and manual acceptance",
    storefront,
    directory,
    offers,
    seo,
    concurrentReads,
  };
}
