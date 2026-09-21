import { useId } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { FinanceDetail, FinanceCommand } from "./api";
import { financeCopy } from "./copy";
import { FinanceMoney } from "./money";
import { financeStatus } from "./labels";
export function FinanceRecords({
  detail,
  locale,
  disabled,
  onReconcile,
}: {
  detail: FinanceDetail;
  locale: SupportedLocale;
  disabled: boolean;
  onReconcile: (target: FinanceCommand<"RECONCILE">["target"]) => void;
}) {
  const copy = financeCopy(locale),
    id = useId();
  const money = (amount: number) => (
    <FinanceMoney
      amount={amount}
      currency={detail.order.currency}
      locale={locale}
    />
  );
  return (
    <>
      <section className="mf-history" aria-labelledby={`${id}-refunds`}>
        <h3 id={`${id}-refunds`}>{copy.history}</h3>
        {detail.refunds.length === 0 ? (
          <p className="mc-hint">{copy.noRecords}</p>
        ) : (
          <ul>
            {detail.refunds.map((refund) => (
              <li
                key={refund.refundId}
                data-finance-refund-record={refund.refundId}
              >
                <div>
                  <strong>{money(refund.amountMinor)}</strong> ·{" "}
                  <span data-finance-refund-status={refund.status}>
                    {financeStatus(refund.status, copy)}
                  </span>
                </div>
                <time dateTime={refund.createdAt}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(refund.createdAt))}
                </time>
                {detail.canManage && refund.canReconcile ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={disabled}
                    data-finance-reconcile-refund={refund.refundId}
                    onClick={() =>
                      onReconcile({
                        kind: "REFUND",
                        refundId: refund.refundId,
                      })
                    }
                  >
                    {copy.reconcile}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mf-history" aria-labelledby={`${id}-payments`}>
        <h3 id={`${id}-payments`}>{copy.payments}</h3>
        <ul>
          {detail.attempts.map((attempt) => (
            <li key={attempt.attemptId}>
              <div>
                {money(attempt.amountMinor)} ·{" "}
                <span>{financeStatus(attempt.status, copy)}</span>
              </div>
              {detail.canManage && attempt.canReconcile ? (
                <Button
                  type="button"
                  variant="secondary"
                  data-finance-reconcile-payment={attempt.attemptId}
                  disabled={disabled}
                  onClick={() =>
                    onReconcile({
                      kind: "PAYMENT",
                      attemptId: attempt.attemptId,
                    })
                  }
                >
                  {copy.reconcile}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {detail.disputes.length ? (
        <section className="mf-history" aria-labelledby={`${id}-disputes`}>
          <h3 id={`${id}-disputes`}>{copy.disputes}</h3>
          <ul>
            {detail.disputes.map((dispute) => (
              <li key={dispute.disputeId}>
                {money(dispute.amountMinor)} ·{" "}
                <span data-finance-dispute-status={dispute.status}>
                  {financeStatus(dispute.status, copy)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
