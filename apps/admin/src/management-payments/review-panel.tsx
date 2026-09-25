import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
  type PaymentConfigurationRevision,
  type PaymentConfigurationAccount,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { PaymentMutation } from "./api";
import { paymentCopy } from "./copy";
import { languageName } from "./labels";
export function PaymentReviewPanel({
  revision,
  locale,
  canEdit,
  busy,
  accounts,
  mutate,
}: {
  revision: PaymentConfigurationRevision;
  locale: SupportedLocale;
  canEdit: boolean;
  busy: boolean;
  accounts: PaymentConfigurationAccount[];
  mutate: (command: PaymentMutation) => void;
}) {
  const c = paymentCopy(locale);
  return (
    <section aria-label={c.text} className="mp-section" data-payment-review>
      <h2>{c.text}</h2>
      <p>{c.reviewHint}</p>
      {revision.configuration.channels.map((channel) => (
        <article className="mp-card" key={channel.providerAccountId}>
          <h3>
            {accounts.find(
              (a) => a.providerAccountId === channel.providerAccountId,
            )?.displayLabel ?? c.account}
          </h3>
          <div className="mp-source">
            <strong>{c.source}</strong>
            <p>
              {channel.translations.find((t) => t.locale === "en")
                ?.displayName ?? c.missing}
            </p>
            <p>
              {channel.translations.find((t) => t.locale === "en")
                ?.customerHint ?? c.missing}
            </p>
          </div>
          <div className="mp-reviews">
            {SUPPORTED_LOCALES.map((language) => {
              const text = channel.translations.find(
                (t) => t.locale === language,
              );
              const review = revision.reviews.find(
                (r) =>
                  r.providerAccountId === channel.providerAccountId &&
                  r.locale === language,
              );
              const status = review?.status;
              return (
                <div
                  key={language}
                  className="mp-review"
                  data-payment-locale={language}
                >
                  <h4>{languageName(language, locale)}</h4>
                  <span className="mp-badge">
                    {reviewStatusLabel(status, locale)}
                  </span>
                  {text ? (
                    <div lang={language}>
                      <strong>{text.displayName}</strong>
                      <p>{text.customerHint}</p>
                    </div>
                  ) : (
                    <p>{c.translationMissing}</p>
                  )}
                  {text &&
                  canEdit &&
                  (status === "DRAFT" || status === "STALE") ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      data-payment-submit
                      onClick={() =>
                        mutate({
                          action: "SUBMIT",
                          revisionId: revision.revisionId,
                          providerAccountId: channel.providerAccountId,
                          locale: language,
                        })
                      }
                    >
                      {c.submit}
                    </Button>
                  ) : null}
                  {review?.canApprove ? (
                    <Button
                      type="button"
                      disabled={busy}
                      data-payment-approve
                      onClick={() =>
                        mutate({
                          action: "APPROVE",
                          revisionId: revision.revisionId,
                          providerAccountId: channel.providerAccountId,
                          locale: language,
                        })
                      }
                    >
                      {c.approve}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </section>
  );
}

function reviewStatusLabel(
  status: PaymentConfigurationRevision["reviews"][number]["status"] | undefined,
  locale: SupportedLocale,
) {
  const copy = paymentCopy(locale);
  switch (status) {
    case "DRAFT":
      return copy.draft;
    case "IN_REVIEW":
      return copy.inReview;
    case "APPROVED":
      return copy.approved;
    case "STALE":
      return copy.stale;
    default:
      return copy.missing;
  }
}
