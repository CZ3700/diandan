import type {
  PaymentConfigurationAccount,
  PaymentConfigurationDocument,
  SupportedLocale,
} from "@fan-support/contracts";
import { paymentCopy } from "./copy";
export function ConfigurationSummary({
  configuration,
  accounts,
  locale,
}: {
  configuration: PaymentConfigurationDocument;
  accounts: PaymentConfigurationAccount[];
  locale: SupportedLocale;
}) {
  const c = paymentCopy(locale),
    number = new Intl.NumberFormat(locale);
  const accountName = (id: string) =>
    accounts.find((a) => a.providerAccountId === id)?.displayLabel ?? c.account;
  return (
    <>
      <section className="mp-section">
        <h2>{c.channels}</h2>
        <div className="mp-grid">
          {configuration.channels.map((channel) => (
            <article key={channel.providerAccountId} className="mp-card">
              <h3>{accountName(channel.providerAccountId)}</h3>
              <label className="mp-check">
                <input
                  type="checkbox"
                  checked={channel.enabled}
                  readOnly
                  disabled
                />
                {c.enabled}
              </label>
              <dl>
                <dt>{c.rollout}</dt>
                <dd>{number.format(channel.rolloutBasisPoints / 100)}%</dd>
                <dt>{c.order}</dt>
                <dd>{number.format(channel.displayOrder)}</dd>
              </dl>
              <details>
                <summary>{c.health}</summary>
                <dl>
                  <dt>{c.failures}</dt>
                  <dd>
                    {number.format(channel.healthPolicy.failureThreshold)}
                  </dd>
                  <dt>{c.window}</dt>
                  <dd>
                    {number.format(channel.healthPolicy.failureWindowMs / 1000)}
                  </dd>
                  <dt>{c.openDuration}</dt>
                  <dd>
                    {number.format(channel.healthPolicy.openDurationMs / 1000)}
                  </dd>
                  <dt>{c.probeLease}</dt>
                  <dd>
                    {number.format(channel.healthPolicy.probeLeaseMs / 1000)}
                  </dd>
                  <dt>{c.probeRetry}</dt>
                  <dd>
                    {number.format(channel.healthPolicy.probeRetryMs / 1000)}
                  </dd>
                </dl>
              </details>
            </article>
          ))}
        </div>
      </section>
      <section className="mp-section">
        <h2>{c.routes}</h2>
        {configuration.routes.length ? (
          configuration.routes.map((route, index) => (
            <article key={route.ruleKey} className="mp-card">
              <h3>
                {c.rule} {number.format(index + 1)} ·{" "}
                {accountName(route.providerAccountId)}
              </h3>
              <label className="mp-check">
                <input
                  type="checkbox"
                  checked={route.enabled}
                  readOnly
                  disabled
                />
                {c.enabled}
              </label>
              <dl className="mp-rule-summary">
                <div>
                  <dt>{c.method}</dt>
                  <dd>{route.paymentMethod}</dd>
                </div>
                <div>
                  <dt>{c.countries}</dt>
                  <dd>
                    {route.countries
                      .map(
                        (code) =>
                          new Intl.DisplayNames([locale], {
                            type: "region",
                          }).of(code) ?? code,
                      )
                      .join(", ") || c.none}
                  </dd>
                </div>
                <div>
                  <dt>{c.markets}</dt>
                  <dd>{route.markets.join(", ") || c.none}</dd>
                </div>
                <div>
                  <dt>{c.currencies}</dt>
                  <dd>{route.currencies.join(", ") || c.none}</dd>
                </div>
                <div>
                  <dt>{c.minimum}</dt>
                  <dd>{number.format(route.minimumAmountMinor)}</dd>
                </div>
                <div>
                  <dt>{c.maximum}</dt>
                  <dd>{number.format(route.maximumAmountMinor)}</dd>
                </div>
                <div>
                  <dt>{c.priority}</dt>
                  <dd>{number.format(route.priority)}</dd>
                </div>
                <div>
                  <dt>{c.rollout}</dt>
                  <dd>{number.format(route.rolloutBasisPoints / 100)}%</dd>
                </div>
                <div>
                  <dt>{c.devices}</dt>
                  <dd>
                    {route.requiredDeviceCapabilities
                      .map(
                        (device) =>
                          ({
                            REDIRECT: c.redirect,
                            PROVIDER_HOSTED_IFRAME: c.iframe,
                            PROVIDER_COMPONENT: c.component,
                            QR_CODE: c.qr,
                          })[device],
                      )
                      .join(", ") || c.none}
                  </dd>
                </div>
              </dl>
            </article>
          ))
        ) : (
          <p>{c.emptyRoutes}</p>
        )}
      </section>
    </>
  );
}
