"use client";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  createDefaultStorefrontNavigation,
  type StorefrontNavigation,
  type StorefrontNavigationState,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import { AdminClientError } from "../workspace/client";
import type {
  StorefrontNavigationApi,
  NavigationHistory,
} from "./navigation-api";
import { navigationCopy } from "./navigation-copy";
import { editableNavigation, sameNavigation } from "./navigation-model";
import { NavigationEditor } from "./navigation-editor";
import { NavigationPreviewFrame } from "./preview-frame";
import { PublicationHistory } from "./publication-history";
import "./decoration.css";

export function NavigationWorkspace({
  api,
  locale,
  storefrontOrigin,
  canEdit,
  canPublish,
  onBusy,
  onDirtyChange,
}: {
  api: StorefrontNavigationApi;
  locale: SupportedLocale;
  storefrontOrigin?: string | undefined;
  canEdit: boolean;
  canPublish: boolean;
  onBusy: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const copy = navigationCopy(locale);
  const [state, setState] = useState<StorefrontNavigationState | null>(null);
  const [navigation, setNavigation] = useState<StorefrontNavigation>(
    createDefaultStorefrontNavigation,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<NavigationHistory | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const dirty = Boolean(
    state && !sameNavigation(navigation, editableNavigation(state)),
  );
  const adopt = useCallback((next: StorefrontNavigationState) => {
    setState(next);
    setNavigation(editableNavigation(next));
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
  const change = (next: StorefrontNavigation) => {
    setNavigation(next);
    setNotice("");
  };
  async function mutate(action: "save" | "publish" | "restore") {
    if (!state || busy) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    setNotice("");
    try {
      let next: StorefrontNavigationState;
      if (action === "save") next = await api.save(navigation, state.version);
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
    <div data-navigation-workspace>
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
        <p role="status" className="mc-success" data-navigation-notice>
          {notice}
        </p>
      )}
      {!state ? (
        !error && <p role="status">{copy.loading}</p>
      ) : (
        <>
          <div className="decoration-toolbar">
            <p role="status" data-navigation-dirty={dirty}>
              {statusCopy}
            </p>
            <div>
              <Button
                type="button"
                variant="secondary"
                data-navigation-save
                disabled={busy || !canEdit || (!dirty && Boolean(state.draft))}
                onClick={() => {
                  void mutate("save");
                }}
              >
                {copy.save}
              </Button>
              <Button
                type="button"
                data-navigation-publish
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
              <NavigationEditor
                navigation={navigation}
                onChange={change}
                disabled={busy || !canEdit}
                copy={copy}
              />
              <Button
                type="button"
                variant="quiet"
                data-navigation-reset
                disabled={
                  busy ||
                  !canEdit ||
                  sameNavigation(
                    navigation,
                    createDefaultStorefrontNavigation(),
                  )
                }
                onClick={() => change(createDefaultStorefrontNavigation())}
              >
                {copy.reset}
              </Button>
            </div>
            <NavigationPreviewFrame
              navigation={navigation}
              locale={locale}
              origin={storefrontOrigin}
              copy={copy}
              viewCopy={copy.previewViews}
            />
          </div>
          <PublicationHistory
            kind="navigation"
            locale={locale}
            copy={copy}
            history={history}
            historyFailed={historyFailed}
            currentPublicationId={state.published?.publicationId ?? null}
            busy={busy}
            canPublish={canPublish}
            restoreId={restoreId}
            onHistoryRetry={() => setHistoryAttempt((value) => value + 1)}
            onHistoryPage={setHistoryPage}
            onRestoreSelect={setRestoreId}
            onRestoreConfirm={() => {
              void mutate("restore");
            }}
          />
        </>
      )}
    </div>
  );
}
