import "server-only";
import type { Metadata } from "next";
import {
  publicOrderIdSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  loadStorefrontPresentationConfig,
  loadStorefrontRuntimeConfig,
} from "../server/runtime-config";
import { loadStorefrontCopy } from "../server/storefront-copy";
import { StorefrontPageShell } from "./storefront-page-shell";
import { OrderClient, type OrderPageMode } from "./order-client";
import "./order.css";
export type OrderPageProps = Readonly<{
  params: Promise<{ publicOrderId?: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;
export function createOrderPage(locale: SupportedLocale, mode: OrderPageMode) {
  return async function OrderPage({ params, searchParams }: OrderPageProps) {
    loadStorefrontRuntimeConfig();
    const copy = await loadStorefrontCopy(locale),
      query = await searchParams;
    const id = publicOrderIdSchema.safeParse((await params).publicOrderId);
    const invalid =
      Object.keys(query).length > 0 ||
      (["detail", "thank-you"].includes(mode) && !id.success);
    return (
      <StorefrontPageShell
        locale={locale}
        copy={copy}
        name={loadStorefrontPresentationConfig().name}
        contextQuery=""
        active="other"
      >
        <OrderClient
          locale={locale}
          copy={copy}
          mode={mode}
          {...(id.success ? { publicOrderId: id.data } : {})}
          invalid={invalid}
        />
      </StorefrontPageShell>
    );
  };
}
export function createOrderMetadata(
  locale: SupportedLocale,
  mode: OrderPageMode,
) {
  return async (): Promise<Metadata> => ({
    title: (await loadStorefrontCopy(locale))[
      mode === "lookup" ? "orderLookupTitle" : "orderTitle"
    ],
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  });
}
