"use client";
import { useEffect, useRef, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { FinanceApi, FinanceCommand, FinanceList } from "./api";
import { financeCopy } from "./copy";
import { financeStatus } from "./labels";
import { FinanceMoney } from "./money";
import "./finance.css";
export function FinanceListView({
  api,
  locale,
  onSelect,
  busy,
}: {
  api: FinanceApi;
  locale: SupportedLocale;
  onSelect: (orderId: string) => void;
  busy: boolean;
}) {
  const copy = financeCopy(locale);
  const [filters, setFilters] = useState<FinanceCommand<"LIST">>({
    page: 1,
    pageSize: 12,
    query: "",
    filter: "ALL",
  });
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState(filters.filter);
  const [list, setList] = useState<FinanceList | null>(null),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(false);
    void api
      .list(filters)
      .then((result) => {
        if (!canceled) setList(result);
      })
      .catch(() => {
        if (!canceled) {
          setError(true);
          setList(null);
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [api, filters, refresh]);
  useEffect(() => {
    heading.current?.focus();
  }, [filters.page]);
  return (
    <section data-finance-list aria-busy={busy || loading}>
      <div className="mo-section-heading">
        <h2 ref={heading} tabIndex={-1}>
          {copy.reconciliation}
        </h2>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {copy.reload}
        </Button>
      </div>
      <form
        className="mf-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters((value) => ({
            ...value,
            page: 1,
            query: query.trim(),
            filter,
          }));
        }}
      >
        <label className="mc-field">
          <span>{copy.search}</span>
          <input
            type="search"
            data-finance-search
            maxLength={80}
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label className="mc-field">
          <span>{copy.filter}</span>
          <select
            data-finance-filter
            value={filter}
            disabled={busy}
            onChange={(event) =>
              setFilter(event.currentTarget.value as typeof filter)
            }
          >
            <option value="ALL">{copy.all}</option>
            <option value="NEEDS_RECONCILIATION">{copy.needsReview}</option>
            <option value="REFUNDS">{copy.refunds}</option>
            <option value="DISPUTES">{copy.disputes}</option>
          </select>
        </label>
        <Button type="submit" disabled={busy || loading}>
          {copy.search}
        </Button>
      </form>
      {error ? (
        <p className="mc-error-state" role="alert">
          {copy.unavailable}
        </p>
      ) : loading ? (
        <p role="status">{copy.loading}</p>
      ) : list ? (
        <>
          {list.items.length ? (
            <ul className="mo-order-list">
              {list.items.map((order) => (
                <li key={order.orderId}>
                  <button
                    type="button"
                    className="mo-order-row"
                    data-finance-order={order.orderId}
                    disabled={busy}
                    onClick={() => onSelect(order.orderId)}
                  >
                    <strong>{order.publicOrderNo}</strong>
                    <span>
                      {financeStatus(order.paymentStatus, copy)}
                      {order.disputeStatus !== "NONE"
                        ? ` · ${copy.disputes}: ${financeStatus(order.disputeStatus, copy)}`
                        : ""}
                    </span>
                    <span>
                      {copy.available}:{" "}
                      <FinanceMoney
                        amount={order.availableRefundAmountMinor}
                        currency={order.currency}
                        locale={locale}
                      />
                    </span>
                    <span>
                      {order.needsReconciliation ? copy.needsReview : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mc-empty">{copy.empty}</p>
          )}
          <nav className="mc-pagination" aria-label={copy.reconciliation}>
            <Button
              type="button"
              variant="secondary"
              data-finance-previous
              disabled={busy || filters.page <= 1}
              onClick={() =>
                setFilters((value) => ({ ...value, page: value.page - 1 }))
              }
            >
              {copy.previous}
            </Button>
            <span>{new Intl.NumberFormat(locale).format(filters.page)}</span>
            <Button
              type="button"
              variant="secondary"
              data-finance-next
              disabled={
                busy || filters.page * filters.pageSize >= list.totalItems
              }
              onClick={() =>
                setFilters((value) => ({ ...value, page: value.page + 1 }))
              }
            >
              {copy.next}
            </Button>
          </nav>
        </>
      ) : null}
    </section>
  );
}
