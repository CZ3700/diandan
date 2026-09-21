"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Button, Icon } from "@fan-support/ui";
import { managementCopy } from "../management-center/copy";
import { AdminClientError } from "../workspace/client";
import type {
  OrdersApi,
  OrdersContext,
  OrdersDetail,
  OrdersFilters,
  OrdersList,
} from "./api";
import { ordersCopy } from "./copy";
import { ordersError } from "./labels";
import { OrdersListView } from "./list-view";
import { OrdersDetailView, type MutationRunner } from "./detail-view";
import type { FinanceApi } from "../management-finance/api";
import { FinanceListView } from "../management-finance/list-view";
import { financeCopy } from "../management-finance/copy";
import "./orders.css";
const initialFilters: OrdersFilters = {
  page: 1,
  pageSize: 12,
  query: "",
  fulfillment: "ALL",
  moderation: "ALL",
};
export function OrdersWorkspace({
  api,
  financeApi,
  context,
  locale,
  onBusy,
}: {
  api: OrdersApi;
  financeApi?: FinanceApi | undefined;
  context: OrdersContext;
  locale: SupportedLocale;
  onBusy: (busy: boolean) => void;
}) {
  const copy = ordersCopy(locale),
    common = managementCopy(locale);
  const [filters, setFilters] = useState(initialFilters),
    [selected, setSelected] = useState<string | null>(null);
  const [financeView, setFinanceView] = useState(false);
  const [list, setList] = useState<OrdersList | null>(null),
    [detail, setDetail] = useState<OrdersDetail | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<unknown>(null),
    [success, setSuccess] = useState<"SAVED" | "QUEUED" | null>(null);
  const active = useRef(false),
    title = useRef<HTMLHeadingElement>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    const work = selected
      ? api.detail(selected).then((value) => {
          if (!canceled) setDetail(value);
        })
      : api.list(filters).then((value) => {
          if (!canceled) setList(value);
        });
    void work
      .catch((failure) => {
        if (!canceled) setError(failure);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [api, selected, filters, refresh]);
  useEffect(() => {
    title.current?.focus();
  }, [selected, filters.page]);
  const mutate: MutationRunner = useCallback(
    async (work, notice = "SAVED") => {
      if (active.current) return false;
      active.current = true;
      setBusy(true);
      onBusy(true);
      setError(null);
      setSuccess(null);
      try {
        await work();
        if (mounted.current) {
          setSuccess(notice);
          setRefresh((value) => value + 1);
        }
        return true;
      } catch (failure) {
        if (mounted.current) {
          setError(failure);
          if (
            failure instanceof AdminClientError &&
            [
              "FORBIDDEN",
              "UNAUTHENTICATED",
              "CSRF_INVALID",
              "PRIVATE_ACCESS_EXPIRED",
            ].includes(failure.code)
          )
            setDetail(null);
        }
        return false;
      } finally {
        active.current = false;
        if (mounted.current) {
          setBusy(false);
          onBusy(false);
        }
      }
    },
    [onBusy],
  );
  const financeBusy = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusy(value);
    },
    [onBusy],
  );
  return (
    <section data-orders-workspace aria-busy={loading || busy}>
      <header className="mc-workspace-header">
        <div>
          {selected ? (
            <button
              className="mc-back"
              type="button"
              disabled={busy}
              data-orders-back
              onClick={() => {
                setSelected(null);
                setSuccess(null);
              }}
            >
              <Icon name="arrow-left" decorative />
              {common.back}
            </button>
          ) : null}
          <h1 ref={title} tabIndex={-1}>
            {detail?.order.publicOrderId ?? copy.orders}
          </h1>
        </div>
        <Button
          type="button"
          variant="secondary"
          data-orders-reload
          disabled={busy || loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {common.reloadList}
        </Button>
      </header>
      {!selected && financeApi ? (
        <div className="mo-actions" role="group" aria-label={copy.orders}>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            aria-pressed={!financeView}
            onClick={() => setFinanceView(false)}
          >
            {copy.orders}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            data-finance-navigation
            aria-pressed={financeView}
            onClick={() => setFinanceView(true)}
          >
            {financeCopy(locale).reconciliation}
          </Button>
        </div>
      ) : null}
      {success ? (
        <p className="mc-success" role="status" data-orders-success>
          {success === "QUEUED" ? copy.queued : copy.saved}
        </p>
      ) : null}
      {error ? (
        <div className="mc-error-state" role="alert">
          <p>{ordersError(error, copy)}</p>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {common.reloadList}
          </Button>
        </div>
      ) : null}
      {loading ? (
        <p className="mc-empty" role="status">
          {copy.loading}
        </p>
      ) : selected ? (
        detail ? (
          <OrdersDetailView
            key={`${detail.orderId}-${detail.version}`}
            api={api}
            locale={locale}
            detail={detail}
            context={context}
            busy={busy}
            onMutation={mutate}
            onReload={() => setRefresh((value) => value + 1)}
            financeApi={financeApi}
            onFinanceBusy={financeBusy}
          />
        ) : null
      ) : financeView && financeApi ? (
        <FinanceListView
          api={financeApi}
          locale={locale}
          busy={busy}
          onSelect={setSelected}
        />
      ) : list ? (
        <OrdersListView
          key={JSON.stringify(filters)}
          locale={locale}
          list={list}
          filters={filters}
          busy={busy}
          onFilters={(next) => {
            setSuccess(null);
            setFilters(next);
          }}
          onPage={(page) => setFilters((value) => ({ ...value, page }))}
          onSelect={(id) => {
            setSuccess(null);
            setSelected(id);
          }}
        />
      ) : null}
    </section>
  );
}
