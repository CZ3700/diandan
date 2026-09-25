"use client";
import { useEffect, useState } from "react";
import { createMediaUploadAttempt } from "./media-upload-attempt";
import { Button, Field } from "@fan-support/ui";
import {
  adminResourceResponseSchema,
  MEDIA_IMAGE_PROFILE,
  type ResourceMediaSnapshot,
  type ResourceMediaJobResponse,
  type AdminCatalogOwner,
  adminCatalogResponseSchema,
} from "@fan-support/contracts";
import {
  AdminClientError,
  type AdminClient,
  type AdminSession,
} from "./client";
import { Select, Status, errorText, type Translate } from "./components";
export function MediaUpload({
  client,
  t,
  onComplete,
}: {
  client: AdminClient;
  t: Translate;
  onComplete: (owner: AdminCatalogOwner) => void;
}) {
  const [attempt] = useState(createMediaUploadAttempt);
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > MEDIA_IMAGE_PROFILE.sourceByteLimit || file.size === 0)
        throw new AdminClientError("INVALID_COMMAND");
      const bytes = await file.arrayBuffer();
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      const checksumSha256 = Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const owner = await attempt.upload(
        client,
        {
          checksumSha256,
          byteSize: file.size,
          mimeType: file.type,
          rightsReference: reference,
        },
        bytes,
      );
      onComplete(owner);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-upload">
      <h2>{t("upload")}</h2>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      <label className="admin-field">
        <span>{t("file")}</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <Field
        id="upload-rights"
        label={t("rightsReference")}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        maxLength={256}
      />
      <Button
        disabled={!file || !reference || busy}
        loading={busy}
        onClick={() => void upload()}
      >
        {t("upload")}
      </Button>
    </section>
  );
}
type Job = Extract<ResourceMediaJobResponse, { outcome: "SUCCESS" }>["job"];
export function MediaTools({
  client,
  session,
  assetId,
  revisionId,
  reason,
  t,
  run,
  busy,
  refresh,
  initialJobId = null,
  onOpen,
}: {
  onOpen: (owner: AdminCatalogOwner) => void;
  client: AdminClient;
  session: AdminSession;
  assetId: string;
  revisionId: string | null;
  reason: string;
  t: Translate;
  run: (work: () => Promise<void>) => void;
  busy: boolean;
  refresh: () => void;
  initialJobId?: string | null;
}) {
  const [media, setMedia] = useState<ResourceMediaSnapshot | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [role, setRole] = useState("PORTRAIT");
  const [fit, setFit] = useState("COVER");
  useEffect(() => {
    let active = true;
    void client
      .call(
        "media-read",
        { schemaVersion: 1, assetId },
        adminResourceResponseSchema,
      )
      .then((result) => {
        if (active && result.kind === "MEDIA") setMedia(result.media);
      })
      .catch((e: unknown) => {
        if (active) setError(errorText(e, t));
      });
    return () => {
      active = false;
    };
  }, [assetId, client, t]);
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const result = await client.call(
          "media-job-read",
          { schemaVersion: 1, jobId },
          adminResourceResponseSchema,
        );
        if (!active || result.kind !== "MEDIA_JOB") return;
        setJob(result.job);
        if (
          result.job.snapshot.status === "PENDING" ||
          result.job.snapshot.status === "PROCESSING"
        )
          timer = setTimeout(() => void read(), 3000);
      } catch (e) {
        if (active) setError(errorText(e, t));
      }
    };
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [jobId, client, t]);
  const rights = async (rightsStatus: "APPROVED" | "REJECTED") => {
    if (!media) return;
    await client.call(
      "media-rights",
      {
        schemaVersion: 1,
        assetId,
        rightsStatus,
        expectedVersion: media.rightsVersion,
        evidenceReference: reference,
        reasonCode: reason,
      },
      adminResourceResponseSchema,
      true,
    );
    const result = await client.call(
      "media-read",
      { schemaVersion: 1, assetId },
      adminResourceResponseSchema,
    );
    if (result.kind === "MEDIA") setMedia(result.media);
    refresh();
  };
  return (
    <section className="admin-media-tools">
      <h2>{t("media")}</h2>
      {error && <p role="alert">{error}</p>}
      {media && (
        <>
          <p>
            {media.width} × {media.height} · {media.mimeType}
          </p>
          <Status value={media.rightsStatus} t={t} />
          <Field
            id="rights-evidence"
            label={t("rightsReference")}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <div className="admin-actions">
            <Button
              variant="secondary"
              disabled={
                busy ||
                !reference ||
                !session.permissions.includes("content.media.rights")
              }
              onClick={() => run(() => rights("APPROVED"))}
            >
              {t("approveRights")}
            </Button>
            <Button
              variant="danger"
              disabled={
                busy ||
                !reference ||
                !session.permissions.includes("content.media.rights")
              }
              onClick={() => run(() => rights("REJECTED"))}
            >
              {t("revokeRights")}
            </Button>
          </div>
          <div className="admin-form-grid">
            <Select label={t("role")} value={role} onChange={setRole}>
              <option value="PORTRAIT">{t("portrait")}</option>
              <option value="HERO_DESKTOP">{t("heroDesktop")}</option>
              <option value="HERO_MOBILE">{t("heroMobile")}</option>
              <option value="GIFT_PRIMARY">{t("featuredGift")}</option>
            </Select>
            <Select label={t("fit")} value={fit} onChange={setFit}>
              <option value="COVER">{t("cover")}</option>
              <option value="CONTAIN">{t("contain")}</option>
            </Select>
          </div>
          <Button
            variant="secondary"
            disabled={
              busy ||
              !revisionId ||
              media.identityKind !== "SOURCE" ||
              !session.permissions.includes("content.media.process")
            }
            onClick={() =>
              run(async () => {
                const result = await client.call(
                  "media-enqueue",
                  {
                    schemaVersion: 1,
                    sourceAssetId: assetId,
                    metadataRevisionId: revisionId,
                    role,
                    fit,
                    expectedVersion: 0,
                    reasonCode: reason,
                  },
                  adminResourceResponseSchema,
                  true,
                );
                if (result.kind === "MUTATION") setJobId(result.resultId);
              })
            }
          >
            {t("process")}
          </Button>
        </>
      )}
      {job && (
        <div className="admin-notice">
          <Status value={job.snapshot.status} t={t} />
          {job.snapshot.error && <code>{job.snapshot.error.code}</code>}
          {job.snapshot.outputAssetId && (
            <p>
              {t("succeeded")}:{" "}
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await client.call(
                      "catalog-owner",
                      {
                        schemaVersion: 1,
                        target: {
                          kind: "MEDIA_METADATA",
                          mediaAssetId: job.snapshot.outputAssetId,
                        },
                        locale: session.localeScopes[0] ?? "en",
                      },
                      adminCatalogResponseSchema,
                    );
                    if (result.kind === "OWNER") onOpen(result.owner);
                  })
                }
              >
                {t("openGenerated")}
              </Button>
            </p>
          )}
          {job.snapshot.status === "FAILED" && (
            <Button
              disabled={
                busy || !session.permissions.includes("content.media.process")
              }
              variant="secondary"
              onClick={() =>
                run(async () => {
                  const result = await client.call(
                    "media-retry",
                    {
                      schemaVersion: 1,
                      jobId: job.snapshot.jobId,
                      expectedVersion: job.snapshot.attemptCount,
                      reasonCode: reason,
                    },
                    adminResourceResponseSchema,
                    true,
                  );
                  if (result.kind === "MUTATION") {
                    setJob(null);
                    setJobId(result.resultId);
                  }
                })
              }
            >
              {t("retry")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
