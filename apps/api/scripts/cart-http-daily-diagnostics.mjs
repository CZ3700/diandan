import { createStorefrontCommerceUseCases } from "@fan-support/application";
import { storefrontGiftResponseSchema } from "@fan-support/contracts";
import { diagnoseCartDailyLoader } from "./cart-daily-loader-diagnostic.mjs";
import {
  projectPublishedContent,
  projectPublishedGiftCommerce,
} from "../../../packages/content/dist/index.js";

const summary = (value) => ({
  schemaVersion: Number.isInteger(value?.schemaVersion)
    ? value.schemaVersion
    : null,
  outcome:
    value?.outcome === "SUCCESS"
      ? "SUCCESS"
      : value?.outcome === "FAILURE"
        ? "FAILURE"
        : "INVALID",
  code:
    typeof value?.code === "string" && /^[A-Z_]{1,80}$/u.test(value.code)
      ? value.code
      : null,
});
const failure = (error) => ({
  outcome: "THREW",
  code:
    typeof error?.code === "string" && /^[A-Z0-9_]{1,80}$/u.test(error.code)
      ? error.code
      : null,
  validationIssues:
    error?.name === "ZodError"
      ? error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.filter(
            (part) =>
              typeof part === "number" ||
              /^[A-Za-z_]{1,80}$/u.test(String(part)),
          ),
        }))
      : [],
});
export async function diagnoseCartDailyGift({
  base,
  persistence,
  gift,
  idolId,
  database,
  publicMediaBaseUrl,
}) {
  const command = {
    schemaVersion: 1,
    handle: gift.handle,
    locale: "en",
    market: gift.market,
    currency: gift.currency,
    idolId,
  };
  const report = {};
  report.dailyLoader = await diagnoseCartDailyLoader({
    database,
    gift,
    publicMediaBaseUrl,
  });
  try {
    const query = new globalThis.URLSearchParams({
      locale: command.locale,
      market: command.market,
      currency: command.currency,
      idol: idolId,
    });
    const response = await globalThis.fetch(
      `${base}/api/v1/storefront-gifts/${encodeURIComponent(gift.handle)}?${query}`,
    );
    const parsed = storefrontGiftResponseSchema.safeParse(
      await response.json(),
    );
    report.http = {
      status: response.status,
      ...(parsed.success
        ? summary(parsed.data)
        : { outcome: "INVALID_SCHEMA" }),
    };
  } catch (error) {
    report.http = failure(error);
  }
  let repositoryStage = "repository";
  try {
    const loaded =
      await persistence.storefrontCommerceTransactionManager.runInStorefrontCommerceTransaction(
        ({ storefrontCommerce }) => storefrontCommerce.loadGift(command),
      );
    report.repository = summary(loaded);
    if (loaded.outcome === "SUCCESS") {
      repositoryStage = "projectionDiagnostics";
      report.contextVersion = loaded.gift.context.schemaVersion;
      report.profileVersion = loaded.gift.profileVersion;
      const projected = projectPublishedGiftCommerce(loaded.gift);
      report.giftProjection = summary(projected);
      report.recipientKind = loaded.recipient.kind;
      if (loaded.recipient.kind === "PUBLISHED")
        report.recipientProjection = summary(
          projectPublishedContent(loaded.recipient.context),
        );
      const context = loaded.gift.context;
      const candidate =
        context.schemaVersion === 3
          ? context.current
          : context.canonical.candidate;
      report.priceProofMatches = loaded.variants.every(
        (fact) =>
          fact.price === null ||
          candidate.prices.some(
            (price) =>
              price.id === fact.price.priceId &&
              price.revision === fact.price.priceRevision &&
              price.giftVariantId === fact.giftVariantId &&
              price.unitAmountMinor === fact.price.unitAmountMinor &&
              candidate.priceBooks.some(
                (book) =>
                  book.id === price.priceBookId &&
                  book.revision === price.priceBookRevision &&
                  book.market === command.market &&
                  book.currency === command.currency,
              ),
          ),
      );
    }
  } catch (error) {
    report[repositoryStage] = failure(error);
  }
  try {
    report.application = summary(
      await createStorefrontCommerceUseCases({
        transactions: persistence.storefrontCommerceTransactionManager,
      }).readGift(command),
    );
  } catch (error) {
    report.application = failure(error);
  }
  return report;
}
