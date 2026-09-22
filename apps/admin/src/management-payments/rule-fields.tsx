"use client";
import { useState } from "react";
import type {
  PaymentConfigurationAccount,
  PaymentConfigurationRoute,
  SupportedLocale,
} from "@fan-support/contracts";
import { paymentCopy } from "./copy";
export function RuleFields({
  index,
  initial,
  accounts,
  locale,
}: {
  index: number;
  initial: PaymentConfigurationRoute | null;
  accounts: PaymentConfigurationAccount[];
  locale: SupportedLocale;
}) {
  const c = paymentCopy(locale),
    p = `r${index}`;
  const [account, setAccount] = useState(initial?.providerAccountId ?? ""),
    [countries, setCountries] = useState(initial?.countries.join(", ") ?? ""),
    [currencies, setCurrencies] = useState(
      initial?.currencies.join(", ") ?? "",
    ),
    [min, setMin] = useState(String(initial?.minimumAmountMinor ?? "")),
    [max, setMax] = useState(String(initial?.maximumAmountMinor ?? ""));
  const methods =
    accounts.find((a) => a.providerAccountId === account)?.paymentMethods ?? [];
  const countriesPreview = countries
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter((v) => /^[A-Z]{2}$/.test(v))
    .map((v) => new Intl.DisplayNames([locale], { type: "region" }).of(v) ?? v)
    .join(", ");
  const amounts = currencies
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter((v) => /^[A-Z]{3}$/.test(v))
    .map((currency) => {
      try {
        const format = new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
        });
        const scale =
          10 ** (format.resolvedOptions().maximumFractionDigits ?? 2);
        return /^\d+$/.test(min) && /^\d+$/.test(max)
          ? `${format.format(Number(min) / scale)} – ${format.format(Number(max) / scale)}`
          : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return (
    <>
      <div className="mp-grid">
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
        <label>
          {c.method}
          <select
            key={account}
            name={`${p}.method`}
            required
            defaultValue={
              account === initial?.providerAccountId
                ? initial.paymentMethod
                : ""
            }
          >
            <option value="">{c.method}</option>
            {methods.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </label>
        <label className="mp-check">
          <input
            type="checkbox"
            name={`${p}.enabled`}
            defaultChecked={initial?.enabled ?? false}
          />
          {c.enabled}
        </label>
      </div>
      <p>{c.codesHint}</p>
      <div className="mp-grid">
        <label>
          {c.countries}
          <input
            name={`${p}.countries`}
            value={countries}
            onChange={(event) => setCountries(event.currentTarget.value)}
          />
          {countriesPreview ? <small>{countriesPreview}</small> : null}
        </label>
        <label>
          {c.markets}
          <input
            name={`${p}.markets`}
            defaultValue={initial?.markets.join(", ") ?? ""}
          />
        </label>
        <label>
          {c.currencies}
          <input
            name={`${p}.currencies`}
            value={currencies}
            onChange={(event) => setCurrencies(event.currentTarget.value)}
          />
        </label>
        <label>
          {c.minimum}
          <input
            type="number"
            name={`${p}.minimum`}
            min="0"
            step="1"
            required
            value={min}
            onChange={(event) => setMin(event.currentTarget.value)}
          />
        </label>
        <label>
          {c.maximum}
          <input
            type="number"
            name={`${p}.maximum`}
            min="0"
            step="1"
            required
            value={max}
            onChange={(event) => setMax(event.currentTarget.value)}
          />
        </label>
        <label>
          {c.priority}
          <input
            type="number"
            name={`${p}.priority`}
            step="1"
            min="-2147483648"
            max="2147483647"
            required
            defaultValue={initial?.priority ?? 0}
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
      <p>{c.amountHint}</p>
      {amounts.map((amount) => (
        <p key={amount}>{amount}</p>
      ))}
      <fieldset>
        <legend>{c.devices}</legend>
        {(
          [
            { value: "REDIRECT", label: c.redirect },
            { value: "PROVIDER_HOSTED_IFRAME", label: c.iframe },
            { value: "PROVIDER_COMPONENT", label: c.component },
            { value: "QR_CODE", label: c.qr },
          ] as const
        ).map((device) => (
          <label className="mp-check" key={device.value}>
            <input
              type="checkbox"
              name={`${p}.devices`}
              value={device.value}
              defaultChecked={
                initial?.requiredDeviceCapabilities.includes(device.value) ??
                false
              }
            />
            {device.label}
          </label>
        ))}
      </fieldset>
    </>
  );
}
