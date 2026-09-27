"use client";
import { useCallback, useEffect, useState } from "react";
import {
  createDefaultHomeLayout,
  type HomeLayout,
  type HomeLayoutState,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import { AdminClientError } from "../workspace/client";
import type { HomeLayoutApi, LayoutHistory } from "./api";
import { decorationCopy } from "./copy";
import { editableLayout, sameLayout } from "./model";
import { LayoutSectionEditor } from "./editor";
import { LayoutPreviewFrame } from "./preview-frame";
import "./decoration.css";

export function DecorationWorkspace({
  api,
  locale,
  storefrontOrigin,
  canEdit,
  canPublish,
  onBusy,
  onDirtyChange,
}: {
  api: HomeLayoutApi;
  locale: SupportedLocale;
  storefrontOrigin?: string | undefined;
  canEdit: boolean;
  canPublish: boolean;
  onBusy: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const copy = decorationCopy(locale);
  const [state, setState] = useState<HomeLayoutState | null>(null);
  const [layout, setLayout] = useState<HomeLayout>(createDefaultHomeLayout);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<LayoutHistory | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const dirty = Boolean(state && !sameLayout(layout, editableLayout(state)));
  const adopt = useCallback((next: HomeLayoutState) => {
    setState(next);
    setLayout(editableLayout(next));
  }, []);
  useEffect(() => {
    let active = true;
    setError(null);
    setBusy(true);
    onBusy(true);
    void api
      .read()
      .then((next) => {
        if (active) adopt(next);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure);
      })
      .finally(() => {
        if (active) {
          setBusy(false);
          onBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [api, attempt, adopt, onBusy]);
  useEffect(() => {
    let active = true;
    setHistoryFailed(false);
    void api
      .history(historyPage)
      .then((next) => {
        if (active) setHistory(next);
      })
      .catch(() => {
        if (active) setHistoryFailed(true);
      });
    return () => {
      active = false;
    };
  }, [api, historyPage, historyAttempt]);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useEffect(
    () => () => {
      onDirtyChange(false);
      onBusy(false);
    },
    [onDirtyChange, onBusy],
  );
  const refresh = () => {
    if (!dirty || window.confirm(copy.discard)) {
      setAttempt((value) => value + 1);
      setRestoreId(null);
    }
  };
  const change = (next: HomeLayout) => {
    setLayout(next);
    setNotice("");
  };
  async function mutate(action: "save" | "publish" | "restore") {
    if (!state || busy) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    setNotice("");
    try {
      let next: HomeLayoutState;
      if (action === "save") next = await api.save(layout, state.version);
      else if (action === "publish" && state.draft && !dirty)
        next = await api.publish(state.draft.revisionId, state.version);
      else if (action === "restore" && restoreId)
        next = await api.restore(restoreId, state.version);
      else return;
      adopt(next);
      setRestoreId(null);
      const notices = {
        save: copy.saved,
        publish: copy.published,
        restore: copy.restored,
      };
      setNotice(notices[action]);
      if (action !== "save") {
        setHistoryPage(1);
        setHistoryAttempt((value) => value + 1);
      }
    } catch (failure: unknown) {
      setError(failure);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  const failureCode = error instanceof AdminClientError ? error.code : null;
  let failureCopy = copy.error;
  if (failureCode === "STALE_VERSION") failureCopy = copy.conflict;
  if (failureCode === "FORBIDDEN") failureCopy = copy.forbidden;
  let statusCopy = copy.live;
  if (state?.draft) statusCopy = copy.draft;
  if (dirty) statusCopy = copy.unsaved;
  return (
    <div data-decoration-workspace>
      <header className="mc-workspace-header">
        <div>
          <h1>{copy.title}</h1>
          <p className="mc-hint">{copy.intro}</p>
        </div>
        {storefrontOrigin && (
          <a
            className="decoration-live-link"
            target="_blank"
            rel="noopener noreferrer"
            href={`${storefrontOrigin}/${locale}`}
          >
            {copy.liveLink}
          </a>
        )}
      </header>
      {Boolean(error) && (
        <div role="alert" className="mc-error-state">
          <p>{failureCopy}</p>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={refresh}
          >
            {copy.reload}
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="mc-success" data-layout-notice>
          {notice}
        </p>
      )}
      {!state ? (
        !error && <p role="status">{copy.loading}</p>
      ) : (
        <>
          <div className="decoration-toolbar">
            <p role="status" data-layout-dirty={dirty}>
              {statusCopy}
            </p>
            <div>
              <Button
                type="button"
                variant="secondary"
                data-layout-save
                disabled={busy || !canEdit || (!dirty && Boolean(state.draft))}
                onClick={() => {
                  void mutate("save");
                }}
              >
                {copy.save}
              </Button>
              <Button
                type="button"
                data-layout-publish
                disabled={busy || !canPublish || dirty || !state.draft}
                onClick={() => {
                  void mutate("publish");
                }}
              >
                {copy.publish}
              </Button>
            </div>
          </div>
          <div className="decoration-workspace">
            <div className="decoration-controls">
              <LayoutSectionEditor
                layout={layout}
                onChange={change}
                disabled={busy || !canEdit}
                copy={copy}
              />
              <Button
                type="button"
                variant="quiet"
                data-layout-reset
                disabled={
                  busy ||
                  !canEdit ||
                  sameLayout(layout, createDefaultHomeLayout())
                }
                onClick={() => change(createDefaultHomeLayout())}
              >
                {copy.reset}
              </Button>
            </div>
            <LayoutPreviewFrame
              layout={layout}
              locale={locale}
              origin={storefrontOrigin}
              copy={copy}
            />
          </div>
          <details className="decoration-history">
            <summary>{copy.history}</summary>
            {historyFailed ? (
              <p role="alert">
                {copy.error}{" "}
                <Button
                  variant="quiet"
                  onClick={() => setHistoryAttempt((value) => value + 1)}
                >
                  {copy.reload}
                </Button>
              </p>
            ) : !history ? (
              <p role="status">{copy.loading}</p>
            ) : (
              <>
                {history.entries.length === 0 ? (
                  <p className="mc-hint">{copy.noHistory}</p>
                ) : (
                  <ol>
                    {history.entries.map((entry) => (
                      <li key={entry.publicationId}>
                        <div>
                          <strong>
                            {copy.version} {entry.version}
                          </strong>
                          <time dateTime={entry.publishedAt}>
                            {new Intl.DateTimeFormat(locale, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(entry.publishedAt))}
                          </time>
                          {entry.publicationId ===
                            state.published?.publicationId && (
                            <span>{copy.live}</span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          data-layout-restore={entry.publicationId}
                          disabled={
                            busy ||
                            !canPublish ||
                            entry.publicationId ===
                              state.published?.publicationId
                          }
                          onClick={() => setRestoreId(entry.publicationId)}
                        >
                          {copy.restore}
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
                {(history.page > 1 || history.hasMore) && (
                  <div className="mc-pagination">
                    <Button
                      variant="quiet"
                      disabled={busy || history.page === 1}
                      onClick={() => setHistoryPage(history.page - 1)}
                    >
                      {copy.previous}
                    </Button>
                    <span>{history.page}</span>
                    <Button
                      variant="quiet"
                      disabled={busy || !history.hasMore}
                      onClick={() => setHistoryPage(history.page + 1)}
                    >
                      {copy.next}
                    </Button>
                  </div>
                )}
              </>
            )}
            {restoreId && (
              <div className="decoration-restore-confirm" role="alert">
                <p>{copy.restoreConfirm}</p>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setRestoreId(null)}
                >
                  {copy.cancel}
                </Button>
                <Button
                  type="button"
                  data-layout-confirm-restore
                  disabled={busy || !canPublish}
                  onClick={() => {
                    void mutate("restore");
                  }}
                >
                  {copy.restore}
                </Button>
              </div>
            )}
          </details>
        </>
      )}
    </div>
  );
}
