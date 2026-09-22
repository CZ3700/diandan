"use client";
import { useState } from "react";
import {
  adminExceptionsCommandSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { ExceptionsDetail, ExceptionMutation } from "./api";
import { exceptionsCopy } from "./copy";
import { actionLabel, categoryLabel, nextStep, statusLabel } from "./labels";
export function ExceptionDetailView({
  detail,
  locale,
  busy,
  mutate,
}: {
  detail: ExceptionsDetail;
  locale: SupportedLocale;
  busy: boolean;
  mutate: (command: ExceptionMutation) => void;
}) {
  const c = exceptionsCopy(locale),
    item = detail.item;
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  return (
    <div data-exceptions-detail>
      <h2>{categoryLabel(item.target.kind, c)}</h2>
      <dl className="me-facts">
        <div>
          <dt>{c.status}</dt>
          <dd>{statusLabel(item.status, c)}</dd>
        </div>
        {item.publicOrderId ? (
          <div>
            <dt>{c.order}</dt>
            <dd>{item.publicOrderId}</dd>
          </div>
        ) : null}
        <div>
          <dt>{c.attempts}</dt>
          <dd>{new Intl.NumberFormat(locale).format(item.attemptCount)}</dd>
        </div>
        <div>
          <dt>{c.updated}</dt>
          <dd>
            <time dateTime={item.updatedAt}>{date(item.updatedAt)}</time>
          </dd>
        </div>
      </dl>
      <section className="me-section">
        <h2>{c.nextStep}</h2>
        <p data-exceptions-next-step>{nextStep(item, c)}</p>
        {item.allowedAction ? (
          <form
            className="me-action"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !confirmed || !reason) return;
              const command = adminExceptionsCommandSchema.parse({
                schemaVersion: 1,
                action: item.allowedAction,
                target: item.target,
                expectedVersion: item.version,
                reasonCode: reason,
                confirmed: true,
                idempotencyKey: crypto.randomUUID(),
              });
              if (!("idempotencyKey" in command)) return;
              const {
                schemaVersion: _version,
                idempotencyKey: _key,
                ...draft
              } = command;
              void _version;
              void _key;
              mutate(draft);
            }}
          >
            <label className="mc-field">
              <span>{c.reason}</span>
              <select
                required
                value={reason}
                disabled={busy}
                data-exceptions-reason
                onChange={(event) => setReason(event.currentTarget.value)}
              >
                <option value="">{c.chooseReason}</option>
                <option value="RETRY_AFTER_REPAIR">{c.retryRepair}</option>
                <option value="VERIFY_PROVIDER_STATUS">{c.verifyStatus}</option>
                <option value="RETRY_FAILED_NOTIFICATION">
                  {c.retryNotificationReason}
                </option>
                <option value="OPERATOR_REVIEW">{c.reviewReason}</option>
              </select>
            </label>
            <label className="me-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                data-exceptions-confirm
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
              />
              <span>{c.confirm}</span>
            </label>
            <Button
              type="submit"
              disabled={busy || !confirmed || !reason}
              data-exceptions-submit
            >
              {actionLabel(item.allowedAction, c)}
            </Button>
          </form>
        ) : null}
      </section>
      <section className="me-section">
        <h2>{c.history}</h2>
        {detail.operations.length ? (
          <ol className="me-history">
            {detail.operations.map((op) => (
              <li key={op.operationId}>
                <strong>{actionLabel(op.action, c)}</strong>
                <span>{statusLabel(op.status, c)}</span>
                <time dateTime={op.createdAt}>{date(op.createdAt)}</time>
              </li>
            ))}
          </ol>
        ) : (
          <p>{c.noHistory}</p>
        )}
      </section>
    </div>
  );
}
