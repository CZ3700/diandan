import type {
  PaymentConfigurationAccount,
  PaymentConfigurationDiff,
  SupportedLocale,
} from "@fan-support/contracts";
import { paymentCopy } from "./copy";
import { languageName } from "./labels";
type DiffValue = NonNullable<PaymentConfigurationDiff["values"]>[number];
export function PaymentDiffValue({
  value,
  field,
  accounts,
  locale,
}: {
  value: DiffValue["before"];
  field: DiffValue["field"];
  accounts: PaymentConfigurationAccount[];
  locale: SupportedLocale;
}) {
  const c = paymentCopy(locale),
    number = new Intl.NumberFormat(locale);
  if (value === null) return <span>{c.notRecorded}</span>;
  if (typeof value === "boolean")
    return <span>{value ? c.enabled : c.unavailable}</span>;
  if (typeof value === "number")
    return (
      <span>
        {number.format(field === "rolloutBasisPoints" ? value / 100 : value)}
        {field === "rolloutBasisPoints" ? "%" : ""}
      </span>
    );
  if (typeof value === "string")
    return (
      <span>
        {field === "providerAccountId"
          ? (accounts.find((account) => account.providerAccountId === value)
              ?.displayLabel ?? c.account)
          : value}
      </span>
    );
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((item, index) =>
          typeof item === "string" ? (
            <li key={index}>{item}</li>
          ) : (
            <li key={item.locale}>
              <strong>{languageName(item.locale, locale)}</strong>
              <div lang={item.locale}>
                {item.displayName}
                <p>{item.customerHint}</p>
              </div>
            </li>
          ),
        )}
      </ul>
    );
  return (
    <dl>
      <dt>{c.failures}</dt>
      <dd>{number.format(value.failureThreshold)}</dd>
      <dt>{c.window}</dt>
      <dd>{number.format(value.failureWindowMs / 1000)}</dd>
      <dt>{c.openDuration}</dt>
      <dd>{number.format(value.openDurationMs / 1000)}</dd>
      <dt>{c.probeLease}</dt>
      <dd>{number.format(value.probeLeaseMs / 1000)}</dd>
      <dt>{c.probeRetry}</dt>
      <dd>{number.format(value.probeRetryMs / 1000)}</dd>
    </dl>
  );
}
