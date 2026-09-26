import {
  adminOrdersResponseSchema,
  adminOrdersPrivateResponseSchema,
  type AdminOrdersCommand,
  type AdminOrdersResponse,
  type AdminOrdersPrivateResponse,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";
export type OrdersContext = Extract<AdminOrdersResponse, { kind: "CONTEXT" }>;
export type OrdersList = Extract<AdminOrdersResponse, { kind: "LIST" }>;
export type OrdersDetail = Extract<AdminOrdersResponse, { kind: "DETAIL" }>;
export type OrdersMessage = Extract<
  AdminOrdersPrivateResponse,
  { kind: "MESSAGE" }
>;
export type OrdersNotes = Extract<
  AdminOrdersPrivateResponse,
  { kind: "NOTES" }
>;
export type ProofUploadGrant = Extract<
  AdminOrdersResponse,
  { kind: "PROOF_UPLOAD_GRANT" }
>;
export type ProofUpload = Extract<
  AdminOrdersResponse,
  { kind: "PROOF_UPLOAD" }
>;
export type ProofDownload = Extract<
  AdminOrdersResponse,
  { kind: "PROOF_DOWNLOAD" }
>;
export type OrderCommand<Action extends AdminOrdersCommand["action"]> = Omit<
  Extract<AdminOrdersCommand, { action: Action }>,
  "schemaVersion" | "action" | "idempotencyKey"
>;
export type OrdersFilters = OrderCommand<"LIST">;
const invalid = () => new AdminClientError("INVALID_RESPONSE");
export function createOrdersApi(client: AdminClient) {
  const call = (
    operation: string,
    command: Record<string, unknown> = {},
    mutation = false,
    key?: string,
  ) =>
    client.call(
      `orders-${operation}`,
      { schemaVersion: 1, ...command },
      adminOrdersResponseSchema,
      mutation,
      key,
    );
  const privateCall = (operation: string, command: Record<string, unknown>) =>
    client.call(
      `orders-${operation}`,
      { schemaVersion: 1, ...command },
      adminOrdersPrivateResponseSchema,
    );
  const mutate = async (
    operation: string,
    command: { orderId: string } & Record<string, unknown>,
    key?: string,
  ) => {
    const result = await call(operation, command, true, key);
    if (result.kind !== "MUTATION" || result.orderId !== command.orderId)
      throw invalid();
    return result;
  };
  return {
    async context(): Promise<OrdersContext> {
      const result = await call("context");
      if (result.kind !== "CONTEXT") throw invalid();
      return result;
    },
    async list(command: OrdersFilters): Promise<OrdersList> {
      const result = await call("list", command);
      if (
        result.kind !== "LIST" ||
        result.page !== command.page ||
        result.pageSize !== command.pageSize
      )
        throw invalid();
      return result;
    },
    async detail(orderId: string): Promise<OrdersDetail> {
      const result = await call("detail", { orderId });
      if (
        result.kind !== "DETAIL" ||
        result.orderId !== orderId ||
        result.items.length !== result.order.items.length ||
        result.items.some(
          (line, index) =>
            line.position !== result.order.items[index]?.position,
        )
      )
        throw invalid();
      return result;
    },
    async readMessage(
      command: OrderCommand<"READ_MESSAGE">,
    ): Promise<OrdersMessage> {
      const result = await privateCall("message-read", command);
      if (
        result.kind !== "MESSAGE" ||
        result.orderId !== command.orderId ||
        result.itemId !== command.itemId ||
        result.intentVersion !== command.expectedIntentVersion ||
        result.reviewLocale !== command.reviewLocale
      )
        throw invalid();
      return result;
    },
    reviewMessage: (command: OrderCommand<"REVIEW_MESSAGE">) =>
      mutate("message-review", command),
    prepare: (command: OrderCommand<"PREPARE">) => mutate("prepare", command),
    deliver: (command: OrderCommand<"DELIVER">) => mutate("deliver", command),
    hold: (command: OrderCommand<"HOLD">) => mutate("hold", command),
    resume: (command: OrderCommand<"RESUME">) => mutate("resume", command),
    addNote: (command: OrderCommand<"ADD_NOTE">, key: string) =>
      mutate("note-add", command, key),
    async readNotes(orderId: string): Promise<OrdersNotes> {
      const result = await privateCall("notes-read", { orderId });
      if (result.kind !== "NOTES" || result.orderId !== orderId)
        throw invalid();
      return result;
    },
    resend: (command: OrderCommand<"RESEND_NOTIFICATION">) =>
      mutate("notification-resend", command),
    /** Each photo's reservation is keyed by its own bytes, so a retry reuses its reservation. */
    async beginProofUpload(
      command: OrderCommand<"BEGIN_PROOF_UPLOAD">,
    ): Promise<ProofUploadGrant> {
      const result = await call("proof-begin", command, true);
      if (
        result.kind !== "PROOF_UPLOAD_GRANT" ||
        result.orderId !== command.orderId
      )
        throw invalid();
      return result;
    },
    async completeProofUpload(
      command: OrderCommand<"COMPLETE_PROOF_UPLOAD">,
    ): Promise<ProofUpload> {
      const result = await call("proof-complete", command);
      if (
        result.kind !== "PROOF_UPLOAD" ||
        result.orderId !== command.orderId ||
        result.uploadId !== command.uploadId
      )
        throw invalid();
      return result;
    },
    attachProofs: (command: OrderCommand<"ATTACH_PROOFS">) =>
      mutate("proofs-attach", command),
    withdrawProof: (command: OrderCommand<"WITHDRAW_PROOF">) =>
      mutate("proofs-withdraw", command),
    async viewProof(
      command: OrderCommand<"VIEW_PROOF">,
    ): Promise<ProofDownload> {
      const result = await call("proofs-view", command);
      if (
        result.kind !== "PROOF_DOWNLOAD" ||
        result.orderId !== command.orderId ||
        result.proofId !== command.proofId ||
        result.rendition !== command.rendition
      )
        throw invalid();
      return result;
    },
  };
}
export type OrdersApi = ReturnType<typeof createOrdersApi>;
