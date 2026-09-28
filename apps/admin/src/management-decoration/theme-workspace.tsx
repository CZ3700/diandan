"use client";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  createDefaultStorefrontTheme,
  type StorefrontTheme,
  type StorefrontThemeState,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import { AdminClientError } from "../workspace/client";
import type { StorefrontThemeApi, ThemeHistory } from "./theme-api";
import { themeCopy } from "./theme-copy";
import { editableTheme, sameTheme } from "./theme-model";
import { ThemeEditor } from "./theme-editor";
import { ThemePreviewFrame } from "./preview-frame";
import "./decoration.css";

export function ThemeWorkspace({
  api,
  locale,
  storefrontOrigin,
  canEdit,
  canPublish,
  onBusy,
  onDirtyChange,
}: {
  api: StorefrontThemeApi;
  locale: SupportedLocale;
  storefrontOrigin?: string | undefined;
  canEdit: boolean;
  canPublish: boolean;
  onBusy: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const copy = themeCopy(locale);
  const [state, setState] = useState<StorefrontThemeState | null>(null);
  const [theme, setTheme] = useState<StorefrontTheme>(
    createDefaultStorefrontTheme,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<ThemeHistory | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const dirty = Boolean(state && !sameTheme(theme, editableTheme(state)));
  const adopt = useCallback((next: StorefrontThemeState) => {
    setState(next);
    setTheme(editableTheme(next));
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
  useLayoutEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useLayoutEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useLayoutEffect(
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
  const change = (next: StorefrontTheme) => {
    setTheme(next);
    setNotice("");
  };
  async function mutate(action: "save" | "publish" | "restore") {
    if (!state || busy) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    setNotice("");
    try {
      let next: StorefrontThemeState;
      if (action === "save") next = await api.save(theme, state.version);
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
    <div data-theme-workspace>
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
        <p role="status" className="mc-success" data-theme-notice>
          {notice}
        </p>
      )}
      {!state ? (
        !error && <p role="status">{copy.loading}</p>
      ) : (
        <>
          <div className="decoration-toolbar">
            <p role="status" data-theme-dirty={dirty}>
              {statusCopy}
            </p>
            <div>
              <Button
                type="button"
                variant="secondary"
                data-theme-save
                disabled={busy || !canEdit || (!dirty && Boolean(state.draft))}
                onClick={() => {
                  void mutate("save");
                }}
              >
                {copy.save}
              </Button>
              <Button
                type="button"
                data-theme-publish
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
              <ThemeEditor
                theme={theme}
                onChange={change}
                disabled={busy || !canEdit}
                copy={copy}
              />
              <Button
                type="button"
                variant="quiet"
                data-theme-reset
                disabled={
                  busy ||
                  !canEdit ||
                  sameTheme(theme, createDefaultStorefrontTheme())
                }
                onClick={() => change(createDefaultStorefrontTheme())}
              >
                {copy.reset}
              </Button>
            </div>
            <ThemePreviewFrame
              theme={theme}
              locale={locale}
              origin={storefrontOrigin}
              copy={copy}
              replayLabel={copy.replayPreview}
            />
          </div>
          <details className="decoration-history" data-theme-history>
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
                          data-theme-restore={entry.publicationId}
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
                  data-theme-confirm-restore
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
