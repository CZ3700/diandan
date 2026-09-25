"use client";
import { useRef, useState } from "react";
import type {
  PaymentConfigurationAccount,
  PaymentConfigurationDocument,
  PaymentConfigurationChannel,
  PaymentConfigurationRoute,
  SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import { paymentCopy } from "./copy";
import { ChannelFields } from "./channel-fields";
import { RuleFields } from "./rule-fields";
import { readPaymentDocument } from "./editor-model";
export function PaymentEditor({
  initial,
  accounts,
  locale,
  busy,
  save,
  back,
}: {
  initial: PaymentConfigurationDocument | null;
  accounts: PaymentConfigurationAccount[];
  locale: SupportedLocale;
  busy: boolean;
  save: (document: PaymentConfigurationDocument) => void;
  back: () => void;
}) {
  const c = paymentCopy(locale),
    error = useRef<HTMLParagraphElement>(null);
  const [channels, setChannels] = useState<
      { key: string; value: PaymentConfigurationChannel | null }[]
    >(
      () =>
        initial?.channels.map((value) => ({
          key: value.providerAccountId,
          value,
        })) ?? [],
    ),
    [rules, setRules] = useState<
      { key: string; value: PaymentConfigurationRoute | null }[]
    >(
      () =>
        initial?.routes.map((value) => ({ key: value.ruleKey, value })) ?? [],
    ),
    [invalid, setInvalid] = useState(false);
  return (
    <form
      className="mp-editor"
      data-payment-editor
      onSubmit={(event) => {
        event.preventDefault();
        const result = readPaymentDocument(
          new FormData(event.currentTarget),
          channels.length,
          rules.map((r) => r.key),
        );
        setInvalid(!result.success);
        if (result.success) save(result.data);
        else requestAnimationFrame(() => error.current?.focus());
      }}
    >
      <p>{c.draftHint}</p>
      {invalid ? (
        <p ref={error} tabIndex={-1} role="alert">
          {c.invalid}
        </p>
      ) : null}
      <fieldset disabled={busy}>
        <legend>{c.channels}</legend>
        {channels.map((channel, index) => (
          <section className="mp-card" key={channel.key} data-payment-channel>
            <h2>
              {c.account} {index + 1}
            </h2>
            <ChannelFields
              index={index}
              initial={channel.value}
              accounts={accounts}
              locale={locale}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setChannels((values) =>
                  values.filter((v) => v.key !== channel.key),
                )
              }
            >
              {c.remove}
            </Button>
          </section>
        ))}
        <Button
          type="button"
          variant="secondary"
          data-payment-add-channel
          disabled={channels.length >= accounts.length}
          onClick={() =>
            setChannels((values) => [
              ...values,
              { key: crypto.randomUUID(), value: null },
            ])
          }
        >
          {c.addChannel}
        </Button>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>{c.routes}</legend>
        {rules.map((rule, index) => (
          <section className="mp-card" key={rule.key} data-payment-rule>
            <h2>
              {c.rule} {index + 1}
            </h2>
            <RuleFields
              index={index}
              initial={rule.value}
              accounts={accounts}
              locale={locale}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setRules((values) => values.filter((v) => v.key !== rule.key))
              }
            >
              {c.remove}
            </Button>
          </section>
        ))}
        <Button
          type="button"
          variant="secondary"
          data-payment-add-rule
          disabled={rules.length >= 200}
          onClick={() =>
            setRules((values) => [
              ...values,
              { key: crypto.randomUUID(), value: null },
            ])
          }
        >
          {c.addRule}
        </Button>
      </fieldset>
      <div className="mp-actions">
        <Button type="submit" disabled={busy} data-payment-save>
          {c.save}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={back}
        >
          {c.back}
        </Button>
      </div>
    </form>
  );
}
