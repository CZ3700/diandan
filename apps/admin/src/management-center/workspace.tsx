"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Button, Icon } from "@fan-support/ui";
import type {
  ManagementCenterListItem,
  ManagementCenterOperation,
  SupportedLocale,
} from "@fan-support/contracts";
import type {
  AssignmentFilter,
  ManagementApi,
  ManagementContext,
  ManagementList,
  ManagementListOptions,
  ManagementSection,
  PosterItem,
} from "./api";
import { brokerName } from "./artist-assignment";
import { ManagementSelect } from "./form-fields";
import { managementCopy } from "./copy";
import { ManagementShell } from "./shell";
import { ManagementListView } from "./list-view";
import { ManagementArtistSearch, ManagementGiftFilters } from "./list-filters";
import { ManagementEditor, type EditorSelection } from "./editor";
import { OperationProgress } from "./operation-progress";
import { managementError } from "./errors";
import {
  canStartManagementWrite,
  readDismissedOperations,
  rememberDismissedOperation,
  visibleManagementOperations,
} from "./workspace-state";
import { scheduleManagementFocus } from "./focus";
import { canLeaveDecoration } from "../management-decoration/navigation";
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
  onDecoration,
  onInfoPages,
  onStaff,
  onAccount,
  onLedger,
  accountWarning,
  initialSection = "ARTISTS",
  accessNotice,
  canDeleteArtists = false,
  artistsOnly = false,
}: {
  api: ManagementApi;
  locale: SupportedLocale;
  storefrontOrigin?: string | undefined;
  onLogout?: (() => Promise<void>) | undefined;
  onOrders?: (() => void) | undefined;
  onPayments?: (() => void) | undefined;
  onExceptions?: (() => void) | undefined;
  onInfoPages?: (() => void) | undefined;
  onDecoration?: (() => void) | undefined;
  onStaff?: (() => void) | undefined;
  onAccount?: (() => void) | undefined;
  /** ADR-022 / L3-12: a broker's own ledger entry. */
  onLedger?: (() => void) | undefined;
  accountWarning?: string | undefined;
  initialSection?: ManagementSection;
  accessNotice?: ReactNode;
  canDeleteArtists?: boolean;
  /** ADR-022: a broker's center has no gifts or posters. */
  artistsOnly?: boolean;
}) {
  const copy = managementCopy(locale);
  const [section, setSection] = useState<ManagementSection>(initialSection);
  const [page, setPage] = useState(1);
  const [assignment, setAssignment] = useState<AssignmentFilter | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [giftKind, setGiftKind] = useState<NonNullable<
    ManagementListOptions["giftKind"]
  > | null>(null);
  const [sort, setSort] =
    useState<NonNullable<ManagementListOptions["sort"]>>("NEWEST");
  const [refresh, setRefresh] = useState(0);
  const [context, setContext] = useState<ManagementContext | null>(null);
  const [list, setList] = useState<ManagementList | null>(null);
  const [operations, setOperations] = useState<ManagementCenterOperation[]>([]);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  function canLeave() {
    return canLeaveDecoration({ busy, dirty }, () =>
      window.confirm(copy.discardEdits),
    );
  }
  useLayoutEffect(() => {
    if (!dirty && !busy) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, busy]);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState<ManagementCenterOperation | null>(
    null,
  );
  const [deleted, setDeleted] = useState<string | null>(null);
  /** The operation whose new artist was published without its chosen broker. */
  const [assignmentMissed, setAssignmentMissed] = useState<string | null>(null);
  const [canDeleteGifts, setCanDeleteGifts] = useState(false);
  const restoreActive = useRef(false);
  const writeBlocked = !canStartManagementWrite(busy, operations);
  const visibleList = list?.section === section ? list : null;
  const listPending = loading || visibleList?.page !== page;
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
    void Promise.all([
      api.context(),
      api.list(
        section,
        page,
        section === "ARTISTS" ? assignment : null,
        section === "ARTISTS"
          ? { search }
          : section === "GIFTS"
            ? {
                ...(giftKind ? { giftKind } : {}),
                sort,
              }
            : {},
      ),
    ])
      .then(([nextContext, nextList]) => {
        if (canceled) return;
        setContext(nextContext);
        setOperations(
          visibleManagementOperations(
            nextContext.operations,
            readDismissedOperations(browserStorage()),
          ),
        );
        const lastPage = Math.max(
          1,
          Math.ceil(nextList.totalItems / nextList.pageSize),
        );
        if (page > lastPage) setPage(lastPage);
        else setList(nextList);
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
  }, [api, section, page, assignment, search, giftKind, sort, refresh]);
  useEffect(() => {
    let canceled = false;
    void api.canDeleteGifts().then((allowed) => {
      if (!canceled) setCanDeleteGifts(allowed);
    });
    return () => {
      canceled = true;
    };
  }, [api]);
  const removed = useCallback(
    (message: string) => {
      setDirty(false);
      setSuccess(null);
      setDeleted(message);
      setSelection(null);
      setLoading(true);
      setRefresh((value) => value + 1);
      setBusy(false);
      focusTarget(() =>
        document.querySelector<HTMLElement>("[data-management-deleted]"),
      );
    },
    [focusTarget],
  );
  const archivePoster = useCallback(
    async (item: PosterItem) => {
      setBusy(true);
      setError(null);
      try {
        await api.archivePoster(item);
        removed(copy.posterDeleted);
      } catch (failure) {
        setError(failure);
        setBusy(false);
      }
    },
    [api, removed, copy.posterDeleted],
  );
  const published = useCallback(
    (operation: ManagementCenterOperation, missed = false) => {
      setDirty(false);
      setDeleted(null);
      setAssignmentMissed(missed ? operation.operationId : null);
      setSuccess(operation);
      setSelection(null);
      if (selection && selection.item === null) setPage(1);
      setLoading(true);
      setRefresh((value) => value + 1);
      setBusy(false);
      focusTarget(() =>
        document.querySelector<HTMLElement>("[data-management-success]"),
      );
    },
    [focusTarget, selection],
  );
  const dismissOperation = useCallback((operationId: string) => {
    rememberDismissedOperation(browserStorage(), operationId);
    setOperations((current) =>
      current.filter((operation) => operation.operationId !== operationId),
    );
  }, []);
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
    if (!canLeave()) return;
    setDirty(false);
    setSelection(null);
    setSection(next);
    setAssignment(null);
    setSearchInput("");
    setSearch("");
    setGiftKind(null);
    setSort("NEWEST");
    setPage(1);
    setLoading(true);
    setRefresh((value) => value + 1);
    setSuccess(null);
    setDeleted(null);
    focusTitle();
  }
  function resetListPage() {
    setPage(1);
    setLoading(true);
    setRefresh((value) => value + 1);
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
    setDeleted(null);
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
      artistsOnly={artistsOnly}
      beforeLeave={() => !busy}
      onSection={(next) => {
        if (
          [
            "ORDERS",
            "PAYMENTS",
            "DECORATION",
            "EXCEPTIONS",
            "INFO_PAGES",
            "STAFF",
            "ACCOUNT",
            "LEDGER",
          ].includes(next) &&
          !canLeave()
        )
          return;
        if (next === "ORDERS") onOrders?.();
        else if (next === "PAYMENTS") onPayments?.();
        else if (next === "INFO_PAGES") onInfoPages?.();
        else if (next === "DECORATION") onDecoration?.();
        else if (next === "EXCEPTIONS") onExceptions?.();
        else if (next === "STAFF") onStaff?.();
        else if (next === "ACCOUNT") onAccount?.();
        else if (next === "LEDGER") onLedger?.();
        else chooseSection(next);
      }}
      ordersAvailable={Boolean(onOrders)}
      ledgerAvailable={Boolean(onLedger)}
      paymentsAvailable={Boolean(onPayments)}
      exceptionsAvailable={Boolean(onExceptions)}
      infoPagesAvailable={Boolean(onInfoPages)}
      decorationAvailable={Boolean(onDecoration)}
      staffAvailable={Boolean(onStaff)}
      accountAvailable={Boolean(onAccount)}
      accountWarning={accountWarning}
      disabled={busy}
      accountAction={
        onLogout ? (
          <ManagementLogout
            locale={locale}
            onLogout={async () => {
              if (canLeave()) await onLogout();
            }}
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
                if (!canLeave()) return;
                setDirty(false);
                setSelection(null);
                setLoading(true);
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
              setDeleted(null);
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
      {success && assignmentMissed === success.operationId ? (
        <p className="mc-error" role="alert" data-management-assignment-missed>
          {copy.assignmentMissed}
        </p>
      ) : null}
      {deleted ? (
        <div
          className="mc-success"
          role="status"
          tabIndex={-1}
          data-management-deleted
        >
          <Icon name="check" decorative />
          <span>{deleted}</span>
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
          onDeleted={() => removed(copy.deleted)}
          canDelete={
            selection.kind === "SAVE_ARTIST"
              ? canDeleteArtists
              : selection.kind === "SAVE_GIFT" && canDeleteGifts
          }
          onBusy={setBusy}
          onDirtyChange={setDirty}
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
              onDismiss={() => dismissOperation(operation.operationId)}
            />
          ))}
          {/* Stays mounted while the list reloads, so keyboard focus is not lost. */}
          {section === "ARTISTS" ? (
            <div className="mc-artist-filters">
              <ManagementArtistSearch
                copy={copy}
                value={searchInput}
                disabled={busy}
                onChange={setSearchInput}
                onSearch={(value) => {
                  setSearchInput(value);
                  setSearch(value);
                  resetListPage();
                }}
              />
              {context?.artists.scope === "ALL" ? (
                <div className="mc-list-filter">
                  <ManagementSelect
                    name="assignment-filter"
                    label={copy.assignmentFilter}
                    disabled={busy}
                    value={
                      assignment === null
                        ? ""
                        : assignment.kind === "BROKER"
                          ? assignment.brokerId
                          : "UNASSIGNED"
                    }
                    onChange={(value) => {
                      setAssignment(
                        value === ""
                          ? null
                          : value === "UNASSIGNED"
                            ? { kind: "UNASSIGNED" }
                            : { kind: "BROKER", brokerId: value },
                      );
                      resetListPage();
                    }}
                  >
                    <option value="">{copy.assignmentAll}</option>
                    <option value="UNASSIGNED">{copy.assignmentNone}</option>
                    {context.artists.brokers.map((broker) => (
                      <option key={broker.brokerId} value={broker.brokerId}>
                        {brokerName(broker, copy)}
                      </option>
                    ))}
                  </ManagementSelect>
                </div>
              ) : null}
            </div>
          ) : null}
          {section === "GIFTS" ? (
            <ManagementGiftFilters
              copy={copy}
              kind={giftKind}
              sort={sort}
              priceScope={
                context?.defaults?.priceScope
                  ? (visibleList?.priceScope ?? context.defaults.priceScope)
                  : null
              }
              disabled={busy}
              onKind={(value) => {
                setGiftKind(value);
                resetListPage();
              }}
              onSort={(value) => {
                setSort(value);
                resetListPage();
              }}
            />
          ) : null}
          {error ? (
            <div className="mc-error-state" role="alert">
              <p>{list ? managementError(error, copy) : copy.loadFailed}</p>
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setLoading(true);
                  setRefresh((value) => value + 1);
                }}
              >
                {copy.reloadList}
              </Button>
            </div>
          ) : !visibleList && loading ? (
            <p className="mc-empty" role="status">
              {copy.checkingSession}
            </p>
          ) : visibleList ? (
            <>
              {section === "POSTERS" && !context?.poster.available ? (
                <p className="mc-hint">{copy.posterUnavailable}</p>
              ) : null}
              <div
                aria-busy={listPending || undefined}
                data-management-list-pending={listPending || undefined}
              >
                <ManagementListView
                  locale={locale}
                  list={visibleList}
                  showAssignment={context?.artists.scope === "ALL"}
                  filtered={
                    section === "ARTISTS"
                      ? assignment !== null || search !== ""
                      : giftKind !== null
                  }
                  busy={writeBlocked || listPending}
                  onSelect={select}
                  onDeletePoster={(item) => void archivePoster(item)}
                  onPage={(next) => {
                    setPage(next);
                    setLoading(true);
                    focusTitle();
                  }}
                />
              </div>
            </>
          ) : null}
        </>
      )}
    </ManagementShell>
  );
}

/** Reading window.localStorage itself throws when site data is blocked. */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
