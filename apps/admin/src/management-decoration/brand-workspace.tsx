"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type StorefrontBrandView,
  type StorefrontBrand,
  type StorefrontBrandState,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import { AdminClientError } from "../workspace/client";
import type { StorefrontBrandApi, BrandHistory } from "./brand-api";
import { brandCopy } from "./brand-copy";
import {
  editableBrand,
  editableBrandView,
  brandFromView,
  emptyBrandView,
  logoSelectionIssue,
  sameBrand,
  type BrandSlot,
} from "./brand-model";
import { BrandEditor } from "./brand-editor";
import { BrandPreviewFrame } from "./preview-frame";
import { PublicationHistory } from "./publication-history";
import "./decoration.css";

export function BrandWorkspace({
  api,
  locale,
  storefrontOrigin,
  canEdit,
  canPublish,
  canUpload = false,
  onBusy,
  onDirtyChange,
}: {
  api: StorefrontBrandApi;
  locale: SupportedLocale;
  storefrontOrigin?: string | undefined;
  canEdit: boolean;
  canPublish: boolean;
  canUpload?: boolean;
  onBusy: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const copy = brandCopy(locale);
  const [state, setState] = useState<StorefrontBrandState | null>(null);
  const [view, setView] = useState<StorefrontBrandView>(emptyBrandView);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<BrandHistory | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [files, setFiles] = useState<Partial<Record<BrandSlot, File>>>({});
  const [uploadErrors, setUploadErrors] = useState<
    Partial<Record<BrandSlot, string>>
  >({});
  const [uploading, setUploading] = useState<BrandSlot | null>(null);
  const [brand, setBrand] = useState<StorefrontBrand>(() =>
    brandFromView(view),
  );
  const working = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pending = Object.keys(files).length > 0;
  const dirty =
    pending || Boolean(state && !sameBrand(brand, editableBrand(state)));
  const adopt = useCallback((next: StorefrontBrandState) => {
    setState(next);
    setView(editableBrandView(next));
    setBrand(editableBrand(next));
    setFiles({});
    setUploadErrors({});
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
  const cancelUpload = (slot: BrandSlot) => {
    if (busy || working.current || !canEdit) return;
    setFiles((current) => {
      const next = { ...current };
      delete next[slot];
      return next;
    });
    setUploadErrors((current) => {
      const next = { ...current };
      delete next[slot];
      return next;
    });
  };
  const remove = (slot: BrandSlot) => {
    if (busy || working.current || !canEdit) return;
    cancelUpload(slot);
    setView((current) => ({ ...current, [slot]: null }));
    setBrand((current) => ({
      ...current,
      [slot === "lightLogo" ? "lightLogoAssetId" : "darkLogoAssetId"]: null,
    }));
    setNotice("");
  };
  async function upload(slot: BrandSlot, file: File) {
    if (busy || working.current || !canEdit || !canUpload) return;
    const issue = logoSelectionIssue(file);
    if (issue) {
      setUploadErrors((current) => ({ ...current, [slot]: copy[issue] }));
      return;
    }
    working.current = true;
    setFiles((current) => ({ ...current, [slot]: file }));
    setUploadErrors((current) => {
      const next = { ...current };
      delete next[slot];
      return next;
    });
    setBusy(true);
    onBusy(true);
    setUploading(slot);
    setNotice("");
    try {
      const logo = await api.upload(file);
      if (!mounted.current) return;
      setView((current) => ({ ...current, [slot]: logo }));
      setBrand((current) => ({
        ...current,
        [slot === "lightLogo" ? "lightLogoAssetId" : "darkLogoAssetId"]:
          logo.assetId,
      }));
      setFiles((current) => {
        const next = { ...current };
        delete next[slot];
        return next;
      });
    } catch {
      if (mounted.current)
        setUploadErrors((current) => ({
          ...current,
          [slot]: copy.uploadError,
        }));
    } finally {
      working.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusy(false);
        setUploading(null);
      }
    }
  }
  async function mutate(action: "save" | "publish" | "restore") {
    if (!state || busy || working.current) return;
    if (action === "save" ? !canEdit || pending : !canPublish) return;
    working.current = true;
    setBusy(true);
    onBusy(true);
    setError(null);
    setNotice("");
    try {
      let next: StorefrontBrandState;
      if (action === "save") next = await api.save(brand, state.version);
      else if (action === "publish" && state.draft && !dirty)
        next = await api.publish(state.draft.revisionId, state.version);
      else if (action === "restore" && restoreId)
        next = await api.restore(restoreId, state.version);
      else return;
      if (!mounted.current) return;
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
      if (mounted.current) setError(failure);
    } finally {
      working.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  const failureCode = error instanceof AdminClientError ? error.code : null;
  let failureCopy = copy.error;
  if (failureCode === "STALE_VERSION") failureCopy = copy.conflict;
  if (failureCode === "FORBIDDEN") failureCopy = copy.forbidden;
  let statusCopy = state?.published ? copy.live : copy.unset;
  if (state?.draft) statusCopy = copy.draft;
  if (dirty) statusCopy = copy.unsaved;
  return (
    <div data-brand-workspace>
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
        <p role="status" className="mc-success" data-brand-notice>
          {notice}
        </p>
      )}
      {!state ? (
        !error && <p role="status">{copy.loading}</p>
      ) : (
        <>
          <div className="decoration-toolbar">
            <p role="status" data-brand-dirty={dirty}>
              {statusCopy}
            </p>
            <div>
              <Button
                type="button"
                variant="secondary"
                data-brand-save
                disabled={
                  busy ||
                  pending ||
                  !canEdit ||
                  (!dirty && Boolean(state.draft))
                }
                onClick={() => {
                  void mutate("save");
                }}
              >
                {copy.save}
              </Button>
              <Button
                type="button"
                data-brand-publish
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
              <BrandEditor
                brand={brand}
                view={view}
                onUpload={(slot, file) => {
                  void upload(slot, file);
                }}
                onRemove={remove}
                onCancelUpload={cancelUpload}
                disabled={busy || !canEdit}
                canUpload={canUpload}
                files={files}
                errors={uploadErrors}
                uploading={uploading}
                copy={copy}
              />
            </div>
            <BrandPreviewFrame
              brand={view}
              locale={locale}
              origin={storefrontOrigin}
              copy={copy}
            />
          </div>
          <PublicationHistory
            kind="brand"
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
