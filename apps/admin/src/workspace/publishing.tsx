"use client";
import { useEffect, useState } from "react";
import { Button } from "@fan-support/ui";
import {
  adminCatalogResponseSchema,
  publicationPreflightResponseSchema,
  publicationRuntimeResponseSchema,
  type ContentAuthoringTarget,
  type PublicationPreflightResponse,
  type PublicationStatusResponse,
  type AdminCatalogResponse,
} from "@fan-support/contracts";
import { createPublicationAttempt } from "./publication-attempt";
import { type AdminClient } from "./client";
import { Status, type Translate } from "./components";
type Preflight = Extract<PublicationPreflightResponse, { outcome: "SUCCESS" }>;
type History = Extract<AdminCatalogResponse, { kind: "HISTORY" }>;
type PublicationStatus = Extract<
  PublicationStatusResponse,
  { outcome: "SUCCESS" }
>;
export function Publishing({
  client,
  target,
  revisionId,
  lifecycle,
  reason,
  t,
  busy,
  disabled,
  canPublish,
  run,
  refresh,
  onSelectRevision,
}: {
  client: AdminClient;
  target: ContentAuthoringTarget;
  revisionId: string;
  lifecycle: string;
  reason: string;
  t: Translate;
  busy: boolean;
  disabled: boolean;
  canPublish: boolean;
  run: (work: () => Promise<void>) => void;
  refresh: () => void;
  onSelectRevision: (id: string) => void;
}) {
  const [attempt] = useState(createPublicationAttempt);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [status, setStatus] = useState<PublicationStatus | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [page, setPage] = useState(1);
  const [historyKind, setHistoryKind] = useState<
    "REVISIONS" | "PUBLICATIONS" | "IDENTITY"
  >("REVISIONS");
  useEffect(() => {
    setPreflight(null);
    setStatus(null);
    setHistory(null);
    setPage(1);
  }, [target, revisionId]);
  const loadStatus = async (publicationId: string) => {
    const result = await client.call(
      "publication-status",
      { schemaVersion: 1, publicationId },
      publicationRuntimeResponseSchema,
    );
    if (result.kind === "PUBLICATION_STATUS") setStatus(result);
  };
  const check = async (
    id = revisionId,
    action: "PUBLISH" | "ROLLBACK" = "PUBLISH",
  ) => {
    const result = await client.call(
      "publication-preflight",
      { schemaVersion: 1, action, target: { owner: target, revisionId: id } },
      publicationPreflightResponseSchema,
    );
    setPreflight(result);
    return result;
  };
  const publish = async () => {
    if (!preflight?.ready) return;
    const result = await attempt.publish(
      client,
      preflight,
      lifecycle,
      reason,
      setPreflight,
    );
    if (result.kind === "PUBLICATION_MUTATION" && result.publicationId)
      await loadStatus(result.publicationId);
    setPreflight(null);
    refresh();
  };
  const loadHistory = async (nextPage: number, nextKind = historyKind) => {
    const result = await client.call(
      "catalog-history",
      {
        schemaVersion: 1,
        target,
        history: nextKind,
        page: nextPage,
        pageSize: 10,
      },
      adminCatalogResponseSchema,
    );
    if (result.kind === "HISTORY") {
      setHistory(result);
      setPage(nextPage);
      setHistoryKind(nextKind);
    }
  };
  return (
    <section className="admin-publishing">
      <h2>{t("publish")}</h2>
      <div className="admin-actions">
        <Button
          variant="secondary"
          disabled={busy || disabled}
          onClick={() =>
            run(async () => {
              await check();
            })
          }
        >
          {t("preflight")}
        </Button>
        {preflight?.ready && (
          <Button
            disabled={busy || disabled || !canPublish}
            onClick={() => run(publish)}
          >
            {t(preflight.action === "ROLLBACK" ? "rollback" : "publish")}
          </Button>
        )}
      </div>
      {preflight && (
        <div role="status" className="admin-notice">
          <strong>{t(preflight.ready ? "ready" : "blocked")}</strong>
          {preflight.issues.length > 0 && (
            <ul>
              {preflight.issues.map((issue, index) => (
                <li key={index}>
                  <Status t={t} value={issue.severity} />{" "}
                  <code>{issue.code}</code> {issue.locale}{" "}
                  <small>{issue.path.join(" · ")}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {status && (
        <div className="admin-notice">
          <div className="admin-actions">
            <code>{status.publicationId}</code>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => run(() => loadStatus(status.publicationId))}
            >
              {t("refreshStatus")}
            </Button>
          </div>
          <ul className="admin-job-list">
            {status.jobs.map((job) => (
              <li key={job.id}>
                <span>{job.locale}</span>
                <Status value={job.status} t={t} />
                {job.status === "FAILED" && (
                  <Button
                    variant="quiet"
                    disabled={
                      busy ||
                      !canPublish ||
                      status.jobs.some(
                        (candidate) => candidate.retryOf === job.id,
                      )
                    }
                    onClick={() =>
                      run(async () => {
                        await client.call(
                          "publication-retry",
                          {
                            schemaVersion: 1,
                            publicationId: status.publicationId,
                            purgeJobId: job.id,
                            expectedVersion: job.version,
                            reasonCode: reason,
                          },
                          publicationRuntimeResponseSchema,
                          true,
                        );
                        await loadStatus(status.publicationId);
                      })
                    }
                  >
                    {t("retry")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details>
        <summary>{t("history")}</summary>
        <div className="admin-actions">
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => run(() => loadHistory(1, "REVISIONS"))}
          >
            {t("revision")}
          </Button>
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => run(() => loadHistory(1, "PUBLICATIONS"))}
          >
            {t("publish")}
          </Button>
          {target.kind === "IDOL" && (
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => run(() => loadHistory(1, "IDENTITY"))}
            >
              {t("status")}
            </Button>
          )}
        </div>
        {history && (
          <>
            <ul className="admin-history">
              {history.items.map((row, index) => (
                <li key={index}>
                  {row.kind === "REVISION" ? (
                    <>
                      <Button
                        variant="quiet"
                        disabled={disabled || busy}
                        onClick={() => onSelectRevision(row.revisionId)}
                      >
                        {t("revision")} {row.revisionNumber}
                      </Button>
                      <Status value={row.lifecycle.status} t={t} />
                      <time>{row.createdAt}</time>
                    </>
                  ) : row.kind === "PUBLICATION" ? (
                    <>
                      <code>{row.publicationId.slice(0, 8)}</code>
                      <span>{row.action}</span>
                      <time>{row.publishedAt}</time>
                      <Button
                        variant="quiet"
                        disabled={
                          disabled || busy || row.isCurrent || !canPublish
                        }
                        onClick={() =>
                          run(async () => {
                            await check(row.revisionId, "ROLLBACK");
                          })
                        }
                      >
                        {t("rollback")}
                      </Button>
                      <Button
                        variant="quiet"
                        onClick={() => run(() => loadStatus(row.publicationId))}
                      >
                        {t("status")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <code>{row.action}</code>
                      <span>
                        {row.oldHandle} → {row.newHandle}
                      </span>
                      <time>{row.createdAt}</time>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <div className="admin-actions">
              <Button
                variant="quiet"
                disabled={busy || page === 1}
                onClick={() => run(() => loadHistory(page - 1))}
              >
                {t("previous")}
              </Button>
              <span>{page}</span>
              <Button
                variant="quiet"
                disabled={busy || page * 10 >= history.totalItems}
                onClick={() => run(() => loadHistory(page + 1))}
              >
                {t("next")}
              </Button>
            </div>
          </>
        )}
      </details>
    </section>
  );
}
