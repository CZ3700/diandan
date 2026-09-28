"use client";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  INFORMATION_PAGE_KEYS,
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type InformationPageKey,
  type InformationPageWorkspace,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import { AdminClientError } from "../workspace/client";
import { Status, translator } from "../workspace/components";
import { canLeaveDecoration } from "../management-decoration/navigation";
import { InformationPreviewFrame } from "../management-decoration/preview-frame";
import { InformationHistory } from "./history";
import type {
  InformationPagesApi,
  InformationHistory as HistoryData,
} from "./api";
import { informationCopy } from "./copy";
import { editableInformation, sameDraft, type InformationDraft } from "./model";
import { InformationReview } from "./review";
import { InformationEditor } from "./editor";
import "../management-decoration/decoration.css";
import "./information-pages.css";
export function InformationPagesWorkspace({
  api,
  locale,
  localeScopes,
  onDirtyChange,
  onBusy,
  storefrontOrigin,
}: {
  api: InformationPagesApi;
  locale: SupportedLocale;
  localeScopes: readonly SupportedLocale[];
  onDirtyChange: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
  storefrontOrigin?: string | undefined;
}) {
  const copy = informationCopy(locale),
    t = translator(locale);
  const [pageKey, setPageKey] = useState<InformationPageKey>("ABOUT");
  const [contentLocale, setContentLocale] = useState<SupportedLocale>(
    localeScopes.includes("en") ? "en" : (localeScopes[0] ?? "en"),
  );
  const [state, setState] = useState<InformationPageWorkspace | null>(null);
  const [draft, setDraft] = useState<InformationDraft | null>(null);
  const [baseline, setBaseline] = useState<InformationDraft | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0),
    [historyPage, setHistoryPage] = useState(1),
    [history, setHistory] = useState<HistoryData | null>(null),
    [historyFailed, setHistoryFailed] = useState(false),
    [historyAttempt, setHistoryAttempt] = useState(0),
    [restoreId, setRestoreId] = useState<string | null>(null);
  const dirty = Boolean(draft && baseline && !sameDraft(draft, baseline));
  const adopt = useCallback((next: InformationPageWorkspace) => {
    const value = editableInformation(next);
    setState(next);
    setDraft(value);
    setBaseline(value);
  }, []);
  useEffect(() => {
    let active = true;
    setBusy(true);
    onBusy(true);
    setError(null);
    void api
      .read(pageKey, contentLocale)
      .then((next) => {
        if (active) adopt(next);
      })
      .catch((e: unknown) => {
        if (active) setError(e);
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
  }, [api, pageKey, contentLocale, attempt, adopt, onBusy]);
  useEffect(() => {
    let active = true;
    setHistory(null);
    setHistoryFailed(false);
    void api
      .history(pageKey, contentLocale, historyPage)
      .then((next) => {
        if (active) setHistory(next);
      })
      .catch(() => {
        if (active) setHistoryFailed(true);
      });
    return () => {
      active = false;
    };
  }, [api, pageKey, contentLocale, historyPage, historyAttempt]);
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
  const canLeave = () =>
    canLeaveDecoration({ busy, dirty }, () => window.confirm(copy.discard));
  const selectPage = (next: InformationPageKey) => {
    if (next === pageKey || !canLeave()) return;
    setState(null);
    setDraft(null);
    setBaseline(null);
    setPageKey(next);
    setHistoryPage(1);
    setRestoreId(null);
    setNotice("");
  };
  const selectLocale = (next: SupportedLocale) => {
    if (next === contentLocale || !localeScopes.includes(next) || !canLeave())
      return;
    setState(null);
    setDraft(null);
    setBaseline(null);
    setContentLocale(next);
    setRestoreId(null);
    setNotice("");
  };
  const reload = () => {
    if (canLeave()) {
      setAttempt((v) => v + 1);
      setNotice("");
    }
  };
  async function run(
    action: "save" | "submit" | "approve" | "publish" | "unpublish" | "restore",
  ) {
    if (!state || !draft || busy) return;
    if (action !== "save" && dirty) return;
    const caps = state.capabilities;
    const permitted = {
      save: caps.canSave,
      submit: caps.canSubmit,
      approve: caps.canApprove,
      publish: caps.canPublish,
      unpublish: caps.canUnpublish,
      restore: caps.canRestore,
    };
    if (!permitted[action]) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    setNotice("");
    try {
      let next: InformationPageWorkspace;
      switch (action) {
        case "save":
          next = await api.save(state, draft);
          break;
        case "submit":
        case "approve":
          next = await api.review(state, action);
          break;
        case "publish":
          next = await api.publish(state);
          break;
        case "unpublish":
          next = await api.unpublish(state);
          break;
        case "restore":
          if (!restoreId) return;
          next = await api.restore(state, restoreId);
          break;
      }
      adopt(next);
      setRestoreId(null);
      const successNotice = {
        save: copy.saved,
        submit: t("inReview"),
        approve: t("approved"),
        publish: copy.published,
        restore: copy.restored,
        unpublish: copy.unpublished,
      };
      setNotice(successNotice[action]);
      setHistoryAttempt((v) => v + 1);
    } catch (e: unknown) {
      setError(e);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  let statusCopy = copy.draft;
  if (
    state?.published?.revisionId &&
    state.published.revisionId === state.draft?.revisionId
  )
    statusCopy = copy.live;
  if (dirty) statusCopy = copy.unsaved;
  const currentCell = state?.cells.find(
    (cell) => cell.locale === contentLocale,
  );
  const stale =
    currentCell?.access === "READABLE" && currentCell.status === "STALE";
  const failure =
    error instanceof AdminClientError &&
    /CONFLICT|VERSION|STALE|SOURCE_CHANGED/.test(error.code)
      ? copy.conflict
      : error instanceof AdminClientError && error.code === "FORBIDDEN"
        ? copy.forbidden
        : copy.error;
  const pageLabels = {
    ABOUT: copy.about,
    FAQ: copy.faq,
    SUPPORT: copy.support,
  };
  return (
    <div data-info-workspace>
      <header className="mc-workspace-header">
        <div>
          <h1>{copy.title}</h1>
          <p className="mc-hint">{copy.intro}</p>
        </div>
      </header>
      <label className="mc-field">
        <span>{copy.title}</span>
        <select
          data-info-page
          value={pageKey}
          disabled={busy}
          onChange={(e) => {
            const key = e.currentTarget.value;
            if (INFORMATION_PAGE_KEYS.some((value) => value === key))
              selectPage(key as InformationPageKey);
          }}
        >
          {INFORMATION_PAGE_KEYS.map((key) => (
            <option key={key} value={key}>
              {pageLabels[key]}
            </option>
          ))}
        </select>
      </label>
      {Boolean(error) && (
        <div role="alert" className="mc-error-state">
          <p>{failure}</p>
          <Button
            type="button"
            variant="quiet"
            disabled={busy}
            onClick={reload}
          >
            {copy.reload}
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="mc-success" data-info-notice>
          {notice}
        </p>
      )}
      {!state || !draft ? (
        <p role="status">{error ? copy.previewUnavailable : copy.loading}</p>
      ) : (
        <>
          <section aria-label={copy.translations} data-info-status>
            <p>{copy.publishHint}</p>
            <div className="info-language-matrix">
              {state.cells.map((cell) => (
                <button
                  type="button"
                  key={cell.locale}
                  data-info-cell={cell.locale}
                  disabled={busy || cell.access === "RESTRICTED"}
                  aria-pressed={contentLocale === cell.locale}
                  onClick={() => selectLocale(cell.locale)}
                >
                  <span>{LOCALE_NATIVE_NAMES[cell.locale]}</span>
                  <Status
                    value={
                      cell.access === "RESTRICTED" ? "RESTRICTED" : cell.status
                    }
                    t={t}
                  />
                </button>
              ))}
            </div>
            <p className="mc-hint" data-info-blockers>
              {
                state.cells.filter(
                  (cell) =>
                    cell.access === "READABLE" && cell.status === "APPROVED",
                ).length
              }{" "}
              / {SUPPORTED_LOCALES.length} · {t("approved")}
            </p>
          </section>
          <form
            data-info-form
            onSubmit={(event) => {
              event.preventDefault();
              void run("save");
            }}
          >
            <div className="decoration-toolbar">
              <p role="status" data-info-dirty={dirty}>
                {statusCopy}
              </p>
              <div>
                <Button
                  type="submit"
                  variant="secondary"
                  data-info-save
                  disabled={busy || !state.capabilities.canSave}
                >
                  {copy.save}
                </Button>
                <Button
                  type="button"
                  data-info-publish
                  disabled={busy || dirty || !state.capabilities.canPublish}
                  onClick={() => {
                    void run("publish");
                  }}
                >
                  {copy.publish}
                </Button>
              </div>
            </div>
            <div className="decoration-workspace">
              <div className="decoration-controls">
                <p>
                  {LOCALE_NATIVE_NAMES[contentLocale]}
                  {contentLocale === "en" ? ` · ${copy.source}` : ""}
                </p>
                {stale && (
                  <p className="mc-error-state" role="status">
                    {copy.sourceChanged}
                  </p>
                )}
                {!state.draft && contentLocale !== "en" && (
                  <p role="status">{copy.sourceFirst}</p>
                )}
                <InformationEditor
                  pageKey={pageKey}
                  contentLocale={contentLocale}
                  draft={draft}
                  onChange={(next) => {
                    setDraft(next);
                    setNotice("");
                  }}
                  disabled={busy || !state.capabilities.canSave}
                  copy={copy}
                />
                <InformationReview
                  state={state}
                  contentLocale={contentLocale}
                  localeScopes={localeScopes}
                  busy={busy}
                  dirty={dirty}
                  copy={copy}
                  t={t}
                  selectLocale={selectLocale}
                  onSubmitReview={() => {
                    void run("submit");
                  }}
                  onApproveReview={() => {
                    void run("approve");
                  }}
                />
              </div>
              <InformationPreviewFrame
                document={state.preview}
                locale={locale}
                origin={storefrontOrigin}
                copy={copy}
              />
            </div>
          </form>
          <InformationHistory
            state={state}
            history={history}
            historyFailed={historyFailed}
            restoreId={restoreId}
            busy={busy}
            dirty={dirty}
            copy={copy}
            locale={locale}
            reloadHistory={() => setHistoryAttempt((v) => v + 1)}
            onHistoryPage={setHistoryPage}
            onRestoreSelect={setRestoreId}
            onRestoreConfirm={() => {
              void run("restore");
            }}
            onUnpublish={() => {
              if (window.confirm(copy.unpublishConfirm)) void run("unpublish");
            }}
          />
        </>
      )}
    </div>
  );
}
