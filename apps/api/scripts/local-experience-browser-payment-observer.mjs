import { URL } from "node:url";
import { paymentRuntimeResponseSchema } from "@fan-support/contracts";

/** Retains only canonical payment identities and states, never request bodies or capabilities. */
export function observeLocalBrowserPayment({
  page,
  config,
  report,
  readBodyForStage = () => true,
}) {
  const pending = new Set();
  const pattern =
    /^\/api\/storefront\/checkout\/sessions\/([a-f0-9-]+)\/attempts(?:\/([a-f0-9-]+))?$/u;
  const request = (value) => {
    const url = new URL(value.url());
    const matched = url.pathname.match(pattern);
    if (url.origin !== config.origins.storefront || !matched) return;
    if (value.method() === "POST" && !matched[2])
      report.paymentCreates.push({
        checkoutSessionId: matched[1],
        stage: report.stage,
      });
  };
  const response = (value) => {
    const url = new URL(value.url());
    const matched = url.pathname.match(pattern);
    if (
      url.origin !== config.origins.storefront ||
      !matched?.[2] ||
      value.request().method() !== "GET"
    )
      return;
    const stage = report.stage;
    const operation = (async () => {
      try {
        // HTTP failures are always evidence failures, including stages whose
        // bodies cannot be retained after cross-document navigation.
        if (value.status() !== 200) {
          report.observations.push({
            code: "PAYMENT_READ_CONTRACT_FAILED",
            stage,
          });
          return;
        }
        if (!readBodyForStage(stage)) return;
        const parsed = paymentRuntimeResponseSchema.safeParse(
          await value.json(),
        );
        if (
          !parsed.success ||
          parsed.data.outcome !== "SUCCESS" ||
          !("attempt" in parsed.data) ||
          !parsed.data.attempt
        ) {
          report.observations.push({
            code: "PAYMENT_READ_CONTRACT_FAILED",
            stage,
          });
          return;
        }
        const attempt = parsed.data.attempt;
        report.paymentReads.push({
          stage,
          checkoutSessionId: attempt.checkoutSessionId,
          attemptId: attempt.id,
          status: attempt.status,
          recovery: attempt.recovery,
        });
      } catch {
        report.observations.push({ code: "PAYMENT_READ_UNAVAILABLE", stage });
      }
    })();
    pending.add(operation);
    void operation.finally(() => pending.delete(operation));
  };
  page.on("request", request);
  page.on("response", response);
  return {
    async settled() {
      await Promise.all(pending);
    },
    dispose() {
      page.off("request", request);
      page.off("response", response);
    },
  };
}
