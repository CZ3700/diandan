"use client";
import { useEffect, useRef, useState } from "react";
import type {
  AdminExceptionTarget,
  SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type {
  ExceptionsApi,
  ExceptionsContext,
  ExceptionsDetail,
  ExceptionsFilters,
  ExceptionsList,
  ExceptionMutation,
} from "./api";
import {
  createExceptionPendingStore,
  type PendingExceptionRequest,
} from "./pending-store";
import { exceptionAccessLost, uncertainExceptionResult } from "./state";
import { exceptionsCopy } from "./copy";
import { exceptionError } from "./labels";
import { ExceptionsFiltersView } from "./filters-view";
import { ExceptionsListView } from "./list-view";
import { ExceptionDetailView } from "./detail-view";
import "./exceptions.css";
const initialFilters: ExceptionsFilters = {
  page: 1,
  pageSize: 12,
  category: "ALL",
  status: "OPEN",
};
export function ExceptionsWorkspace({
  api,
  initial,
  locale,
  onBusy,
}: {
  api: ExceptionsApi;
  initial: ExceptionsContext;
  locale: SupportedLocale;
  onBusy: (value: boolean) => void;
}) {
  const c = exceptionsCopy(locale);
  const [context, setContext] = useState<ExceptionsContext | null>(initial),
    [filters, setFilters] = useState(initialFilters),
    [selected, setSelected] = useState<AdminExceptionTarget | null>(null),
    [list, setList] = useState<ExceptionsList | null>(null),
    [detail, setDetail] = useState<ExceptionsDetail | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState(false),
    [refresh, setRefresh] = useState(0),
    [pending, setPending] = useState<PendingExceptionRequest | null>(null),
    [storageReady, setStorageReady] = useState(false);
  const store = useRef<ReturnType<typeof createExceptionPendingStore> | null>(
      null,
    ),
    active = useRef(false),
    mounted = useRef(true),
    heading = useRef<HTMLHeadingElement>(null),
    message = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    try {
      store.current = createExceptionPendingStore(
        window.sessionStorage,
        initial.actorId,
      );
      setPending(store.current.read());
      setStorageReady(true);
    } catch {
      setStorageReady(false);
    }
    return () => {
      mounted.current = false;
    };
  }, [initial.actorId]);
  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setList(null);
    void (async () => {
      const authority = await api.context();
      if (
        authority.actorId !== initial.actorId ||
        !authority.permissions.canRead
      )
        throw new Error("Exception context changed");
      if (canceled) return;
      setContext(authority);
      if (selected) {
        const value = await api.detail(selected);
        if (!canceled) setDetail(value);
      } else {
        const value = await api.list(filters);
        if (!canceled) setList(value);
      }
    })()
      .catch((failure: unknown) => {
        if (!canceled) {
          setError(failure);
          setContext(null);
          setDetail(null);
          setList(null);
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [api, initial.actorId, selected, filters, refresh]);
  useEffect(() => {
    heading.current?.focus();
  }, [selected, filters.page]);
  useEffect(() => {
    if (error || notice) message.current?.focus();
  }, [error, notice]);
  function refreshData() {
    setNotice(false);
    setRefresh((value) => value + 1);
  }
  async function run(request: PendingExceptionRequest) {
    if (active.current || !context?.permissions.canRead) return;
    active.current = true;
    setBusy(true);
    onBusy(true);
    setError(null);
    setNotice(false);
    try {
      await api.mutate(request.command, request.key);
      store.current!.clear(request.key);
      if (mounted.current) {
        setPending(null);
        setNotice(true);
        setRefresh((value) => value + 1);
      }
    } catch (failure) {
      if (mounted.current) {
        setError(failure);
        if (exceptionAccessLost(failure)) {
          setContext(null);
          setDetail(null);
          setList(null);
        }
        // An access rejection while recovering a previously uncertain command does not prove that command never committed.
        if (!uncertainExceptionResult(failure) && !exceptionAccessLost(failure))
          try {
            store.current!.clear(request.key);
            setPending(null);
          } catch {
            setStorageReady(false);
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
  function mutate(command: ExceptionMutation) {
    if (
      active.current ||
      pending ||
      !storageReady ||
      !store.current ||
      !context?.permissions.canRead
    )
      return;
    try {
      const request = store.current.write({
        command,
        key: crypto.randomUUID(),
      });
      setPending(request);
      void run(request);
    } catch {
      setStorageReady(false);
    }
  }
  const blocked = busy || loading || !!pending || !storageReady;
  const readonly =
    context &&
    !context.permissions.canReplayWebhook &&
    !context.permissions.canRetryDeadLetter &&
    !context.permissions.canReconcilePayment &&
    !context.permissions.canRetryNotification;
  return (
    <section
      className="me-workspace"
      data-exceptions-workspace
      aria-busy={busy || loading}
    >
      <header className="me-heading">
        <div>
          {selected ? (
            <button
              type="button"
              className="mc-back"
              data-exceptions-back
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setNotice(false);
              }}
            >
              {c.back}
            </button>
          ) : null}
          <h1 ref={heading} tabIndex={-1}>
            {c.title}
          </h1>
          <p>{c.intro}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          data-exceptions-reload
          disabled={busy || loading}
          onClick={refreshData}
        >
          {c.refresh}
        </Button>
      </header>
      <div tabIndex={-1} ref={message}>
        {error ? (
          <p className="mc-error-state" role="alert">
            {exceptionError(error, c, pending !== null)}
          </p>
        ) : notice ? (
          <p className="me-notice" role="status" data-exceptions-success>
            {c.queued}
          </p>
        ) : null}
      </div>
      {!storageReady ? <p role="alert">{c.storageUnavailable}</p> : null}
      {pending ? (
        <div className="me-notice" role="status" data-exceptions-pending>
          <p>{c.uncertain}</p>
          {context?.permissions.canRead ? (
            <Button
              type="button"
              data-exceptions-recover
              disabled={busy || loading}
              onClick={() => void run(pending)}
            >
              {c.recover}
            </Button>
          ) : null}
        </div>
      ) : null}
      {readonly ? <p data-exceptions-readonly>{c.readOnly}</p> : null}
      {loading ? <p role="status">{c.loading}</p> : null}
      {!loading && context?.permissions.canRead && selected && detail ? (
        <ExceptionDetailView
          key={`${detail.item.target.kind}:${detail.item.target.id}:${detail.item.version}`}
          detail={detail}
          locale={locale}
          busy={blocked}
          mutate={mutate}
        />
      ) : null}
      {!loading && context?.permissions.canRead && !selected ? (
        <>
          <ExceptionsFiltersView
            filters={filters}
            locale={locale}
            busy={busy}
            onFilters={(next) => {
              setFilters(next);
              setNotice(false);
            }}
          />
          {list ? (
            <ExceptionsListView
              list={list}
              filters={filters}
              locale={locale}
              busy={busy}
              onPage={(page) => setFilters((value) => ({ ...value, page }))}
              onSelect={(target) => {
                setSelected(target);
                setNotice(false);
              }}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
