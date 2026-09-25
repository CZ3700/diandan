import "server-only";
import type { Metadata } from "next";
import {
  checkoutSessionIdSchema,
  paymentAttemptIdSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  loadStorefrontPresentationConfig,
  loadStorefrontRuntimeConfig,
} from "../server/runtime-config";
import { loadStorefrontCopy } from "../server/storefront-copy";
import {
  StorefrontPageShell,
  type StorefrontPageProps,
} from "./storefront-page-shell";
import { CheckoutClient } from "./checkout-client";
import "./checkout.css";
export function createCheckoutPage(locale: SupportedLocale, returning = false) {
  return async function CheckoutPage({ searchParams }: StorefrontPageProps) {
    loadStorefrontRuntimeConfig();
    const copy = await loadStorefrontCopy(locale);
    const query = await searchParams;
    const session = checkoutSessionIdSchema.safeParse(query["session"]);
    const attempt = paymentAttemptIdSchema.safeParse(query["attempt"]);
    const invalid =
      returning &&
      (!session.success ||
        !attempt.success ||
        Object.keys(query).some(
          (key) => !["session", "attempt"].includes(key),
        ));
    const locator =
      returning && !invalid && session.success && attempt.success
        ? { session: session.data, attempt: attempt.data }
        : undefined;
    return (
      <StorefrontPageShell
        locale={locale}
        copy={copy}
        name={loadStorefrontPresentationConfig().name}
        contextQuery=""
        active="other"
      >
        <div className="storefront-section checkout-page">
          <h1>{returning ? copy.checkoutReturnTitle : copy.checkoutTitle}</h1>
          <CheckoutClient
            locale={locale}
            copy={copy}
            {...(locator ? { locator } : {})}
            invalid={invalid}
          />
        </div>
      </StorefrontPageShell>
    );
  };
}
export function createCheckoutMetadata(
  locale: SupportedLocale,
  returning = false,
) {
  return async (): Promise<Metadata> => ({
    title: (await loadStorefrontCopy(locale))[
      returning ? "checkoutReturnTitle" : "checkoutTitle"
    ],
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  });
}
