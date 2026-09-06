"use client";
import { useEffect, useState } from "react";
import { ArtistIdentity } from "./artist-identity";
import { Button, Field } from "@fan-support/ui";
import {
  translationTransferPackageSchema,
  translationTransferResponseSchema,
  LOCALE_NATIVE_NAMES,
} from "@fan-support/contracts";
import { AdminClientError } from "./client";
import { ContentFields, StructureFields } from "./content-form";
import { LocaleSelect, Select, Status, TextArea } from "./components";
import { GiftDetailsEditor } from "./gift-details-editor";
import { GiftDetailReview } from "./gift-detail-review";
import { GiftCommercePanel } from "./gift-commerce-panel";
import { previewHref } from "./state";
import { Publishing } from "./publishing";
import { MediaTools } from "./media-tools";
import { useContentEditor } from "./editor-state";
export function ContentEditor(props: Parameters<typeof useContentEditor>[0]) {
  const { client, session, owner, t, onRefresh, onOpen } = props;
  const {
    locale,
    revisionId,
    workspace,
    snapshot,
    draft,
    fields,
    aliases,
    dirty,
    busy,
    loading,
    error,
    errors,
    message,
    reason,
    canEdit,
    canReview,
    canPublish,
    contentTarget,
    refresh,
    run,
    changeLocale,
    save,
    review,
    reviewAliases,
    exportPackage,
    readOnly,
    context,
    setDraft,
    setStructureDirty,
    setDetailsDirty,
    gift,
    giftKind,
    detailReview,
    detailReviewError,
    setGiftKind,
    setDirty,
    setFields,
    setAliases,
    setAliasesDirty,
    setReason,
    setRevisionId,
  } = useContentEditor(props);
  const [identityDirty, setIdentityDirty] = useState(false);
  useEffect(() => {
    props.onDirty(dirty || identityDirty);
    return () => props.onDirty(false);
  }, [dirty, identityDirty, props.onDirty]);
  return (
    <article
      className="admin-editor"
      aria-busy={loading || busy}
      data-testid="content-editor"
    >
      <header className="admin-editor-heading">
        <div>
          <span className="admin-eyebrow">{t("content")}</span>
          <h1>
            {owner.label ??
              owner.handle ??
              t(owner.target.kind === "HOMEPAGE" ? "homepage" : "draft")}
          </h1>
          <div className="admin-actions">
            <Status value={owner.status} t={t} />
            {workspace && (
              <span>
                {t("revision")} {workspace.revisionNumber}
              </span>
            )}
            {(dirty || identityDirty) && (
              <span className="admin-unsaved">{t("unsaved")}</span>
            )}
          </div>
        </div>
        <LocaleSelect
          label={t("contentLanguage")}
          value={locale}
          onChange={changeLocale}
          disabled={busy || identityDirty}
          allowed={!revisionId ? ["en"] : session.localeScopes}
        />
      </header>
      {error && (
        <div role="alert" className="admin-notice admin-error">
          {error}
          {errors.length > 0 && <p>{errors.join(" · ")}</p>}
          <Button
            variant="quiet"
            disabled={busy || identityDirty}
            onClick={() => {
              if (!dirty || window.confirm(t("discard"))) refresh();
            }}
          >
            {t("reload")}
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="admin-notice">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          {gift && props.commerce && (
            <GiftCommercePanel
              client={client}
              gift={gift}
              context={props.commerce}
              locale={props.initialLocale}
              t={t}
              reason={reason}
              busy={busy || dirty}
              run={run}
              refresh={refresh}
              onDirty={setIdentityDirty}
            />
          )}
          {gift && (
            <Select
              label={t("giftType")}
              value={giftKind}
              disabled={readOnly || identityDirty}
              onChange={(value) => {
                setGiftKind(value as typeof giftKind);
                setDirty(true);
              }}
            >
              {(
                [
                  ["VIRTUAL", "kindVirtual"],
                  ["PHYSICAL", "kindPhysical"],
                  ["WISH", "kindWish"],
                  ["MERCHANDISE", "kindMerchandise"],
                  ["OTHER", "kindOther"],
                ] as const
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </Select>
          )}
          {owner.status === "archived" && (
            <p className="admin-notice">{t("archiveHint")}</p>
          )}
          {workspace &&
            !workspace.editability.canSave &&
            workspace.editability.reason === "COPY_SCOPE_REQUIRED" && (
              <p>{t("copyScope")}</p>
            )}
          {workspace && (
            <div
              role="group"
              className="admin-locale-matrix"
              aria-label={t("translations")}
            >
              {workspace.cells.map((cell) => (
                <button
                  key={cell.locale}
                  type="button"
                  disabled={
                    cell.access === "RESTRICTED" || busy || identityDirty
                  }
                  aria-pressed={locale === cell.locale}
                  onClick={() => changeLocale(cell.locale)}
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
          )}
          <div className="admin-translation-columns">
            <section>
              <h2>{t("content")}</h2>
              <ContentFields
                fields={fields}
                t={t}
                disabled={readOnly || identityDirty}
                errors={errors}
                onChange={(next) => {
                  setFields(next);
                  setDirty(true);
                }}
              />
            </section>
            {workspace && locale !== "en" && (
              <aside className="admin-source">
                <h2>{t("source")}</h2>
                <ContentFields
                  fields={workspace.source.fields}
                  t={t}
                  disabled
                  onChange={() => {}}
                />
                {workspace.sourceDiff.previous ? (
                  <details open>
                    <summary>{t("oldSource")}</summary>
                    <ContentFields
                      fields={workspace.sourceDiff.previous.text.fields}
                      t={t}
                      disabled
                      onChange={() => {}}
                    />
                    <p>
                      {t("changedFields")}:{" "}
                      {workspace.sourceDiff.changedPaths.join(" · ")}
                    </p>
                  </details>
                ) : (
                  <p>
                    {t(
                      workspace.sourceDiff.status === "CURRENT"
                        ? "sourceCurrent"
                        : "sourceUnavailable",
                    )}
                  </p>
                )}
              </aside>
            )}
          </div>
          {draft && (
            <details open={!revisionId}>
              <summary>{t("structure")}</summary>
              <StructureFields
                content={draft}
                client={client}
                locale={locale}
                t={t}
                disabled={readOnly || identityDirty}
                onChange={(next) => {
                  setDraft(next);
                  setStructureDirty(true);
                  setDirty(true);
                  if (next.kind === "HOMEPAGE") {
                    const labels = next.translations.find(
                      (row) => row.locale === locale,
                    )?.fields.slotLabels;
                    if (labels)
                      setFields((old) => ({
                        ...old,
                        slotLabels: labels.map((row) => {
                          const existing = (
                            old["slotLabels"] as
                              { slotKey: string; label: string }[] | undefined
                          )?.find((label) => label.slotKey === row.slotKey);
                          return existing ?? row;
                        }),
                      }));
                  }
                }}
              />
            </details>
          )}
          {draft?.kind === "IDOL" && (
            <details>
              <summary>{t("aliases")}</summary>
              <TextArea
                label={t("aliases")}
                hint={t("aliasHint")}
                value={aliases}
                disabled={readOnly}
                onChange={(text) => {
                  setAliases(text);
                  setAliasesDirty(true);
                  setDirty(true);
                }}
              />
              {snapshot?.extensions.aliases && (
                <div className="admin-actions">
                  <Status
                    value={snapshot.extensions.aliases.review.status}
                    t={t}
                  />
                  <Button
                    variant="secondary"
                    disabled={
                      busy ||
                      dirty ||
                      snapshot.extensions.aliases.review.status !== "DRAFT" ||
                      !canEdit
                    }
                    onClick={() => run(() => reviewAliases("submit"))}
                  >
                    {t("submit")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={
                      busy ||
                      dirty ||
                      snapshot.extensions.aliases.review.status !==
                        "IN_REVIEW" ||
                      !canReview ||
                      snapshot.extensions.aliases.editorId ===
                        session.actorId ||
                      snapshot.createdBy === session.actorId
                    }
                    onClick={() => run(() => reviewAliases("approve"))}
                  >
                    {t("reviewAliases")}
                  </Button>
                </div>
              )}
            </details>
          )}
          {(draft?.kind === "GIFT" || detailReview || detailReviewError) && (
            <details open={!revisionId || !draft}>
              <summary>{t("details")}</summary>
              {detailReviewError && (
                <p role="alert" className="admin-error">
                  {detailReviewError}
                </p>
              )}
              {draft?.kind === "GIFT" && (
                <GiftDetailsEditor
                  details={draft.details}
                  locale={locale}
                  client={client}
                  t={t}
                  disabled={readOnly || identityDirty}
                  onChange={(details) => {
                    setDraft({ ...draft, details });
                    setDetailsDirty(true);
                    setDirty(true);
                  }}
                />
              )}
              {detailReview && (
                <GiftDetailReview
                  review={detailReview}
                  actorId={session.actorId}
                  permissions={session.permissions}
                  blocked={busy || dirty || identityDirty}
                  t={t}
                  onReview={(action) => run(() => reviewAliases(action))}
                />
              )}
            </details>
          )}
          <Field
            id="change-reason"
            label={t("reason")}
            hint={t("reasonHint")}
            value={reason}
            pattern="[A-Z][A-Z0-9_]{1,127}"
            maxLength={128}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="admin-save-bar">
            <Button
              disabled={
                readOnly ||
                identityDirty ||
                (!dirty && Boolean(revisionId)) ||
                (gift !== null && gift.variants.length === 0)
              }
              loading={busy}
              onClick={() => run(save, t("saved"))}
            >
              {t("save")}
            </Button>
            {revisionId && (
              <>
                <Button
                  variant="secondary"
                  disabled={
                    busy ||
                    dirty ||
                    identityDirty ||
                    !context ||
                    context.audit.review.status !== "DRAFT" ||
                    !canEdit
                  }
                  onClick={() => run(() => review("submit"))}
                >
                  {t("submit")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={
                    busy ||
                    dirty ||
                    identityDirty ||
                    !context ||
                    context.audit.review.status !== "IN_REVIEW" ||
                    !canReview ||
                    context.audit.editorId === session.actorId ||
                    context.structureEditorId === session.actorId ||
                    context.stale
                  }
                  onClick={() => run(() => review("approve"))}
                >
                  {t("approve")}
                </Button>
              </>
            )}
          </div>
          <p className="admin-muted">{t("reviewHint")}</p>
          {contentTarget && (
            <>
              <div className="admin-actions">
                {(["desktop", "mobile"] as const).map((viewport) => (
                  <a
                    key={viewport}
                    href={previewHref(contentTarget, viewport)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (dirty || busy || identityDirty) e.preventDefault();
                    }}
                    aria-disabled={dirty || busy || identityDirty}
                  >
                    {t(
                      viewport === "desktop"
                        ? "previewDesktop"
                        : "previewMobile",
                    )}
                  </a>
                ))}
              </div>
              <details>
                <summary>{t("translations")}</summary>
                <p>{t("importHint")}</p>
                <div className="admin-actions">
                  <Button
                    variant="secondary"
                    disabled={busy || dirty || identityDirty}
                    onClick={() => run(exportPackage)}
                  >
                    {t("export")}
                  </Button>
                  <label className="admin-field">
                    <span>{t("import")}</span>
                    <input
                      type="file"
                      accept="application/json,.json"
                      disabled={busy || dirty || identityDirty || !canEdit}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        run(async () => {
                          if (file.size > 16 * 1024 * 1024)
                            throw new AdminClientError("INVALID_COMMAND");
                          const pack = translationTransferPackageSchema.parse(
                            JSON.parse(await file.text()),
                          );
                          if (
                            JSON.stringify(pack.target.owner) !==
                              JSON.stringify(owner.target) ||
                            pack.target.revisionId !== revisionId
                          )
                            throw new AdminClientError("INVALID_COMMAND");
                          const result = await client.call(
                            "translation-import",
                            {
                              schemaVersion: 1,
                              package: pack,
                              reasonCode: reason,
                            },
                            translationTransferResponseSchema,
                            true,
                          );
                          if (result.kind === "MUTATION") {
                            setRevisionId(result.resultId);
                            refresh();
                          }
                        });
                      }}
                    />
                  </label>
                </div>
              </details>
              <Publishing
                client={client}
                target={owner.target}
                revisionId={contentTarget.revisionId}
                lifecycle={
                  workspace?.lifecycle.status ??
                  snapshot?.lifecycle.status ??
                  "DRAFT"
                }
                reason={reason}
                t={t}
                busy={busy}
                disabled={dirty || identityDirty || owner.status === "archived"}
                canPublish={canPublish}
                run={run}
                refresh={onRefresh}
                onSelectRevision={setRevisionId}
              />
            </>
          )}
          {owner.target.kind === "MEDIA_METADATA" && (
            <MediaTools
              client={client}
              session={session}
              assetId={owner.target.mediaAssetId}
              initialJobId={owner.media?.latestProcessingJobId ?? null}
              onOpen={onOpen}
              revisionId={revisionId}
              reason={reason}
              t={t}
              run={run}
              busy={busy || dirty}
              refresh={refresh}
            />
          )}{" "}
        </>
      )}
      {owner.target.kind === "IDOL" && (
        <ArtistIdentity
          client={client}
          owner={owner}
          session={session}
          t={t}
          reason={reason}
          busy={busy || loading}
          contentDirty={dirty}
          run={run}
          refresh={refresh}
          onDirty={setIdentityDirty}
        />
      )}
    </article>
  );
}
