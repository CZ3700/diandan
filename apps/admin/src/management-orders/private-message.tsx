import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminOrdersLine, SupportedLocale } from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { OrdersApi, OrdersDetail } from "./api";
import { ordersCopy } from "./copy";
import { ordersError } from "./labels";
import { usePrivateView } from "./use-private-view";
import type { MutationRunner } from "./detail-view";

export function PrivateMessage({
  api,
  detail,
  line,
  locale,
  reviewLocale,
  canReview,
  busy,
  onMutation,
  onClose,
}: {
  api: OrdersApi;
  detail: OrdersDetail;
  line: AdminOrdersLine;
  locale: SupportedLocale;
  reviewLocale: SupportedLocale;
  canReview: boolean;
  busy: boolean;
  onMutation: MutationRunner;
  onClose: () => void;
}) {
  const copy = ordersCopy(locale);
  const load = useCallback(
    () =>
      api.readMessage({
        orderId: detail.orderId,
        itemId: line.itemId,
        expectedIntentVersion: line.intentVersion,
        reviewLocale,
      }),
    [api, detail.orderId, line.itemId, line.intentVersion, reviewLocale],
  );
  const { value, error, loading, clear, retry } = usePrivateView(load, onClose);
  const [confirmed, setConfirmed] = useState(false),
    [expired, setExpired] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (!value) return;
    const remaining = new Date(value.expiresAt).getTime() - Date.now();
    const timer = setTimeout(
      () => {
        clear();
        setConfirmed(false);
        setExpired(true);
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [value, clear]);
  async function review(decision: "APPROVED" | "REJECTED") {
    if (!value || !confirmed || busy || expired) return;
    const command = {
      orderId: detail.orderId,
      expectedOrderVersion: detail.version,
      itemId: line.itemId,
      expectedIntentVersion: line.intentVersion,
      accessId: value.accessId,
      reviewLocale,
      languageConfirmed: true as const,
      decision,
      reasonCode:
        decision === "APPROVED"
          ? "MESSAGE_REVIEW_APPROVED"
          : "MESSAGE_SAFETY_REJECTED",
    };
    clear();
    setConfirmed(false);
    const saved = await onMutation(() => api.reviewMessage(command));
    if (saved) onClose();
    else retry();
  }
  return (
    <section
      className="mo-private"
      data-private-panel="message"
      aria-labelledby={`private-message-${line.position}`}
    >
      <div className="mo-section-heading">
        <h3 id={`private-message-${line.position}`} ref={heading} tabIndex={-1}>
          {copy.reviewMessage}
        </h3>
        <Button
          type="button"
          variant="secondary"
          data-private-close
          onClick={() => {
            clear();
            onClose();
          }}
        >
          {copy.closePrivate}
        </Button>
      </div>
      <p className="mc-hint">{copy.privateHint}</p>
      {loading ? <p role="status">{copy.loading}</p> : null}
      {error ? (
        <p className="mc-error" role="alert">
          {ordersError(error, copy)}
        </p>
      ) : null}
      {expired ? <p role="alert">{copy.privateExpired}</p> : null}
      {error && !expired ? (
        <Button type="button" variant="secondary" onClick={retry}>
          {copy.retryAction}
        </Button>
      ) : null}
      {value ? (
        <>
          <div
            data-private-content
            lang={
              value.content.fanMessageLocale === "und"
                ? undefined
                : value.content.fanMessageLocale
            }
            className="mo-private-text"
          >
            {value.content.displayMode === "nickname" ? (
              <p>{value.content.displayName}</p>
            ) : null}
            <p>{value.content.fanMessage || copy.noMessage}</p>
          </div>
          {canReview ? (
            <>
              <label className="mo-check">
                <input
                  type="checkbox"
                  data-message-confirm
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) =>
                    setConfirmed(event.currentTarget.checked)
                  }
                />
                <span>{copy.confirmLanguage}</span>
              </label>
              <div className="mo-actions">
                <Button
                  type="button"
                  data-message-approve
                  disabled={busy || !confirmed}
                  onClick={() => void review("APPROVED")}
                >
                  {copy.approve}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  data-message-reject
                  disabled={busy || !confirmed}
                  onClick={() => void review("REJECTED")}
                >
                  {copy.reject}
                </Button>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
