"use client";
import { useState } from "react";
import {
  SUPPORTED_LOCALES,
  type PaymentConfigurationAccount,
  type PaymentConfigurationChannel,
  type SupportedLocale,
} from "@fan-support/contracts";
import { paymentCopy } from "./copy";
import { languageName } from "./labels";
export function ChannelFields({
  index,
  initial,
  accounts,
  locale,
}: {
  index: number;
  initial: PaymentConfigurationChannel | null;
  accounts: PaymentConfigurationAccount[];
  locale: SupportedLocale;
}) {
  const c = paymentCopy(locale),
    p = `c${index}`;
  const [account, setAccount] = useState(initial?.providerAccountId ?? ""),
    [language, setLanguage] = useState<SupportedLocale>(locale);
  const connected = accounts.find((a) => a.providerAccountId === account);
  const policy =
    account === initial?.providerAccountId
      ? initial.healthPolicy
      : connected?.healthPolicy;
  const health = [
    { key: "failureThreshold", label: c.failures, max: 100, scale: 1 },
    { key: "failureWindowMs", label: c.window, max: 3600, scale: 1000 },
    { key: "openDurationMs", label: c.openDuration, max: 86400, scale: 1000 },
    { key: "probeLeaseMs", label: c.probeLease, max: 120, scale: 1000 },
    { key: "probeRetryMs", label: c.probeRetry, max: 86400, scale: 1000 },
  ] as const;
  return (
    <>
      <label>
        {c.account}
        <select
          name={`${p}.account`}
          required
          value={account}
          onChange={(event) => setAccount(event.currentTarget.value)}
        >
          <option value="">{c.account}</option>
          {accounts.map((a) => (
            <option key={a.providerAccountId} value={a.providerAccountId}>
              {a.displayLabel} · {a.environment}
            </option>
          ))}
        </select>
      </label>
      {connected ? (
        <p>
          {c.channelStatus}:{" "}
          {connected.deployed &&
          connected.accountStatus === "ACTIVE" &&
          connected.healthStatus === "HEALTHY"
            ? c.available
            : c.unavailable}
        </p>
      ) : null}
      <div className="mp-grid">
        <label className="mp-check">
          <input
            type="checkbox"
            name={`${p}.enabled`}
            defaultChecked={initial?.enabled ?? false}
          />
          {c.enabled}
        </label>
        <label>
          {c.order}
          <input
            type="number"
            name={`${p}.order`}
            min="0"
            max="2147483647"
            step="1"
            required
            defaultValue={initial?.displayOrder ?? index}
          />
        </label>
        <label>
          {c.rollout}
          <input
            type="number"
            name={`${p}.rollout`}
            min="0"
            max="100"
            step="0.01"
            required
            defaultValue={(initial?.rolloutBasisPoints ?? 0) / 100}
          />
        </label>
      </div>
      <details open={!policy}>
        <summary>{c.health}</summary>
        <p>{c.healthHint}</p>
        <div className="mp-grid" key={account}>
          {health.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                type="number"
                name={`${p}.${field.key}`}
                min="1"
                max={field.max}
                step={field.scale === 1 ? "1" : "0.001"}
                required
                defaultValue={policy ? policy[field.key] / field.scale : ""}
              />
            </label>
          ))}
        </div>
      </details>
      <div className="mp-copy-editor">
        <label>
          {c.language}
          <select
            value={language}
            onChange={(event) =>
              setLanguage(event.currentTarget.value as SupportedLocale)
            }
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {languageName(l, locale)}
              </option>
            ))}
          </select>
        </label>
        {SUPPORTED_LOCALES.map((l) => {
          const existing = initial?.translations.find((t) => t.locale === l);
          return (
            <div key={l} hidden={language !== l} lang={l} data-payment-text={l}>
              <label>
                {c.name} · {languageName(l, locale)}
                <input
                  name={`${p}.${l}.name`}
                  maxLength={80}
                  defaultValue={existing?.displayName ?? ""}
                />
              </label>
              <label>
                {c.hint} · {languageName(l, locale)}
                <textarea
                  name={`${p}.${l}.hint`}
                  maxLength={280}
                  rows={3}
                  defaultValue={existing?.customerHint ?? ""}
                />
              </label>
            </div>
          );
        })}
      </div>
    </>
  );
}
