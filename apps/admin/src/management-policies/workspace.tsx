"use client";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@fan-support/ui";
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  policyKindSchema,
  policyTranslationFieldsSchema,
  type AdminCatalogOwner,
  type AdminSessionPermission,
  type SupportedLocale,
} from "@fan-support/contracts";
import { AdminClientError } from "../workspace/client";
import { Publishing } from "../workspace/publishing";
import { Status, translator } from "../workspace/components";
import { policiesCopy } from "./copy";
import { type PoliciesApi, type PolicyState } from "./api";
import {
  emptyPolicyFields,
  parsePolicyPackage,
  samePolicyDraft,
  validPolicyEffectiveTime,
  type PolicyDraft,
  type PolicyKind,
  type PolicyPackage,
} from "./model";
import { continuePolicyDraft, type PolicyEditBuffer } from "./draft-session";
import { PolicyEditor } from "./editor";
import { PolicyPreview } from "./preview";
import { PolicyReview, policyReviewAccess } from "./review";
import "./policies.css";

export type PoliciesWorkspaceProps = {
  api: PoliciesApi;
  locale: SupportedLocale;
  localeScopes: readonly SupportedLocale[];
  permissions: readonly AdminSessionPermission[];
  actorId: string;
  onDirtyChange: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
  embedded?: boolean;
};
export function PoliciesWorkspace({
  api,
  locale,
  localeScopes,
  permissions,
  actorId,
  onDirtyChange,
  onBusy,
  embedded = false,
}: PoliciesWorkspaceProps) {
  const Heading = embedded ? "h2" : "h1";
  const copy = policiesCopy(locale),
    t = translator(locale),
    prefix = useId();
  const directoryLocale = localeScopes.includes("en")
    ? "en"
    : (localeScopes[0] ?? "en");
  const [owners, setOwners] = useState<AdminCatalogOwner[]>([]);
  const [policyKey, setPolicyKey] = useState<string | null>(null);
  const [contentLocale, setContentLocale] =
    useState<SupportedLocale>(directoryLocale);
  const publicationTarget = useMemo(
    () => (policyKey ? { kind: "POLICY" as const, policyKey } : null),
    [policyKey],
  );
  const [revisionId, setRevisionId] = useState<string | undefined>();
  const [state, setState] = useState<PolicyState | null>(null);
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [loading, setLoading] = useState(false),
    [listing, setListing] = useState(true),
    [mutating, setMutating] = useState(false);
  const [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0),
    [directoryRefresh, setDirectoryRefresh] = useState(0);
  const [bundle, setBundle] = useState<PolicyPackage | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [newKey, setNewKey] = useState(""),
    [newKind, setNewKind] = useState<PolicyKind>("TERMS");
  const editBuffer = useRef<PolicyEditBuffer | null>(null);
  const [conflict, setConflict] = useState(false);
  const running = useRef(false),
    mounted = useRef(true),
    fileEpoch = useRef(0);
  const busy = loading || listing || mutating;
  const dirty = Boolean(
    (draft && state?.draft && !samePolicyDraft(draft, state.draft)) ||
    (editBuffer.current?.state.draft &&
      !samePolicyDraft(
        editBuffer.current.draft,
        editBuffer.current.state.draft,
      )),
  );
  const adopt = useCallback((next: PolicyState) => {
    setState(next);
    setDraft(next.draft);
    setReviewed(false);
    setConflict(false);
    editBuffer.current = next.draft ? { state: next, draft: next.draft } : null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      fileEpoch.current++;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setListing(true);
    setError(null);
    void api
      .list(directoryLocale)
      .then((items) => {
        if (!active) return;
        setOwners(items);
        setPolicyKey((current) =>
          items.some(
            (owner) =>
              owner.target.kind === "POLICY" &&
              owner.target.policyKey === current,
          )
            ? current
            : items[0]?.target.kind === "POLICY"
              ? items[0].target.policyKey
              : null,
        );
      })
      .catch((failure: unknown) => {
        if (active) setError(failure);
      })
      .finally(() => {
        if (active) setListing(false);
      });
    return () => {
      active = false;
    };
  }, [api, directoryLocale, directoryRefresh]);
  useEffect(() => {
    if (!policyKey) {
      setState(null);
      setDraft(null);
      return;
    }
    let active = true;
    const buffered = editBuffer.current;
    const preserve =
      buffered?.state.draft &&
      !samePolicyDraft(buffered.state.draft, buffered.draft)
        ? buffered
        : null;
    setLoading(true);
    setError(null);
    setReviewed(false);
    void api
      .read({ kind: "POLICY", policyKey }, contentLocale, revisionId)
      .then((next) => {
        if (!active) return;
        if (preserve) {
          const continued = continuePolicyDraft(preserve, next);
          setState(continued.state);
          setDraft(continued.draft);
          setConflict(continued.conflict);
          setReviewed(false);
          editBuffer.current = continued.conflict
            ? preserve
            : continued.draft
              ? { state: continued.state, draft: continued.draft }
              : null;
          if (continued.conflict)
            setError(new AdminClientError("STALE_CONTENT"));
        } else adopt(next);
      })
      .catch((failure: unknown) => {
        if (active) {
          setConflict(true);
          if (preserve) {
            setState(preserve.state);
            setDraft(preserve.draft);
            setConflict(true);
          }
          setError(failure);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, policyKey, contentLocale, revisionId, refresh, adopt]);
  useLayoutEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useLayoutEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  useLayoutEffect(
    () => () => {
      onDirtyChange(false);
      onBusy(false);
    },
    [onDirtyChange, onBusy],
  );
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const canLeave = () =>
    !busy && !running.current && (!dirty || window.confirm(copy.discard));
  const run = (work: () => Promise<void>) => {
    if (busy || running.current) return;
    running.current = true;
    setMutating(true);
    setError(null);
    setNotice("");
    void work()
      .catch((failure: unknown) => {
        if (mounted.current) setError(failure);
      })
      .finally(() => {
        running.current = false;
        if (mounted.current) setMutating(false);
      });
  };
  const change = (value: PolicyDraft) => {
    if (state) editBuffer.current = { state, draft: value };
    setDraft(value);
    setReviewed(false);
    setNotice("");
  };
  const reload = () => {
    if (!canLeave()) return;
    editBuffer.current = null;
    if (state) setDraft(state.draft);
    setConflict(false);
    setLoading(true);
    setRevisionId(undefined);
    setRefresh((value) => value + 1);
    setDirectoryRefresh((value) => value + 1);
    setNotice("");
  };
  const workspace = state?.workspace;
  const allScopes = SUPPORTED_LOCALES.every((language) =>
    localeScopes.includes(language),
  );
  const canEdit =
    !conflict &&
    permissions.includes("content.edit") &&
    localeScopes.includes(contentLocale) &&
    (workspace ? workspace.editability.canSave : contentLocale === "en");
  const canPublish = permissions.includes("content.publish") && allScopes;
  const selected = draft?.translations.find(
    (row) => row.locale === contentLocale,
  );
  const fields = selected?.fields ?? emptyPolicyFields();
  const access = workspace
    ? policyReviewAccess({
        workspace,
        actorId,
        permissions,
        localeScopes,
        dirty: dirty || conflict,
      })
    : null;
  const kindLabel = (kind: PolicyKind | null) =>
    kind === null
      ? (state?.owner.label ?? policyKey ?? copy.title)
      : {
          TERMS: copy.terms,
          PRIVACY: copy.privacy,
          REFUND: copy.refund,
          DELIVERY: copy.delivery,
        }[kind];
  const save = () =>
    run(async () => {
      if (!state || !draft || !canEdit) throw new AdminClientError("FORBIDDEN");
      if (
        !validPolicyEffectiveTime(
          state.workspace ? (state.draft?.effectiveAt ?? "") : null,
          draft.effectiveAt,
          Date.now(),
        )
      )
        throw new AdminClientError("POLICY_EFFECTIVE_TIME_INVALID");
      if (
        (draft.refreshLocales ?? []).some(
          (language) => !localeScopes.includes(language),
        ) ||
        draft.translations.some(
          (row) =>
            !localeScopes.includes(row.locale) &&
            !state.draft?.translations.some(
              (old) =>
                old.locale === row.locale &&
                JSON.stringify(old) === JSON.stringify(row),
            ),
        )
      )
        throw new AdminClientError("FORBIDDEN");
      for (const row of draft.translations)
        policyTranslationFieldsSchema.parse(row.fields);
      const next = await api.save(state, draft, contentLocale);
      if (!mounted.current) return;
      adopt(next);
      setRevisionId(next.workspace?.target.revisionId);
      setDirectoryRefresh((value) => value + 1);
      setNotice(copy.saved);
    });
  const review = (action: "submit" | "approve") =>
    run(async () => {
      if (
        !workspace ||
        dirty ||
        !access?.[action] ||
        (action === "approve" && !reviewed)
      )
        throw new AdminClientError("FORBIDDEN");
      await api.review(workspace, action);
      const next = await api.read(
        workspace.target.owner,
        contentLocale,
        workspace.target.revisionId,
      );
      if (mounted.current) {
        adopt(next);
        setNotice(copy.reviewSaved);
      }
    });
  const code = error instanceof AdminClientError ? error.code : "";
  let errorMessage =
    error instanceof Error && error.name === "ZodError"
      ? copy.invalid
      : copy.requestFailed;
  switch (code) {
    case "STALE_VERSION":
    case "STALE_CONTENT":
    case "VERSION_CONFLICT":
    case "TARGET_CONFLICT":
      errorMessage = copy.stale;
      break;
    case "SESSION_EXPIRED":
    case "UNAUTHENTICATED":
      errorMessage = copy.expired;
      break;
    case "FORBIDDEN":
      errorMessage = copy.scope;
      break;
    case "INVALID_PACKAGE":
      errorMessage = copy.invalidPackage;
      break;
    case "PACKAGE_MISMATCH":
      errorMessage = copy.packageMismatch;
      break;
    case "POLICY_EFFECTIVE_TIME_INVALID":
      errorMessage = copy.futureTime;
      break;
  }
  return (
    <section
      className="policies-workspace"
      aria-label={copy.title}
      data-policies-workspace
      aria-busy={busy}
    >
      <header className="mc-workspace-header">
        <div>
          <Heading>{copy.title}</Heading>
          <p className="mc-hint">{copy.intro}</p>
        </div>
      </header>
      <div className="policy-toolbar">
        <label className="mc-field" htmlFor={`${prefix}-policy`}>
          <span>{copy.choose}</span>
          <select
            id={`${prefix}-policy`}
            value={policyKey ?? ""}
            disabled={busy || !owners.length}
            data-policy-picker
            onChange={(event) => {
              const key = event.currentTarget.value;
              if (key !== policyKey && canLeave()) {
                editBuffer.current = null;
                setConflict(false);
                setState(null);
                setDraft(null);
                setLoading(true);
                setPolicyKey(key);
                setRevisionId(undefined);
                setNotice("");
              }
            }}
          >
            {!owners.length && <option value="">{copy.empty}</option>}
            {owners.map(
              (owner) =>
                owner.target.kind === "POLICY" && (
                  <option
                    key={owner.target.policyKey}
                    value={owner.target.policyKey}
                  >
                    {owner.label ?? owner.target.policyKey}
                  </option>
                ),
            )}
          </select>
        </label>
        <Button type="button" variant="quiet" disabled={busy} onClick={reload}>
          {copy.reload}
        </Button>
      </div>
      {error !== null && (
        <p role="alert" className="admin-notice" data-policy-error>
          {errorMessage}
        </p>
      )}
      {notice && (
        <p role="status" data-policy-notice>
          {notice}
        </p>
      )}
      {busy && <p role="status">{t("loading")}</p>}
      {permissions.includes("content.policy.manage") && (
        <details className="policy-registration">
          <summary>{copy.create}</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!canLeave()) return;
              run(async () => {
                await api.register(newKey, newKind);
                const items = await api.list(directoryLocale);
                if (mounted.current) {
                  setOwners(items);
                  setState(null);
                  setDraft(null);
                  setPolicyKey(newKey);
                  setContentLocale(directoryLocale);
                  setRevisionId(undefined);
                  setRefresh((value) => value + 1);
                  setNewKey("");
                }
              });
            }}
          >
            <label className="mc-field" htmlFor={`${prefix}-key`}>
              <span>{copy.key}</span>
              <input
                id={`${prefix}-key`}
                value={newKey}
                disabled={busy}
                required
                minLength={1}
                maxLength={64}
                pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
                onChange={(event) => setNewKey(event.currentTarget.value)}
                aria-describedby={`${prefix}-key-hint`}
              />
            </label>
            <label className="mc-field" htmlFor={`${prefix}-type`}>
              <span>{copy.type}</span>
              <select
                id={`${prefix}-type`}
                value={newKind}
                disabled={busy}
                onChange={(event) =>
                  setNewKind(policyKindSchema.parse(event.currentTarget.value))
                }
              >
                {policyKindSchema.options.map((kind) => (
                  <option key={kind} value={kind}>
                    {kindLabel(kind)}
                  </option>
                ))}
              </select>
            </label>
            <p id={`${prefix}-key-hint`} className="mc-hint">
              {copy.keyHint}
            </p>
            <Button type="submit" disabled={busy || !newKey}>
              {copy.create}
            </Button>
          </form>
        </details>
      )}
      {state && draft && (
        <>
          <div className="policy-heading">
            <h2>{kindLabel(draft.kind)}</h2>
            {workspace && (
              <span>
                {t("revision")} {workspace.revisionNumber} ·{" "}
                <Status t={t} value={workspace.lifecycle.status} />
              </span>
            )}
            <span data-policy-dirty={dirty}>
              {dirty ? copy.pending : copy.latest}
            </span>
          </div>
          <div
            className="policy-languages"
            role="group"
            aria-label={copy.contentLanguage}
          >
            {SUPPORTED_LOCALES.map((language) => {
              const cell = workspace?.cells.find(
                (row) => row.locale === language,
              );
              const status =
                cell?.access === "READABLE"
                  ? cell.status
                  : cell?.access === "RESTRICTED"
                    ? "RESTRICTED"
                    : "MISSING";
              return (
                <button
                  key={language}
                  type="button"
                  aria-pressed={language === contentLocale}
                  disabled={busy || !localeScopes.includes(language)}
                  onClick={() => {
                    if (
                      language !== contentLocale &&
                      !busy &&
                      !running.current
                    ) {
                      setLoading(true);
                      setContentLocale(language);
                      setNotice("");
                    }
                  }}
                  data-policy-locale={language}
                >
                  <span>{LOCALE_NATIVE_NAMES[language]}</span>
                  <small>
                    {status === "RESTRICTED" ? (
                      copy.restricted
                    ) : status === "MISSING" ? (
                      copy.missing
                    ) : (
                      <Status t={t} value={status} />
                    )}
                  </small>
                </button>
              );
            })}
          </div>
          <details className="policy-import">
            <summary>{copy.importTitle}</summary>
            <p className="mc-hint">{copy.importHint}</p>
            <label className="mc-field" htmlFor={`${prefix}-file`}>
              <span>{copy.importFile}</span>
              <input
                id={`${prefix}-file`}
                type="file"
                accept="application/json,.json"
                disabled={
                  busy || !permissions.includes("content.edit") || !allScopes
                }
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0],
                    epoch = ++fileEpoch.current;
                  event.currentTarget.value = "";
                  if (!file) return;
                  setBundle(null);
                  setError(null);
                  if (file.size > 2_000_000) {
                    setError(new AdminClientError("INVALID_PACKAGE"));
                    return;
                  }
                  void file
                    .text()
                    .then((text) => {
                      const parsed = parsePolicyPackage(text);
                      if (mounted.current && fileEpoch.current === epoch) {
                        setBundle(parsed);
                        setNotice(copy.packageReady);
                      }
                    })
                    .catch(() => {
                      if (mounted.current && fileEpoch.current === epoch)
                        setError(new AdminClientError("INVALID_PACKAGE"));
                    });
                }}
              />
            </label>
            {bundle && (
              <>
                <p>
                  {bundle.documents
                    .map((document) => kindLabel(document.kind))
                    .join(" · ")}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || !canEdit || !allScopes}
                  onClick={() => {
                    const document = bundle.documents.find(
                      (value) => value.kind === draft.kind,
                    );
                    if (!document) {
                      setError(new AdminClientError("PACKAGE_MISMATCH"));
                      return;
                    }
                    if (dirty && !window.confirm(copy.discard)) return;
                    change({
                      ...draft,
                      translations: document.translations,
                      refreshLocales: [...SUPPORTED_LOCALES],
                    });
                    setNotice(copy.importedDraft);
                  }}
                  data-policy-apply-package
                >
                  {copy.applyImport}
                </Button>
              </>
            )}
          </details>
          {!canEdit && <p className="mc-hint">{copy.scope}</p>}
          <div className="policy-content-grid">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
              data-policy-form
            >
              <PolicyEditor
                copy={copy}
                locale={contentLocale}
                draft={draft}
                disabled={busy || !canEdit}
                canStructure={
                  allScopes && (!workspace || Boolean(draft.effectiveAt))
                }
                onChange={change}
              />
              {workspace?.selected?.context.stale && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || !canEdit}
                  onClick={() =>
                    change({
                      ...draft,
                      refreshLocales: [
                        ...new Set([
                          ...(draft.refreshLocales ?? []),
                          contentLocale,
                        ]),
                      ],
                    })
                  }
                  data-policy-source-refresh
                >
                  {copy.sourceRefresh}
                </Button>
              )}
              <div className="admin-actions">
                <Button
                  type="submit"
                  disabled={busy || !canEdit || !dirty}
                  data-policy-save
                >
                  {copy.save}
                </Button>
              </div>
            </form>
            <section
              className="policy-preview-region"
              aria-label={copy.preview}
            >
              <h3>{copy.preview}</h3>
              <p className="mc-hint">{copy.previewHint}</p>
              <PolicyPreview
                {...fields}
                locale={contentLocale}
                invalidLabel={copy.invalid}
              />
            </section>
          </div>
          {contentLocale !== "en" && workspace?.source.kind === "POLICY" && (
            <details className="policy-source">
              <summary>{copy.source}</summary>
              <PolicyPreview
                {...(draft.translations.find((row) => row.locale === "en")
                  ?.fields ?? workspace.source.fields)}
                locale="en"
                invalidLabel={copy.invalid}
              />
            </details>
          )}
          {workspace && access && publicationTarget && (
            <>
              {dirty && <p className="mc-hint">{copy.saveFirst}</p>}
              <PolicyReview
                copy={copy}
                access={access}
                busy={busy}
                checked={reviewed}
                onCheck={setReviewed}
                onSubmit={() => review("submit")}
                onApprove={() => review("approve")}
              />
              <Publishing
                key={`${policyKey}:${workspace.target.revisionId}`}
                client={api.client}
                target={publicationTarget}
                revisionId={workspace.target.revisionId}
                lifecycle={workspace.lifecycle.status}
                reason="POLICY_PUBLICATION"
                t={t}
                busy={busy}
                disabled={dirty || conflict}
                canPublish={canPublish}
                run={run}
                refresh={() => setRefresh((value) => value + 1)}
                onSelectRevision={(id) => {
                  if (canLeave()) {
                    editBuffer.current = null;
                    setConflict(false);
                    setState(null);
                    setDraft(null);
                    setLoading(true);
                    setRevisionId(id);
                    setNotice("");
                  }
                }}
              />
            </>
          )}
        </>
      )}
      {state && !draft && <p>{copy.noRevision}</p>}
    </section>
  );
}
