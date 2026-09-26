import {
  LOCALE_NATIVE_NAMES,
  type OrderAccessDetail,
  type OrderAccessItem,
  type OrderAccessLocale,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Price } from "@fan-support/ui";
import { Media } from "@fan-support/ui/client";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import {
  fanOrderStatus,
  orderItemStatus,
  orderProgressHelp,
} from "./order-status";

type Presentation = Readonly<{ locale: SupportedLocale; copy: StorefrontCopy }>;

function SnapshotLanguages({
  sources,
  locale,
  copy,
}: Presentation & Readonly<{ sources: readonly OrderAccessLocale[] }>) {
  const distinct = sources.filter(
    (source, index) =>
      sources.findIndex(
        (candidate) =>
          candidate.mode === source.mode &&
          candidate.resolvedLocale === source.resolvedLocale,
      ) === index,
  );
  return distinct.map((source) => {
    const key =
      source.mode === "DAILY"
        ? "orderOriginalLanguage"
        : source.fallbackUsed || source.resolvedLocale !== locale
          ? "orderSnapshotLanguage"
          : null;
    return key ? (
      <p
        className="order-language"
        key={`${source.mode}-${source.resolvedLocale}`}
        data-order-content-source={source.mode}
      >
        {formatStorefrontMessage(copy, key, locale, {
          language: LOCALE_NATIVE_NAMES[source.resolvedLocale],
        })}
      </p>
    ) : null;
  });
}

function OrderLine({
  item,
  locale,
  copy,
}: Presentation & Readonly<{ item: OrderAccessItem }>) {
  return (
    <li className="order-line" data-order-line={item.position}>
      <div className="order-gift-image">
        <Media
          src={item.gift.image.url}
          alt={item.gift.image.alt}
          lang={item.gift.image.locale.resolvedLocale}
          width={1}
          height={1}
          fit="contain"
          fallbackLabel={copy.mediaFallback}
        />
      </div>
      <div className="order-line-content">
        <h3 lang={item.gift.locale.resolvedLocale}>{item.gift.title}</h3>
        {item.gift.variantLabel !== null && (
          <p lang={item.gift.locale.resolvedLocale} data-order-variant>
            {item.gift.variantLabel}
          </p>
        )}
        <div className="order-recipient">
          <div className="order-portrait">
            <Media
              src={item.idol.portrait.url}
              alt={item.idol.portrait.alt}
              lang={item.idol.portrait.locale.resolvedLocale}
              width={1}
              height={1}
              fit="contain"
              fallbackLabel={copy.mediaFallback}
            />
          </div>
          <div>
            <p className="order-label">{copy.giftRecipient}</p>
            <p lang={item.idol.locale.resolvedLocale}>
              {item.idol.displayName}
            </p>
          </div>
        </div>
        <dl className="order-line-amounts">
          <div>
            <dt>{copy.checkoutQuantity}</dt>
            <dd data-order-quantity={item.quantity}>
              {new Intl.NumberFormat(locale).format(item.quantity)}
            </dd>
          </div>
          <div>
            <dt>{copy.orderUnitPrice}</dt>
            <dd>
              <Price
                locale={locale}
                currency={item.currency}
                amountMinor={item.unitAmountMinor}
              />
            </dd>
          </div>
          <div>
            <dt>{copy.orderItemTotal}</dt>
            <dd>
              <Price
                locale={locale}
                currency={item.currency}
                amountMinor={item.lineTotalMinor}
              />
            </dd>
          </div>
        </dl>
        <p
          className="order-line-status"
          data-order-item-status={item.fulfillmentStatus}
          data-order-item-kind={item.giftKind ?? undefined}
        >
          {orderItemStatus(item, copy)}
        </p>
        <div className="order-languages">
          <SnapshotLanguages
            sources={[
              item.idol.locale,
              item.gift.locale,
              item.idol.portrait.locale,
              item.gift.image.locale,
            ]}
            locale={locale}
            copy={copy}
          />
        </div>
      </div>
    </li>
  );
}

/** Render only the authorized historical read model; never fetch current catalog content. */
export function OrderDetail({
  order,
  locale,
  copy,
}: Presentation & Readonly<{ order: OrderAccessDetail }>) {
  const amount = order.amount;
  const help = orderProgressHelp(order, copy);
  const status = fanOrderStatus(order, copy);
  return (
    <div className="order-detail" data-order-detail>
      <dl className="order-metadata">
        <div>
          <dt>{copy.orderIdLabel}</dt>
          <dd data-order-number>
            <bdi>{order.publicOrderNo}</bdi>
          </dd>
        </div>
        <div>
          <dt>{copy.orderCreated}</dt>
          <dd>
            <time dateTime={order.createdAt}>
              {new Intl.DateTimeFormat(locale, {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "UTC",
                timeZoneName: "short",
              }).format(new Date(order.createdAt))}
            </time>
          </dd>
        </div>
      </dl>
      <div className="order-layout">
        <section className="order-gifts">
          <h2>{copy.orderItems}</h2>
          <ol className="order-lines">
            {order.items.map((item) => (
              <OrderLine
                key={item.position}
                item={item}
                locale={locale}
                copy={copy}
              />
            ))}
          </ol>
          <p className="order-history-help">{copy.orderHistoryHelp}</p>
        </section>
        <div className="order-sidebar">
          <section
            className="order-progress"
            data-order-timeline
            data-order-stage={status.stage}
            data-order-order-status={order.orderStatus}
            data-order-payment-status={order.paymentStatus}
            data-order-fulfillment-status={order.fulfillmentStatus}
            data-order-dispute-status={order.disputeStatus}
          >
            <h2>{copy.orderProgress}</h2>
            {status.timeline.length > 0 ? (
              <ol className="order-steps">
                {status.timeline.map((step) => (
                  <li
                    key={step.step}
                    data-order-step={step.step}
                    data-step-state={step.state}
                    aria-current={step.state === "CURRENT" ? "step" : undefined}
                  >
                    {step.label}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="order-stage" data-order-stage-label>
                {status.label}
              </p>
            )}
            {status.note && (
              <p className="order-progress-note" data-order-note>
                {status.note}
              </p>
            )}
            {help && <p className="order-progress-help">{help}</p>}
          </section>
          <section className="order-summary">
            <h2>{copy.orderSummary}</h2>
            <dl className="order-totals">
              {(
                [
                  [copy.checkoutSubtotal, amount.subtotalMinor],
                  [copy.checkoutTax, amount.taxAmountMinor],
                  [copy.checkoutShipping, amount.shippingAmountMinor],
                  [copy.checkoutFees, amount.feeAmountMinor],
                  [copy.checkoutDiscount, amount.discountAmountMinor],
                ] as const
              )
                .filter(([, value], index) => index === 0 || value > 0)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      <Price
                        locale={locale}
                        currency={amount.currency}
                        amountMinor={value}
                      />
                    </dd>
                  </div>
                ))}
              <div className="order-total">
                <dt>{copy.cartTotal}</dt>
                <dd data-order-total>
                  <Price
                    locale={locale}
                    currency={amount.currency}
                    amountMinor={amount.totalAmountMinor}
                  />
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
