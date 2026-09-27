"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, Icon } from "@fan-support/ui";
import type {
  ManagementCenterListItem,
  ManagementCenterOperation,
  SupportedLocale,
} from "@fan-support/contracts";
import type {
  ManagementApi,
  ManagementContext,
  ManagementList,
  ManagementSection,
} from "./api";
import { managementCopy } from "./copy";
import { ManagementShell } from "./shell";
import { ManagementListView } from "./list-view";
import { ManagementEditor, type EditorSelection } from "./editor";
import { OperationProgress } from "./operation-progress";
import { managementError } from "./errors";
import { canStartManagementWrite } from "./workspace-state";
import { scheduleManagementFocus } from "./focus";
import { ManagementLogout } from "./logout";

function publishedHref(
  operation: ManagementCenterOperation,
  origin: string | undefined,
) {
  if (!origin || !operation.result) return undefined;
  if (
    (operation.kind === "SAVE_ARTIST" || operation.kind === "SAVE_GIFT") &&
    !operation.result.handle
  )
    return undefined;
  const base = `${origin}/${operation.sourceLocale}`;
  return operation.kind === "SAVE_ARTIST"
    ? `${base}/idols/${operation.result.handle}`
    : operation.kind === "SAVE_GIFT"
      ? `${base}/gifts/${operation.result.handle}`
      : base;
}
export function ManagementWorkspace({
  api,
  locale,
  storefrontOrigin,
  onLogout,
  onOrders,
  onPayments,
  onExceptions,
  initialSection = "ARTISTS",
  accessNotice,
  canDeleteArtists = false,
}: {
  api: ManagementApi;
  locale: SupportedLocale;
  storefrontOrigin?: string | undefined;
  onLogout?: (() => Promise<void>) | undefined;
  onOrders?: (() => void) | undefined;
  onPayments?: (() => void) | undefined;
  onExceptions?: (() => void) | undefined;
  initialSection?: ManagementSection;
  accessNotice?: ReactNode;
  canDeleteArtists?: boolean;
}) {
  const copy = managementCopy(locale);
  const [section, setSection] = useState<ManagementSection>(initialSection);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [context, setContext] = useState<ManagementContext | null>(null);
  const [list, setList] = useState<ManagementList | null>(null);
  const [operations, setOperations] = useState<ManagementCenterOperation[]>([]);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState<ManagementCenterOperation | null>(
    null,
  );
  const [deleted, setDeleted] = useState(false);
  const [canDeleteGifts, setCanDeleteGifts] = useState(false);
  const restoreActive = useRef(false);
  const writeBlocked = !canStartManagementWrite(busy, operations);
  const title = useRef<HTMLHeadingElement>(null);
  const cancelFocus = useRef<(() => void) | null>(null);
  const focusTarget = useCallback((target: () => HTMLElement | null) => {
    cancelFocus.current?.();
    cancelFocus.current = scheduleManagementFocus(target);
  }, []);
  useEffect(() => () => cancelFocus.current?.(), []);
  const focusTitle = () => focusTarget(() => title.current);
  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    setList(null);
    void Promise.all([api.context(), api.list(section, page)])
      .then(([nextContext, nextList]) => {
        if (canceled) return;
        setContext(nextContext);
        setList(nextList);
        setOperations(
          nextContext.operations.filter(
            (operation) => operation.status !== "PUBLISHED",
          ),
        );
      })
      .catch((failure: unknown) => {
        if (!canceled) setError(failure);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [api, section, page, refresh]);
  useEffect(() => {
    let canceled = false;
    void api.canDeleteGifts().then((allowed) => {
      if (!canceled) setCanDeleteGifts(allowed);
    });
    return () => {
      canceled = true;
    };
  }, [api]);
  const removed = useCallback(() => {
    setSuccess(null);
    setDeleted(true);
    setSelection(null);
    setPage(1);
    setRefresh((value) => value + 1);
    setBusy(false);
    focusTarget(() =>
      document.querySelector<HTMLElement>("[data-management-deleted]"),
    );
  }, [focusTarget]);
  const published = useCallback(
    (operation: ManagementCenterOperation) => {
      setDeleted(false);
      setSuccess(operation);
      setSelection(null);
      setPage(1);
      setRefresh((value) => value + 1);
      setBusy(false);
      focusTarget(() =>
        document.querySelector<HTMLElement>("[data-management-success]"),
      );
    },
    [focusTarget],
  );
  const operationChanged = useCallback(
    (next: ManagementCenterOperation) => {
      setOperations((current) =>
        current.map((operation) =>
          operation.operationId === next.operationId ? next : operation,
        ),
      );
      if (next.status === "PUBLISHED") published(next);
    },
    [published],
  );
  function chooseSection(next: ManagementSection) {
    if (busy) return;
    setSelection(null);
    setSection(next);
    setPage(1);
    setSuccess(null);
    setDeleted(false);
    focusTitle();
  }
  async function restore(
    item: Extract<ManagementCenterListItem, { kind: "POSTER" }>,
  ) {
    if (
      !context ||
      writeBlocked ||
      restoreActive.current ||
      item.current ||
      !item.canRestore
    )
      return;
    restoreActive.current = true;
    setBusy(true);
    setError(null);
    try {
      const operation = await api.submit({
        kind: "RESTORE_POSTER",
        sourceLocale: item.sourceLocale,
        expectedVersion: context.poster.version,
        sourceRevisionId: item.sourceRevisionId,
      });
      if (operation.status === "PUBLISHED") published(operation);
      else
        setOperations((current) => [
          operation,
          ...current.filter(
            (entry) => entry.operationId !== operation.operationId,
          ),
        ]);
    } catch (failure) {
      setError(failure);
    } finally {
      restoreActive.current = false;
      setBusy(false);
    }
  }
  function select(item: ManagementCenterListItem) {
    if (writeBlocked) return;
    setSuccess(null);
    setDeleted(false);
    if (item.kind === "POSTER") {
      void restore(item);
      return;
    }
    if (item.kind === "GIFT" && !item.canEdit) return;
    setSelection({
      kind: item.kind === "ARTIST" ? "SAVE_ARTIST" : "SAVE_GIFT",
      item,
    });
    focusTitle();
  }
  const heading = selection
    ? selection.kind === "REPLACE_POSTER"
      ? copy.replacePoster
      : selection.item
        ? copy.edit
        : selection.kind === "SAVE_ARTIST"
          ? copy.addArtist
          : copy.addGift
    : section === "ARTISTS"
      ? copy.artists
      : section === "GIFTS"
        ? copy.gifts
        : copy.posters;
  const href = success ? publishedHref(success, storefrontOrigin) : undefined;
  return (
    <ManagementShell
      locale={locale}
      section={section}
      onSection={(next) =>
        next === "ORDERS"
          ? onOrders?.()
          : next === "PAYMENTS"
            ? onPayments?.()
            : next === "EXCEPTIONS"
              ? onExceptions?.()
              : chooseSection(next)
      }
      ordersAvailable={Boolean(onOrders)}
      paymentsAvailable={Boolean(onPayments)}
      exceptionsAvailable={Boolean(onExceptions)}
      disabled={busy}
      accountAction={
        onLogout ? (
          <ManagementLogout
            locale={locale}
            onLogout={onLogout}
            disabled={busy}
          />
        ) : undefined
      }
    >
      {accessNotice}
      <header className="mc-workspace-header">
        <div>
          {selection ? (
            <button
              className="mc-back"
              type="button"
              disabled={busy}
              onClick={() => {
                setSelection(null);
                setRefresh((value) => value + 1);
                focusTitle();
              }}
            >
              <Icon name="arrow-left" decorative />
              {copy.back}
            </button>
          ) : null}
          <h1 tabIndex={-1} ref={title}>
            {heading}
          </h1>
        </div>
        {!selection && context ? (
          <Button
            type="button"
            data-management-new
            disabled={
              loading ||
              writeBlocked ||
              (section === "POSTERS" && !context.poster.available)
            }
            onClick={() => {
              setSuccess(null);
              setDeleted(false);
              setSelection(
                section === "POSTERS"
                  ? {
                      kind: "REPLACE_POSTER",
                      item:
                        list?.items.find(
                          (
                            item,
                          ): item is Extract<
                            ManagementCenterListItem,
                            { kind: "POSTER" }
                          > => item.kind === "POSTER" && item.current,
                        ) ?? null,
                    }
                  : {
                      kind: section === "ARTISTS" ? "SAVE_ARTIST" : "SAVE_GIFT",
                      item: null,
                    },
              );
              focusTitle();
            }}
          >
            <Icon name="plus" decorative />
            {section === "ARTISTS"
              ? copy.addArtist
              : section === "GIFTS"
                ? copy.addGift
                : copy.replacePoster}
          </Button>
        ) : null}
      </header>
      {success ? (
        <div
          className="mc-success"
          role="status"
          tabIndex={-1}
          data-management-success
        >
          <Icon name="check" decorative />
          <span>{copy.published}</span>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-management-view-storefront
            >
              {copy.viewStorefront}
              <Icon name="arrow-right" decorative />
            </a>
          ) : null}
        </div>
      ) : null}
      {deleted ? (
        <div
          className="mc-success"
          role="status"
          tabIndex={-1}
          data-management-deleted
        >
          <Icon name="check" decorative />
          <span>{copy.deleted}</span>
        </div>
      ) : null}
      {selection && context ? (
        <ManagementEditor
          key={`${selection.kind}-${selection.item?.id ?? "new"}`}
          api={api}
          locale={locale}
          context={context}
          selection={selection}
          onPublished={published}
          onDeleted={removed}
          canDelete={
            selection.kind === "SAVE_ARTIST"
              ? canDeleteArtists
              : selection.kind === "SAVE_GIFT" && canDeleteGifts
          }
          onBusy={setBusy}
        />
      ) : (
        <>
          {operations.map((operation) => (
            <OperationProgress
              key={operation.operationId}
              api={api}
              locale={locale}
              operation={operation}
              onChange={operationChanged}
            />
          ))}
          {error ? (
            <div className="mc-error-state" role="alert">
              <p>{list ? managementError(error, copy) : copy.loadFailed}</p>
              <Button
                variant="secondary"
                type="button"
                onClick={() => setRefresh((value) => value + 1)}
              >
                {copy.reloadList}
              </Button>
            </div>
          ) : loading ? (
            <p className="mc-empty" role="status">
              {copy.checkingSession}
            </p>
          ) : list ? (
            <>
              {section === "POSTERS" && !context?.poster.available ? (
                <p className="mc-hint">{copy.posterUnavailable}</p>
              ) : null}
              <ManagementListView
                locale={locale}
                list={list}
                busy={writeBlocked}
                onSelect={select}
                onPage={(next) => {
                  setPage(next);
                  focusTitle();
                }}
              />
            </>
          ) : null}
        </>
      )}
    </ManagementShell>
  );
}
