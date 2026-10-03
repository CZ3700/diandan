import "server-only";
import type { SupportedLocale } from "@fan-support/contracts";
import { readWishGallery } from "../server/public-wish-gallery";
import { loadStorefrontCopy } from "../server/storefront-copy";
import {
  loadStorefrontRuntimeConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import {
  StorefrontPageShell,
  type StorefrontPageProps,
} from "./storefront-page-shell";
import { WishGallery } from "./wish-gallery";
import { storefrontHref } from "./navigation";

export function createWishGalleryPage(locale: SupportedLocale) {
  return async function WishGalleryPage({ searchParams }: StorefrontPageProps) {
    loadStorefrontRuntimeConfig();
    const values = await searchParams;
    const [copy, result] = await Promise.all([
      loadStorefrontCopy(locale),
      readWishGallery({
        schemaVersion: 1,
        locale,
        limit: 20,
        ...(values["idol"] !== undefined ? { idolId: values["idol"] } : {}),
        ...(values["cursor"] !== undefined ? { cursor: values["cursor"] } : {}),
      }),
    ]);
    const idolId =
      typeof values["idol"] === "string" ? values["idol"] : undefined;
    return (
      <StorefrontPageShell
        name={loadStorefrontPresentationConfig().name}
        locale={locale}
        copy={copy}
        contextQuery=""
        active="gifts"
      >
        <section
          className="storefront-section wish-gallery-page"
          aria-labelledby="wish-gallery-title"
        >
          <div className="wish-gallery-heading">
            <div>
              <p className="storefront-eyebrow">{copy.wishTitle}</p>
              <h1 id="wish-gallery-title" className="wish-gallery-title">
                {copy.wishShowcaseTitle}
              </h1>
              <p>{copy.wishShowcaseIntro}</p>
            </div>
            <a
              className="storefront-text-link"
              href={storefrontHref(
                locale,
                "/gifts",
                new URLSearchParams({
                  kind: "WISH",
                  ...(idolId ? { idol: idolId } : {}),
                }).toString(),
              )}
            >
              {copy.giftChoose}
            </a>
          </div>
          <WishGallery
            result={result}
            locale={locale}
            copy={copy}
            {...(idolId ? { idolId } : {})}
          />
        </section>
      </StorefrontPageShell>
    );
  };
}
