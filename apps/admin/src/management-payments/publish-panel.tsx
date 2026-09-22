"use client";
import { useState } from "react";
import type {
  SupportedLocale,
  PaymentConfigurationAccount,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { PaymentValidation, PaymentMutation } from "./api";
import { PaymentDiffValue } from "./diff-values";
import { paymentCopy } from "./copy";
import { issueLabel, languageName } from "./labels";
export function PaymentPublishPanel({
  validation,
  locale,
  accounts,
  canPublish,
  busy,
  mutate,
}: {
  validation: PaymentValidation;
  locale: SupportedLocale;
  accounts: PaymentConfigurationAccount[];
  canPublish: boolean;
  busy: boolean;
  mutate: (command: PaymentMutation) => void;
}) {
  const c = paymentCopy(locale),
    [confirmed, setConfirmed] = useState(false),
    [reason, setReason] = useState("OPERATIONS_UPDATE");
  const labels: Record<string, string> = {
    enabled: c.enabled,
    displayOrder: c.order,
    rolloutBasisPoints: c.rollout,
    healthPolicy: c.health,
    translations: c.text,
    providerAccountId: c.account,
    paymentMethod: c.method,
    countries: c.countries,
    markets: c.markets,
    currencies: c.currencies,
    minimumAmountMinor: c.minimum,
    maximumAmountMinor: c.maximum,
    requiredDeviceCapabilities: c.devices,
    priority: c.priority,
  };
  return (
    <section className="mp-section" data-payment-validation tabIndex={-1}>
      <h2>{c.changes}</h2>
      <p role="status">{validation.valid ? c.ready : c.validationFailed}</p>
      {validation.issues.length ? (
        <ul className="mp-issues">
          {validation.issues.map((issue, index) => (
            <li key={index}>
              {issueLabel(issue.code, locale)}{" "}
              {issue.providerAccountId
                ? accounts.find(
                    (a) => a.providerAccountId === issue.providerAccountId,
                  )?.displayLabel
                : null}{" "}
              {issue.locale ? languageName(issue.locale, locale) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {validation.diff.length ? (
        <ul>
          {validation.diff.map((diff, index) => (
            <li key={index}>
              <strong>
                {diff.kind === "CHANNEL"
                  ? (accounts.find((a) => a.providerAccountId === diff.key)
                      ?.displayLabel ?? c.channels)
                  : `${c.rule} ${index + 1}`}
              </strong>{" "}
              ·{" "}
              {diff.change === "ADDED"
                ? c.added
                : diff.change === "REMOVED"
                  ? c.removed
                  : c.changed}
              {diff.fields.length
                ? `: ${diff.fields.map((f) => labels[f]).join(", ")}`
                : null}
              {diff.values?.map((value) => (
                <section key={value.field} className="mp-diff-field">
                  <h3>{labels[value.field]}</h3>
                  <div className="mp-grid">
                    <div>
                      <strong>{c.before}</strong>
                      <PaymentDiffValue
                        value={value.before}
                        field={value.field}
                        accounts={accounts}
                        locale={locale}
                      />
                    </div>
                    <div>
                      <strong>{c.after}</strong>
                      <PaymentDiffValue
                        value={value.after}
                        field={value.field}
                        accounts={accounts}
                        locale={locale}
                      />
                    </div>
                  </div>
                </section>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p>{c.noChanges}</p>
      )}
      <p>{c.publishHint}</p>
      {validation.valid && validation.validationHash && canPublish ? (
        <form
          data-payment-confirm-publication
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmed && validation.validationHash)
              mutate({
                action: validation.mode,
                revisionId: validation.revisionId,
                expectedPublicationId: validation.expectedPublicationId,
                validationHash: validation.validationHash,
                reasonCode: reason,
                confirmed: true,
              });
          }}
        >
          <label>
            {c.reason}
            <select
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.currentTarget.value)}
            >
              <option value="OPERATIONS_UPDATE">{c.reasonUpdate}</option>
              <option value="INCIDENT_RECOVERY">{c.reasonRecovery}</option>
            </select>
          </label>
          <label className="mp-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
            />
            {c.confirm}
          </label>
          <Button type="submit" disabled={busy || !confirmed}>
            {validation.mode === "PUBLISH" ? c.publish : c.rollback}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
