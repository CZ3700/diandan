import { useCallback, useEffect, useRef, useState } from "react";
import {
  LOCALE_NATIVE_NAMES,
  type AdminOrdersLine,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button, Price } from "@fan-support/ui";
import { managementCopy } from "../management-center/copy";
import { giftKindLabel } from "../management-center/form-fields";
import { PhotoView } from "../management-center/photo-view";
import type { OrdersApi, OrdersContext, OrdersDetail } from "./api";
import { ordersCopy } from "./copy";
import { orderStatusLabel } from "./labels";
import { PrivateMessage } from "./private-message";
import { PrivateNotes } from "./private-notes";
import type { FinanceApi } from "../management-finance/api";
import { FinancePanel } from "../management-finance/panel";
export type MutationRunner = (
  work: () => Promise<unknown>,
  success?: "QUEUED" | "SAVED",
) => Promise<boolean>;
type DetailProps = {
  locale: SupportedLocale;
  detail: OrdersDetail;
  context: OrdersContext;
  api: OrdersApi;
  busy: boolean;
  onMutation: MutationRunner;
  onReload: () => void;
  financeApi?: FinanceApi | undefined;
  onFinanceBusy?: ((busy: boolean) => void) | undefined;
};
function usePrivatePanel() {
  const [opened, setOpened] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null),
    wasOpened = useRef(false);
  useEffect(() => {
    if (!opened && wasOpened.current) trigger.current?.focus();
    wasOpened.current = opened;
  }, [opened]);
  const close = useCallback(() => setOpened(false), []);
  return { opened, setOpened, trigger, close };
}
function OrderLine({
  line,
  ...props
}: DetailProps & { line: AdminOrdersLine }) {
  const { locale, detail, context, api, busy, onMutation } = props;
  const copy = ordersCopy(locale),
    common = managementCopy(locale);
  const snapshot = detail.order.items.find(
    (item) => item.position === line.position,
  )!;
  const { opened, setOpened, trigger: openButton, close } = usePrivatePanel();
  const [reviewLocale, setReviewLocale] = useState<SupportedLocale | undefined>(
    () =>
      context.reviewLocales.find((value) => value === line.declaredLocale) ??
      context.reviewLocales[0],
  );
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("PREPARATION_DELAYED");
  const canRead =
    context.permissions.includes("orders.message.read") &&
    line.privacyState === "ACTIVE" &&
    reviewLocale !== undefined;
  const canReview = context.permissions.includes("orders.message.review");
  const manager =
    context.permissions.includes("orders.manage") &&
    line.allowedActions.some(
      (action) => action === "HOLD" || action === "RESUME",
    );
  const command = {
    orderId: detail.orderId,
    expectedOrderVersion: detail.version,
    fulfillmentId: line.fulfillmentId,
    expectedFulfillmentVersion: line.fulfillmentVersion,
  };
  return (
    <li className="mo-line" data-order-line={line.itemId}>
      <div className="mo-line-summary">
        <div className="mo-gift-image">
          <PhotoView
            src={snapshot.gift.image.url}
            alt={snapshot.gift.image.alt}
            unavailable={common.imageUnavailable}
            lazy
          />
        </div>
        <div>
          <h2 lang={snapshot.gift.locale.resolvedLocale}>
            {snapshot.gift.title}
          </h2>
          <p>
            {copy.recipient}{" "}
            <strong lang={snapshot.idol.locale.resolvedLocale}>
              {snapshot.idol.displayName}
            </strong>
          </p>
          <p className="mc-hint">
            {line.giftKind === "LEGACY"
              ? copy.legacy
              : giftKindLabel(line.giftKind, common)}{" "}
            ·{" "}
            {line.inventoryPolicy === "PROCURE_ON_DEMAND"
              ? common.madeToOrder
              : line.inventoryPolicy === "TRACKED"
                ? common.tracked
                : line.inventoryPolicy === "PREORDER"
                  ? common.preorder
                  : copy.legacy}
          </p>
          {line.giftKind === "VIRTUAL" ? (
            <p className="mc-hint" data-order-digital>
              {copy.digitalDelivery}
            </p>
          ) : null}
          <p>
            {new Intl.NumberFormat(locale).format(snapshot.quantity)} ×{" "}
            <Price
              locale={locale}
              currency={snapshot.currency}
              amountMinor={snapshot.unitAmountMinor}
            />
          </p>
        </div>
        <strong className="mo-line-status">
          {orderStatusLabel(snapshot.fulfillmentStatus, copy)}
        </strong>
      </div>
      <div className="mo-line-review">
        <span>
          {copy.reviewFilter}:{" "}
          {line.moderationStatus === "PENDING"
            ? copy.reviewCount
            : orderStatusLabel(line.moderationStatus, copy)}
        </span>
        {line.languageConfidence !== "CONFIRMED" &&
        (line.hasMessage || line.hasDisplayName) ? (
          <span className="mc-hint">{copy.languageUnverified}</span>
        ) : null}
      </div>
      {!opened && (line.hasMessage || line.hasDisplayName) && canRead ? (
        <div className="mo-review-controls">
          <label className="mc-field">
            <span>{copy.reviewLanguage}</span>
            <select
              data-review-language
              value={reviewLocale}
              disabled={busy}
              onChange={(event) =>
                setReviewLocale(event.currentTarget.value as SupportedLocale)
              }
            >
              {context.reviewLocales.map((value) => (
                <option key={value} value={value}>
                  {LOCALE_NATIVE_NAMES[value]}
                </option>
              ))}
            </select>
          </label>
          <Button
            ref={openButton}
            type="button"
            variant="secondary"
            data-message-open
            disabled={busy}
            onClick={() => setOpened(true)}
          >
            {copy.reviewMessage}
          </Button>
        </div>
      ) : null}
      {opened && reviewLocale ? (
        <PrivateMessage
          api={api}
          detail={detail}
          line={line}
          locale={locale}
          reviewLocale={reviewLocale}
          canReview={canReview}
          busy={busy}
          onMutation={onMutation}
          onClose={close}
        />
      ) : null}
      <div className="mo-actions">
        {line.allowedActions.includes("PREPARE") ? (
          <Button
            type="button"
            data-order-prepare
            disabled={busy}
            onClick={() =>
              void onMutation(() =>
                api.prepare({
                  ...command,
                  reasonCode: "ORDER_PREPARATION_STARTED",
                }),
              )
            }
          >
            {copy.prepare}
          </Button>
        ) : null}
        {line.allowedActions.includes("DELIVER") ? (
          <Button
            type="button"
            data-order-deliver
            disabled={busy}
            onClick={() =>
              void onMutation(() =>
                api.deliver({
                  ...command,
                  reasonCode: "ORDER_DELIVERY_CONFIRMED",
                }),
              )
            }
          >
            {copy.deliver}
          </Button>
        ) : null}
      </div>
      {manager ? (
        <details className="mc-options" data-manager-actions>
          <summary>{copy.managerActions}</summary>
          <div className="mc-options-body">
            <label className="mc-field">
              <span>{copy.reason}</span>
              <select
                data-manager-reason
                value={reason}
                disabled={busy}
                onChange={(event) => setReason(event.currentTarget.value)}
              >
                <option value="PREPARATION_DELAYED">{copy.reasonDelay}</option>
                <option value="SAFETY_REVIEW_REQUIRED">
                  {copy.reasonSafety}
                </option>
                <option value="ISSUE_RESOLVED">{copy.reasonResolved}</option>
              </select>
            </label>
            <label className="mo-check">
              <input
                data-manager-confirm
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
              />
              <span>{copy.confirmChange}</span>
            </label>
            <div className="mo-actions">
              {line.allowedActions.includes("HOLD") ? (
                <Button
                  data-order-hold
                  type="button"
                  variant="secondary"
                  disabled={busy || !confirmed}
                  onClick={() =>
                    void onMutation(() =>
                      api.hold({
                        ...command,
                        reasonCode: reason,
                        confirmed: true,
                      }),
                    )
                  }
                >
                  {copy.hold}
                </Button>
              ) : null}
              {line.allowedActions.includes("RESUME") ? (
                <Button
                  data-order-resume
                  type="button"
                  variant="secondary"
                  disabled={busy || !confirmed}
                  onClick={() =>
                    void onMutation(() =>
                      api.resume({
                        ...command,
                        reasonCode: reason,
                        confirmed: true,
                      }),
                    )
                  }
                >
                  {copy.resume}
                </Button>
              ) : null}
            </div>
          </div>
        </details>
      ) : null}
    </li>
  );
}
export function OrdersDetailView(props: DetailProps) {
  const { locale, detail, context, api, busy, onMutation } = props;
  const copy = ordersCopy(locale);
  const {
    opened: notesOpen,
    setOpened: setNotesOpen,
    trigger: notesButton,
    close: closeNotes,
  } = usePrivatePanel();
  return (
    <div data-orders-detail={detail.orderId}>
      <div className="mo-order-summary">
        <div>
          <p>
            {copy.orderDate} ·{" "}
            {new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(detail.order.createdAt))}
          </p>
          <p>
            {copy.orderLanguage} ·{" "}
            {LOCALE_NATIVE_NAMES[detail.order.presentationLocale]}
          </p>
        </div>
        <div>
          <Price
            locale={locale}
            currency={detail.order.amount.currency}
            amountMinor={detail.order.amount.totalAmountMinor}
          />
          <p>
            {detail.order.paymentStatus === "PENDING"
              ? copy.paymentPending
              : orderStatusLabel(detail.order.paymentStatus, copy)}
          </p>
        </div>
      </div>
      <p className="mc-hint">{copy.studioDelivery}</p>
      {props.financeApi && props.onFinanceBusy ? (
        <FinancePanel
          api={props.financeApi}
          orderId={detail.orderId}
          actorId={context.actorId}
          locale={locale}
          onBusy={props.onFinanceBusy}
          onUpdated={props.onReload}
          itemTitles={Object.fromEntries(
            detail.items.map((line) => {
              const snapshot = detail.order.items.find(
                (item) => item.position === line.position,
              );
              const position = new Intl.NumberFormat(locale).format(
                line.position,
              );
              return [
                line.itemId,
                snapshot
                  ? `${position} · ${snapshot.gift.title} · ${snapshot.idol.displayName}`
                  : position,
              ];
            }),
          )}
        />
      ) : null}
      <ul className="mo-lines">
        {detail.items.map((line) => (
          <OrderLine
            key={`${line.itemId}-${line.intentVersion}-${line.fulfillmentVersion}`}
            {...props}
            line={line}
          />
        ))}
      </ul>
      <section className="mo-secondary" aria-labelledby="order-notification">
        <h2 id="order-notification">{copy.notification}</h2>
        <p data-order-notification-status={detail.notification.status}>
          {orderStatusLabel(detail.notification.status, copy)}
        </p>
        {detail.notification.canResend &&
        detail.notification.latestNotificationId &&
        context.permissions.includes("orders.notification.resend") ? (
          <Button
            type="button"
            variant="secondary"
            data-order-resend
            disabled={busy}
            onClick={() =>
              void onMutation(
                () =>
                  api.resend({
                    orderId: detail.orderId,
                    expectedOrderVersion: detail.version,
                    expectedLatestNotificationId:
                      detail.notification.latestNotificationId!,
                    reasonCode: "OPERATOR_REQUESTED_RESEND",
                  }),
                "QUEUED",
              )
            }
          >
            {copy.resend}
          </Button>
        ) : null}
      </section>
      {context.permissions.includes("orders.note") ? (
        <section className="mo-secondary" aria-labelledby="order-notes">
          <h2 id="order-notes">{copy.notes}</h2>
          {notesOpen ? (
            <PrivateNotes
              api={api}
              detail={detail}
              locale={locale}
              busy={busy}
              onMutation={onMutation}
              onClose={closeNotes}
            />
          ) : (
            <Button
              type="button"
              ref={notesButton}
              variant="secondary"
              data-notes-open
              disabled={busy}
              onClick={() => setNotesOpen(true)}
            >
              {copy.openNotes} ·{" "}
              {new Intl.NumberFormat(locale).format(detail.notes.length)}
            </Button>
          )}
        </section>
      ) : null}
    </div>
  );
}
