import {
  managementCenterIntentSchema,
  sourceHashSchema,
  type ManagementCenterIntent,
  type ManagementCenterOperation,
} from "@fan-support/contracts";
import { AdminClientError } from "../workspace/client";
import type { ManagementApi, PreparedUpload } from "./api";
import { imageSelectionIssue } from "./inputs";
import type { PhotoEdit } from "./focal-model";
export type SubmissionPhase = "UPLOADING" | "SUBMITTING";
type ImageIntent = Exclude<ManagementCenterIntent, { kind: "RESTORE_POSTER" }>;
export type SubmissionIntent =
  | ManagementCenterIntent
  | (ImageIntent extends infer Intent
      ? Intent extends ImageIntent
        ? Omit<Intent, "image"> & { image: Intent["image"] | PhotoEdit | null }
        : never
      : never);
/** Local upload checkpoints contain no credentials or source text and never enter browser storage. */
export function createManagementSubmission(
  api: ManagementApi,
  transport: typeof fetch = fetch,
) {
  let upload: { file: File; grant: PreparedUpload; complete: boolean } | null =
    null;
  let active: Promise<ManagementCenterOperation> | null = null;
  async function run(
    intent: SubmissionIntent,
    file: File | null,
    phase: (phase: SubmissionPhase) => void,
  ) {
    let ready: unknown = intent;
    if (file) {
      const issue = imageSelectionIssue(file);
      if (issue) throw new AdminClientError(issue);
      phase("UPLOADING");
      if (
        !upload ||
        upload.file !== file ||
        (!upload.complete &&
          Date.parse(upload.grant.grant.expiresAt) <= Date.now())
      ) {
        const bytes = await file.arrayBuffer();
        const checksumSha256 = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        const mimeType = file.type as "image/jpeg" | "image/png" | "image/webp";
        const grant = await api.prepare({
          schemaVersion: 1,
          checksumSha256: sourceHashSchema.parse(checksumSha256),
          byteSize: file.size,
          mimeType,
          rightsConfirmed: true,
        });
        upload = { file, grant, complete: false };
      }
      if (!upload.complete) {
        let response: Response;
        try {
          response = await transport(upload.grant.grant.url, {
            method: "PUT",
            headers: upload.grant.grant.headers,
            body: file,
            credentials: "omit",
            redirect: "error",
            referrerPolicy: "no-referrer",
            signal: AbortSignal.timeout(30000),
          });
        } catch {
          throw new AdminClientError("NETWORK_ERROR");
        }
        if (!response.ok && response.status !== 412)
          throw new AdminClientError("UPLOAD_FAILED");
        // A 412 only permits server-side inspection; it is never proof that publication succeeded.
        upload.complete = true;
      }
      const focalPoint =
        "image" in intent && intent.image && "focalPoint" in intent.image
          ? intent.image.focalPoint
          : undefined;
      ready = {
        ...intent,
        image: {
          uploadId: upload.grant.uploadId,
          ...(focalPoint ? { focalPoint } : {}),
        },
      };
    }
    const parsed = managementCenterIntentSchema.safeParse(ready);
    if (!parsed.success) throw new AdminClientError("INVALID_COMMAND");
    phase("SUBMITTING");
    return api.submit(parsed.data);
  }
  return {
    submit(
      intent: SubmissionIntent,
      file: File | null,
      phase: (phase: SubmissionPhase) => void,
    ): Promise<ManagementCenterOperation> {
      if (active) return active;
      active = run(intent, file, phase).finally(() => {
        active = null;
      });
      return active;
    },
  };
}
