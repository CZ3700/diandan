import { useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Button, Price } from "@fan-support/ui";
import { managementCopy } from "../management-center/copy";
import type { OrdersFilters, OrdersList } from "./api";
import { ordersCopy } from "./copy";
import { orderStatusLabel } from "./labels";
export function OrdersListView({
  locale,
  list,
  filters,
  busy,
  onFilters,
  onSelect,
  onPage,
}: {
  locale: SupportedLocale;
  list: OrdersList;
  filters: OrdersFilters;
  busy: boolean;
  onFilters: (filters: OrdersFilters) => void;
  onSelect: (orderId: string) => void;
  onPage: (page: number) => void;
}) {
  const copy = ordersCopy(locale),
    common = managementCopy(locale);
  const [draft, setDraft] = useState(filters);
  const pages = Math.min(
    10000,
    Math.max(1, Math.ceil(list.totalItems / list.pageSize)),
  );
  return (
    <section data-orders-list>
      <form
        className="mo-filters"
        onSubmit={(event) => {
          event.preventDefault();
          onFilters({ ...draft, page: 1 });
        }}
      >
        <label className="mc-field">
          <span>{copy.searchOrders}</span>
          <input
            data-orders-search
            type="search"
            value={draft.query}
            maxLength={80}
            disabled={busy}
            onChange={(event) =>
              setDraft({ ...draft, query: event.currentTarget.value })
            }
          />
        </label>
        <label className="mc-field">
          <span>{copy.status}</span>
          <select
            data-orders-fulfillment
            value={draft.fulfillment}
            disabled={busy}
            onChange={(event) =>
              setDraft({
                ...draft,
                fulfillment: event.currentTarget
                  .value as OrdersFilters["fulfillment"],
              })
            }
          >
            <option value="ALL">{copy.allOrders}</option>
            {(
              [
                "PENDING",
                "PREPARING",
                "DELIVERED",
                "ON_HOLD",
                "CANCELED",
              ] as const
            ).map((status) => (
              <option value={status} key={status}>
                {orderStatusLabel(status, copy)}
              </option>
            ))}
          </select>
        </label>
        <label className="mc-field">
          <span>{copy.reviewFilter}</span>
          <select
            data-orders-moderation
            value={draft.moderation}
            disabled={busy}
            onChange={(event) =>
              setDraft({
                ...draft,
                moderation: event.currentTarget
                  .value as OrdersFilters["moderation"],
              })
            }
          >
            <option value="ALL">{copy.allOrders}</option>
            <option value="NEEDS_REVIEW">{copy.needsReview}</option>
            <option value="REJECTED">{copy.rejected}</option>
          </select>
        </label>
        <Button type="submit" disabled={busy} data-orders-apply>
          {common.search}
        </Button>
      </form>
      {list.items.length === 0 ? (
        <p className="mc-empty" role="status">
          {copy.noOrders}
        </p>
      ) : (
        <ul className="mo-order-list">
          {list.items.map((order) => (
            <li key={order.orderId}>
              <button
                className="mo-order-row"
                type="button"
                disabled={busy}
                data-order-id={order.orderId}
                onClick={() => onSelect(order.orderId)}
              >
                <span>
                  <strong>{order.publicOrderNo}</strong>
                  <span className="mc-item-meta">
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(order.createdAt))}
                  </span>
                </span>
                <span>
                  {orderStatusLabel(order.fulfillmentStatus, copy)}
                  <span className="mc-item-meta">
                    {order.paymentStatus === "PENDING"
                      ? copy.paymentPending
                      : orderStatusLabel(order.paymentStatus, copy)}
                  </span>
                </span>
                <span>
                  {order.pendingReviewCount > 0 ? (
                    <span className="mo-review-count">
                      {copy.reviewCount} ·{" "}
                      {new Intl.NumberFormat(locale).format(
                        order.pendingReviewCount,
                      )}
                    </span>
                  ) : null}
                </span>
                <Price
                  locale={locale}
                  currency={order.currency}
                  amountMinor={order.totalAmountMinor}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 ? (
        <nav className="mc-pagination" aria-label={copy.orders}>
          <Button
            type="button"
            variant="secondary"
            data-orders-previous
            disabled={busy || list.page <= 1}
            onClick={() => onPage(list.page - 1)}
          >
            {common.previous}
          </Button>
          <span>
            {new Intl.NumberFormat(locale).format(list.page)} /{" "}
            {new Intl.NumberFormat(locale).format(pages)}
          </span>
          <Button
            type="button"
            variant="secondary"
            data-orders-next
            disabled={busy || list.page >= pages}
            onClick={() => onPage(list.page + 1)}
          >
            {common.next}
          </Button>
        </nav>
      ) : null}
    </section>
  );
}
