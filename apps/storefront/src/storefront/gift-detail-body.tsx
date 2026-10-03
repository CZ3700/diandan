import "server-only";
import {
  idolIdSchema,
  giftVariantIdSchema,
  type SupportedLocale,
  type StorefrontContextResponse,
} from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import type { readGiftDetailPage } from "./gift-detail-page-reads";
import { commerceRead } from "./gift-page-reads";
import { soleCommerceScope } from "./commerce-scope";
import { GiftDetail } from "./gift-detail";
import { PageState } from "./page-parts";
import { giftRecoveryQuery } from "./gift-selection";
import { queryString } from "./navigation";

/** One rendering path for public details and the inert theme preview. */
export function giftDetailBody({
  locale,
  copy,
  detail,
  values,
  context,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  detail: Awaited<ReturnType<typeof readGiftDetailPage>>;
  values: Parameters<typeof readGiftDetailPage>[2];
  context: Promise<StorefrontContextResponse>;
}>) {
  const contextQuery = queryString(values);
  const { handle, result, scoped, artists, selection } = detail;
  const soleIdol = idolIdSchema.safeParse(values["idol"]);
  const soleVariant = giftVariantIdSchema.safeParse(values["variant"]);
  if (
    result.outcome !== "SUCCESS" ||
    selection.kind === "INVALID_QUERY" ||
    (scoped?.outcome === "FAILURE" && scoped.code !== "MARKET_UNAVAILABLE")
  )
    return (
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
    return (
      <GiftDetail
        locale={locale}
        copy={copy}
        content={scoped?.outcome === "SUCCESS" ? scoped : result}
        {...(scoped?.outcome === "SUCCESS" ? { commerce: scoped } : {})}
        context={context}
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
