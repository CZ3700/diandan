"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import { AdminClientError } from "../workspace/client";
import type {
  PaymentConfigurationApi,
  PaymentWorkspace,
  PaymentMutation,
  PaymentValidation,
} from "./api";
import {
  createPaymentPendingStore,
  type PendingPaymentRequest,
} from "./pending-store";
import { availableValidationModes } from "./authority";
import { paymentCopy } from "./copy";
import { canLeaveDecoration } from "../management-decoration/navigation";
import { managementCopy } from "../management-center/copy";
import { ConfigurationSummary } from "./configuration-summary";
import { PaymentEditor } from "./editor";
import { PaymentReviewPanel } from "./review-panel";
import { PaymentPublishPanel } from "./publish-panel";
import "./payments.css";
export function PaymentsWorkspace({
  api,
  initial,
  locale,
  onBusy,
  onDirtyChange,
}: {
  api: PaymentConfigurationApi;
  initial: PaymentWorkspace;
  locale: SupportedLocale;
  onBusy: (busy: boolean) => void;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
}) {
  const [dirty, setDirty] = useState(false);
  useLayoutEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useLayoutEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useLayoutEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const c = paymentCopy(locale),
    [workspace, setWorkspace] = useState(initial),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState<string | null>(null),
    [validation, setValidation] = useState<PaymentValidation | null>(null),
    [pending, setPending] = useState<PendingPaymentRequest | null>(null),
    [storageReady, setStorageReady] = useState(false);
  const store = useRef<ReturnType<typeof createPaymentPendingStore> | null>(
      null,
    ),
    mounted = useRef(true),
    active = useRef(false),
    noticeRef = useRef<HTMLDivElement>(null),
    validationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    try {
      store.current = createPaymentPendingStore(
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
    if (error || notice) noticeRef.current?.focus();
  }, [error, notice]);
  useEffect(() => {
    if (validation) {
      const target = validationRef.current?.querySelector<HTMLElement>(
        "[data-payment-validation]",
      );
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  }, [validation]);
  const working = (value: boolean) => {
    active.current = value;
    if (mounted.current) {
      setBusy(value);
      onBusy(value);
    }
  };
  async function load(
    revisionId: string | null = workspace.selected?.revisionId ?? null,
  ) {
    if (
      !canLeaveDecoration({ busy: active.current, dirty }, () =>
        window.confirm(managementCopy(locale).discardEdits),
      )
    )
      return;
    working(true);
    setError(null);
    setValidation(null);
    try {
      const result = await api.read(revisionId);
      if (mounted.current) {
        setWorkspace(result);
        setEditing(false);
      }
    } catch (failure) {
      if (mounted.current) setError(failure);
    } finally {
      working(false);
    }
  }
  async function run(request: PendingPaymentRequest) {
    if (active.current) return;
    working(true);
    setError(null);
    setNotice(null);
    setValidation(null);
    try {
      const receipt = await api.mutate(request.command, request.key);
      store.current!.clear(request.key);
      if (mounted.current) {
        setPending(null);
        setEditing(false);
        setNotice(
          receipt.action === "SAVE"
            ? c.saved
            : receipt.action === "PUBLISH" || receipt.action === "ROLLBACK"
              ? c.published
              : c.reviewed,
        );
        const next = await api.read(receipt.revisionId);
        if (mounted.current) setWorkspace(next);
      }
    } catch (failure) {
      if (mounted.current) {
        setError(failure);
        if (
          failure instanceof AdminClientError &&
          ![
            "NETWORK_ERROR",
            "INVALID_RESPONSE",
            "TEMPORARY_UNAVAILABLE",
          ].includes(failure.code)
        ) {
          try {
            store.current!.clear(request.key);
            setPending(null);
          } catch {
            setStorageReady(false);
          }
        }
      }
    } finally {
      working(false);
    }
  }
  function mutate(command: PaymentMutation) {
    if (active.current || pending || !storageReady || !store.current) return;
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
  async function validate(mode: "PUBLISH" | "ROLLBACK") {
    if (active.current || pending || !workspace.selected) return;
    working(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.validate({
        revisionId: workspace.selected.revisionId,
        expectedPublicationId: workspace.currentPublicationId,
        mode,
      });
      if (mounted.current) setValidation(result);
    } catch (failure) {
      if (mounted.current) setError(failure);
    } finally {
      working(false);
    }
  }
  const validationModes = availableValidationModes(workspace);
  const blocked = busy || !!pending || !storageReady,
    selected = workspace.selected;
  const failure = error instanceof AdminClientError ? error.code : null;
  const errorText =
    failure === "SELF_REVIEW"
      ? c.selfReview
      : ["STALE_VERSION", "IDEMPOTENCY_CONFLICT", "CONFLICT"].includes(
            failure ?? "",
          )
        ? c.conflict
        : c.error;
  return (
    <div className="mp-workspace" data-payment-workspace aria-busy={busy}>
      <header className="mp-heading">
        <div>
          <h1>{c.title}</h1>
          <p>{c.intro}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          data-payment-refresh
          onClick={() => void load()}
        >
          {c.refresh}
        </Button>
      </header>
      <div ref={noticeRef} tabIndex={-1}>
        {error ? (
          <p role="alert" className="mp-notice">
            {errorText}
          </p>
        ) : notice ? (
          <p role="status" className="mp-notice">
            {notice}
          </p>
        ) : null}
      </div>
      {!storageReady ? <p role="alert">{c.storageUnavailable}</p> : null}
      {pending ? (
        <div className="mp-notice" role="status" data-payment-pending>
          <p>{c.pending}</p>
          <Button
            type="button"
            disabled={busy}
            data-payment-recover
            onClick={() => void run(pending)}
          >
            {c.recover}
          </Button>
        </div>
      ) : null}
      <p className="mp-meta">
        {c.current}:{" "}
        {workspace.generation === 0
          ? c.none
          : new Intl.NumberFormat(locale).format(workspace.generation)}
        {selected
          ? ` · ${c.version} ${new Intl.NumberFormat(locale).format(selected.version)}`
          : ""}
      </p>
      {!workspace.canEdit &&
      !workspace.canPublish &&
      workspace.reviewLocales.length === 0 ? (
        <p>{c.readOnly}</p>
      ) : null}
      {editing ? (
        <PaymentEditor
          key={selected?.revisionId ?? "new"}
          initial={selected?.configuration ?? null}
          accounts={workspace.accounts}
          locale={locale}
          busy={blocked}
          onDirtyChange={setDirty}
          back={() => {
            if (
              canLeaveDecoration({ busy: active.current, dirty }, () =>
                window.confirm(managementCopy(locale).discardEdits),
              )
            )
              setEditing(false);
          }}
          save={(configuration) =>
            mutate({
              action: "SAVE",
              sourceRevisionId: selected?.revisionId ?? null,
              expectedPublicationId: workspace.currentPublicationId,
              configuration,
            })
          }
        />
      ) : (
        <>
          {!workspace.accounts.length ? (
            <p className="mc-empty">{c.emptyAccounts}</p>
          ) : !selected ? (
            <p>{c.legacy}</p>
          ) : null}
          <div className="mp-actions">
            {workspace.canEdit && workspace.accounts.length ? (
              <Button
                type="button"
                disabled={blocked}
                data-payment-edit
                onClick={() => {
                  setEditing(true);
                  setValidation(null);
                  setNotice(null);
                }}
              >
                {selected ? c.edit : c.newDraft}
              </Button>
            ) : null}
            {validationModes.map((mode) => (
              <Button
                key={mode}
                type="button"
                variant="secondary"
                data-payment-check-publish={
                  mode === "PUBLISH" ? true : undefined
                }
                data-payment-check-rollback={
                  mode === "ROLLBACK" ? true : undefined
                }
                disabled={blocked}
                onClick={() => void validate(mode)}
              >
                {mode === "PUBLISH" ? c.checkPublish : c.checkRollback}
              </Button>
            ))}
          </div>
          <div ref={validationRef}>
            {validation ? (
              <PaymentPublishPanel
                key={`${validation.revisionId}:${validation.mode}:${validation.validationHash}`}
                validation={validation}
                locale={locale}
                accounts={workspace.accounts}
                canPublish={workspace.canPublish}
                busy={blocked}
                mutate={mutate}
              />
            ) : null}
          </div>
          {selected ? (
            <>
              <ConfigurationSummary
                configuration={selected.configuration}
                accounts={workspace.accounts}
                locale={locale}
              />
              <PaymentReviewPanel
                revision={selected}
                accounts={workspace.accounts}
                locale={locale}
                canEdit={workspace.canEdit}
                busy={blocked}
                mutate={mutate}
              />
            </>
          ) : null}
          <section className="mp-section">
            <h2>{c.history}</h2>
            {workspace.history.length ? (
              <ul className="mp-history">
                {workspace.history.map((revision) => (
                  <li key={revision.revisionId}>
                    <div>
                      <strong>
                        {c.version}{" "}
                        {new Intl.NumberFormat(locale).format(revision.version)}
                      </strong>
                      {revision.wasPublished ? (
                        <span> · {c.wasPublished}</span>
                      ) : null}
                      <time dateTime={revision.createdAt}>
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(revision.createdAt))}
                      </time>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      data-payment-open-version={revision.version}
                      onClick={() => void load(revision.revisionId)}
                    >
                      {c.view}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{c.noHistory}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
