import { useEffect, useId, useRef, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { FinanceDetail, FinanceDraft } from "./api";
import { financeCopy } from "./copy";
import { FinanceMoney } from "./money";
import { FinanceRecords } from "./records";
import { refundAllocation } from "./model";
type Props = {
  detail: FinanceDetail;
  locale: SupportedLocale;
  busy: boolean;
  locked: boolean;
  submit: (command: FinanceDraft) => void;
  itemTitles?: Readonly<Record<string, string>>;
};
export function FinanceDetailView({
  detail,
  locale,
  busy,
  locked,
  submit,
  itemTitles = {},
}: Props) {
  const copy = financeCopy(locale),
    id = useId();
  const [mode, setMode] = useState<"FULL" | "PARTIAL">("FULL"),
    [inputs, setInputs] = useState<Record<string, string>>({});
  const [reasonCode, setReason] = useState("CUSTOMER_REQUEST"),
    [confirmed, setConfirmed] = useState(false);
  const [target, setTarget] = useState<
    Extract<FinanceDraft, { action: "RECONCILE" }>["target"] | null
  >(null);
  const [action, setAction] = useState<"REFUND" | "CANCEL" | "RECONCILE">(
    "REFUND",
  );
  const confirmationForm = useRef<HTMLFormElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest > 0 && confirmationForm.current) {
      confirmationForm.current.focus({ preventScroll: true });
      confirmationForm.current.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      });
    }
  }, [focusRequest]);
  const order = detail.order,
    disabled = busy || locked;
  const allocation = refundAllocation(
    detail.items,
    mode,
    inputs,
    locale,
    order.currency,
    order.availableRefundAmountMinor,
  );
  const canRefund =
    detail.canManage &&
    order.availableRefundAmountMinor > 0 &&
    !order.needsReconciliation &&
    (order.disputeStatus === "NONE" || order.disputeStatus === "WON");
  const money = (amount: number) => (
    <FinanceMoney amount={amount} currency={order.currency} locale={locale} />
  );
  const choose = (next: typeof action, nextTarget: typeof target = null) => {
    setAction(next);
    setTarget(nextTarget);
    setConfirmed(false);
    if (next === "RECONCILE") setReason("PROVIDER_RESULT_CHECK");
    setFocusRequest((value) => value + 1);
  };
  const send = () => {
    if (disabled || !confirmed || !detail.canManage) return;
    const base = {
      orderId: order.orderId,
      expectedOrderVersion: order.version,
      reasonCode,
      confirmed: true as const,
    };
    if (action === "REFUND" && canRefund && allocation)
      submit({ ...base, action, currency: order.currency, ...allocation });
    else if (action === "CANCEL" && detail.canCancel)
      submit({ ...base, action });
    else if (action === "RECONCILE" && target)
      submit({ ...base, action, target });
  };
  const canSubmit =
    detail.canManage &&
    (action === "REFUND"
      ? canRefund && !!allocation
      : action === "CANCEL"
        ? detail.canCancel
        : !!target);
  return (
    <div data-finance-detail={order.orderId}>
      <dl className="mf-balances">
        {(
          [
            [copy.captured, order.capturedAmountMinor],
            [copy.refunded, order.refundedAmountMinor],
            [
              copy.occupied,
              Math.max(
                0,
                order.occupiedRefundAmountMinor - order.refundedAmountMinor,
              ),
            ],
            [copy.available, order.availableRefundAmountMinor],
          ] as const
        ).map(([label, amount]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{money(amount)}</dd>
          </div>
        ))}
      </dl>
      {order.needsReconciliation ? (
        <p className="mf-notice" data-finance-pending role="status">
          {copy.pendingHint}
        </p>
      ) : null}
      {!detail.canManage ? <p className="mc-hint">{copy.readOnly}</p> : null}
      {order.disputeStatus === "OPEN" || order.disputeStatus === "LOST" ? (
        <p className="mf-notice" data-finance-dispute-hold role="status">
          {copy.disputeHold}
        </p>
      ) : null}
      {canRefund || (detail.canManage && detail.canCancel) ? (
        <div className="mo-actions">
          {canRefund ? (
            <Button
              type="button"
              variant="secondary"
              data-finance-refund
              disabled={disabled}
              aria-pressed={action === "REFUND"}
              onClick={() => choose("REFUND")}
            >
              {copy.refund}
            </Button>
          ) : null}
          {detail.canManage && detail.canCancel ? (
            <Button
              type="button"
              variant="secondary"
              data-finance-cancel
              disabled={disabled}
              aria-pressed={action === "CANCEL"}
              onClick={() => choose("CANCEL")}
            >
              {copy.cancelPayment}
            </Button>
          ) : null}
        </div>
      ) : null}
      {detail.canManage &&
      ((action === "REFUND" && canRefund) ||
        (action === "CANCEL" && detail.canCancel) ||
        (action === "RECONCILE" && target)) ? (
        <form
          ref={confirmationForm}
          tabIndex={-1}
          aria-label={
            action === "REFUND"
              ? copy.refund
              : action === "CANCEL"
                ? copy.cancelPayment
                : copy.reconcile
          }
          className="mf-form"
          data-finance-form
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          {action === "REFUND" ? (
            <>
              <p className="mc-hint">{copy.refundHint}</p>
              <label className="mc-field">
                <span>{copy.refund}</span>
                <select
                  data-finance-mode
                  value={mode}
                  disabled={disabled}
                  onChange={(event) => {
                    setMode(event.currentTarget.value as typeof mode);
                    setConfirmed(false);
                  }}
                >
                  <option value="FULL">{copy.full}</option>
                  <option value="PARTIAL">{copy.partial}</option>
                </select>
              </label>
              <ul className="mf-allocation">
                {detail.items.map((item) => (
                  <li key={item.orderItemId}>
                    <label className="mc-field">
                      <span>
                        {itemTitles[item.orderItemId] ??
                          `${copy.item} ${new Intl.NumberFormat(locale).format(item.position)}`}
                      </span>
                      <span className="mc-hint">
                        {copy.available}: {money(item.availableAmountMinor)}
                      </span>
                      {mode === "PARTIAL" ? (
                        <input
                          data-finance-item={item.orderItemId}
                          type="text"
                          inputMode="decimal"
                          maxLength={30}
                          value={inputs[item.orderItemId] ?? ""}
                          disabled={disabled || item.availableAmountMinor === 0}
                          aria-label={`${copy.amount} · ${itemTitles[item.orderItemId] ?? `${copy.item} ${item.position}`}`}
                          onChange={(event) => {
                            const input = event.currentTarget.value;
                            setInputs((value) => ({
                              ...value,
                              [item.orderItemId]: input,
                            }));
                            setConfirmed(false);
                          }}
                        />
                      ) : (
                        <span>{money(item.availableAmountMinor)}</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
              <p data-finance-total>
                {copy.total}: {money(allocation?.amountMinor ?? 0)}
              </p>
              {!allocation ? <p className="mc-hint">{copy.invalid}</p> : null}
            </>
          ) : (
            <p className="mc-hint">
              {action === "CANCEL" ? copy.cancelHint : copy.pendingHint}
            </p>
          )}
          <label className="mc-field">
            <span>{copy.reason}</span>
            <select
              data-finance-reason
              value={reasonCode}
              disabled={disabled}
              onChange={(event) => {
                setReason(event.currentTarget.value);
                setConfirmed(false);
              }}
            >
              <option value="CUSTOMER_REQUEST">{copy.customer}</option>
              <option value="DUPLICATE_PAYMENT">{copy.duplicate}</option>
              <option value="GIFT_UNAVAILABLE">{copy.unavailableReason}</option>
              <option value="PROVIDER_RESULT_CHECK">{copy.verifyReason}</option>
            </select>
          </label>
          <label className="mo-check" htmlFor={`${id}-confirm`}>
            <input
              id={`${id}-confirm`}
              data-finance-confirm
              type="checkbox"
              disabled={disabled}
              checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
            />
            <span>{copy.confirm}</span>
          </label>
          <Button
            type="submit"
            data-finance-submit
            disabled={disabled || !confirmed || !canSubmit}
          >
            {action === "REFUND"
              ? copy.submit
              : action === "CANCEL"
                ? copy.cancelPayment
                : copy.reconcile}
          </Button>
        </form>
      ) : null}
      <FinanceRecords
        detail={detail}
        locale={locale}
        disabled={disabled}
        onReconcile={(target) => choose("RECONCILE", target)}
      />
      {detail.issues.length ? (
        <p role="status">
          {copy.issue} ·{" "}
          {new Intl.NumberFormat(locale).format(detail.issues.length)}
        </p>
      ) : null}
    </div>
  );
}
