"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Button, Icon } from "@fan-support/ui";
import type { FinanceApi, FinanceDetail, FinanceDraft } from "./api";
import { financeCopy } from "./copy";
import { financeError, uncertainFinanceResult } from "./labels";
import { FinanceDetailView } from "./detail-view";
import { financeNeedsAttention } from "./model";
import {
  createFinancePendingStore,
  type PendingFinanceRequest,
} from "./pending-store";
import "./finance.css";
export function FinancePanel({
  api,
  orderId,
  actorId,
  locale,
  onBusy,
  onUpdated,
  itemTitles,
  collapsible = false,
}: {
  /** Folded behind its title until opened, or until something here needs a person. */
  collapsible?: boolean;
  api: FinanceApi;
  orderId: string;
  actorId: string;
  locale: SupportedLocale;
  onBusy: (busy: boolean) => void;
  onUpdated: () => void;
  itemTitles?: Readonly<Record<string, string>>;
}) {
  const copy = financeCopy(locale),
    id = useId();
  const [detail, setDetail] = useState<FinanceDetail | null>(null),
    [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [recorded, setRecorded] = useState(false);
  const [pending, setPending] = useState<PendingFinanceRequest | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [open, setOpen] = useState(!collapsible),
    [attended, setAttended] = useState(false);
  // Opens by itself once when attention is needed; the person may fold it again.
  if (
    collapsible &&
    !attended &&
    (financeNeedsAttention(detail, pending !== null) ||
      error !== null ||
      recorded)
  ) {
    setAttended(true);
    setOpen(true);
  }
  const pendingStore = useRef<ReturnType<
    typeof createFinancePendingStore
  > | null>(null);
  const active = useRef(false),
    epoch = useRef(0),
    mounted = useRef(true),
    notice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    try {
      pendingStore.current = createFinancePendingStore(
        window.sessionStorage,
        actorId,
        orderId,
      );
      setPending(pendingStore.current.read());
      setStorageReady(true);
    } catch {
      setStorageReady(false);
    }
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, [actorId, orderId]);
  const load = useCallback(async () => {
    const current = ++epoch.current;
    setLoading(true);
    try {
      const result = await api.detail(orderId);
      if (mounted.current && current === epoch.current) {
        setDetail(result);
        setError(null);
      }
    } catch (failure) {
      if (mounted.current && current === epoch.current) {
        setDetail(null);
        setError(failure);
      }
    } finally {
      if (mounted.current && current === epoch.current) setLoading(false);
    }
  }, [api, orderId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (error || recorded) notice.current?.focus();
  }, [error, recorded]);
  async function run(request: PendingFinanceRequest) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    onBusy(true);
    setError(null);
    setRecorded(false);
    const { command, key } = request;
    try {
      if (command.action === "REFUND") await api.refund(command, key);
      else if (command.action === "CANCEL") await api.cancel(command, key);
      else await api.reconcile(command, key);
      pendingStore.current!.clear(key);
      if (mounted.current) {
        setPending(null);
        setRecorded(true);
        await load();
        onUpdated();
      }
    } catch (failure) {
      if (mounted.current) {
        setError(failure);
        if (!uncertainFinanceResult(failure)) {
          try {
            pendingStore.current!.clear(key);
            setPending(null);
          } catch {
            setStorageReady(false);
          }
        }
      }
    } finally {
      active.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  function submit(command: FinanceDraft) {
    if (pending || active.current || !storageReady || !pendingStore.current)
      return;
    let request: PendingFinanceRequest;
    try {
      request = pendingStore.current.write({
        command,
        key: crypto.randomUUID(),
      });
    } catch {
      setStorageReady(false);
      return;
    }
    setPending(request);
    void run(request);
  }
  return (
    <section
      className="mo-secondary mf-panel"
      data-finance-panel
      aria-labelledby={`${id}-title`}
      aria-busy={busy || loading}
    >
      <div className="mo-section-heading">
        <h2 id={`${id}-title`}>
          {collapsible ? (
            <button
              type="button"
              className="mf-toggle"
              data-finance-toggle
              aria-expanded={open}
              aria-controls={open ? `${id}-body` : undefined}
              onClick={() => setOpen((value) => !value)}
            >
              {copy.title}
              <Icon name="chevron-down" decorative />
            </button>
          ) : (
            copy.title
          )}
        </h2>
        {open ? (
          <Button
            type="button"
            variant="secondary"
            data-finance-refresh
            disabled={busy || loading}
            onClick={() => void load()}
          >
            {copy.reload}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div id={`${id}-body`}>
          {!storageReady && !loading ? (
            <p
              className="mc-error-state"
              role="alert"
              data-finance-storage-unavailable
            >
              {copy.storageUnavailable}
            </p>
          ) : null}
          {pending && !busy ? (
            <div className="mf-notice" role="status" data-finance-recovery>
              <p>{copy.uncertain}</p>
              <Button
                type="button"
                data-finance-retry
                disabled={!storageReady}
                onClick={() => void run(pending)}
              >
                {copy.retrySame}
              </Button>
            </div>
          ) : null}
          {error ? (
            <div
              className="mc-error-state"
              ref={notice}
              tabIndex={-1}
              role="alert"
              data-finance-error
            >
              <p>{detail ? financeError(error, copy) : copy.unavailable}</p>
            </div>
          ) : recorded ? (
            <div
              ref={notice}
              tabIndex={-1}
              role="status"
              className="mc-success"
            >
              {copy.recorded}
            </div>
          ) : null}
          {loading ? (
            <p role="status">{copy.loading}</p>
          ) : detail ? (
            <FinanceDetailView
              key={`${detail.order.orderId}-${detail.order.version}`}
              detail={detail}
              locale={locale}
              busy={busy}
              locked={pending !== null || !storageReady}
              submit={submit}
              {...(itemTitles ? { itemTitles } : {})}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
