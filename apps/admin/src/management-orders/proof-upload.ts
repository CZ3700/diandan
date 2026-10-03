import { sourceHashSchema } from "@fan-support/contracts";
import { AdminClientError } from "../workspace/client";
import type { OrderCommand, OrdersApi } from "./api";

export type ProofTarget = Pick<
  OrderCommand<"ATTACH_PROOFS">,
  | "orderId"
  | "expectedOrderVersion"
  | "fulfillmentId"
  | "expectedFulfillmentVersion"
>;
type Grant = Awaited<ReturnType<OrdersApi["beginProofUpload"]>>["grant"];
type Checkpoint = {
  uploadId: string;
  grant: Grant;
  putComplete: boolean;
  ready: boolean;
};
const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * One delivery attempt: photos upload to private storage, attach once, then the caller may deliver.
 * In-memory checkpoints let a retry skip finished steps; nothing survives a reload.
 */
export function createDeliveryProofAttempt(transport: typeof fetch = fetch) {
  const uploads = new Map<string, Checkpoint>();
  let attached: string | null = null;
  async function upload(
    api: OrdersApi,
    target: ProofTarget,
    file: File,
  ): Promise<string> {
    const bytes = await file.arrayBuffer();
    const checksumSha256 = sourceHashSchema.parse(
      hex(await crypto.subtle.digest("SHA-256", bytes)),
    );
    const fingerprint = `${target.fulfillmentId}:${checksumSha256}:${bytes.byteLength}:${file.type}`;
    let current = uploads.get(fingerprint);
    if (
      !current ||
      (!current.putComplete &&
        Date.parse(current.grant.expiresAt) <= Date.now())
    ) {
      const begun = await api.beginProofUpload({
        ...target,
        reasonCode: "DELIVERY_PROOF_UPLOAD",
        checksumSha256,
        byteSize: bytes.byteLength,
        mimeType: file.type as OrderCommand<"BEGIN_PROOF_UPLOAD">["mimeType"],
      });
      current = {
        uploadId: begun.uploadId,
        grant: begun.grant,
        putComplete: false,
        ready: false,
      };
      uploads.set(fingerprint, current);
    }
    if (!current.putComplete) {
      let response: Response;
      try {
        response = await transport(current.grant.url, {
          method: current.grant.method,
          headers: current.grant.headers,
          body: bytes,
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(30000),
        });
      } catch {
        throw new AdminClientError("NETWORK_ERROR");
      }
      // A conditional PUT may have succeeded before its response was lost; completion re-verifies the bytes.
      if (!response.ok && response.status !== 412)
        throw new AdminClientError("UPLOAD_FAILED");
      current.putComplete = true;
    }
    if (!current.ready) {
      await api.completeProofUpload({
        orderId: target.orderId,
        uploadId: current.uploadId,
      });
      current.ready = true;
    }
    return current.uploadId;
  }
  return {
    upload,
    async attach(api: OrdersApi, target: ProofTarget, uploadIds: string[]) {
      const key = uploadIds.join(",");
      if (attached === key) return;
      await api.attachProofs({
        ...target,
        reasonCode: "DELIVERY_PROOF_CONFIRMED",
        uploadIds,
        privacyConfirmed: true,
      });
      attached = key;
    },
  };
}
export type DeliveryProofAttempt = ReturnType<
  typeof createDeliveryProofAttempt
>;
