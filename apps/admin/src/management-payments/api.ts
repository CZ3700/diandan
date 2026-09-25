import {
  adminPaymentConfigurationResponseSchema,
  type AdminPaymentConfigurationCommand,
  type AdminPaymentConfigurationResponse,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";

export type PaymentWorkspace = Extract<
  AdminPaymentConfigurationResponse,
  { kind: "WORKSPACE" }
>;
export type PaymentValidation = Extract<
  AdminPaymentConfigurationResponse,
  { kind: "VALIDATION" }
>;
type Mutation = Exclude<
  AdminPaymentConfigurationCommand,
  { action: "READ" | "VALIDATE" }
>;
export type PaymentMutation = Mutation extends infer T
  ? T extends Mutation
    ? Omit<T, "schemaVersion" | "idempotencyKey">
    : never
  : never;
export type ValidateCommand = Omit<
  Extract<AdminPaymentConfigurationCommand, { action: "VALIDATE" }>,
  "schemaVersion" | "action"
>;
const invalid = () => new AdminClientError("INVALID_RESPONSE");
export function createPaymentConfigurationApi(client: AdminClient) {
  const call = (action: string, body: Record<string, unknown>, key?: string) =>
    client.call(
      `payment-config-${action.toLowerCase()}`,
      { schemaVersion: 1, ...body },
      adminPaymentConfigurationResponseSchema,
      key !== undefined,
      key,
    );
  return {
    async read(revisionId: string | null = null): Promise<PaymentWorkspace> {
      const value = await call("READ", { revisionId });
      if (
        value.kind !== "WORKSPACE" ||
        (revisionId !== null && value.selected?.revisionId !== revisionId)
      )
        throw invalid();
      return value;
    },
    async validate(command: ValidateCommand): Promise<PaymentValidation> {
      const value = await call("VALIDATE", command);
      if (
        value.kind !== "VALIDATION" ||
        value.revisionId !== command.revisionId ||
        value.expectedPublicationId !== command.expectedPublicationId ||
        value.mode !== command.mode
      )
        throw invalid();
      return value;
    },
    async mutate(command: PaymentMutation, key: string) {
      const { action, ...body } = command;
      const value = await call(action, body, key);
      if (
        value.kind !== "MUTATION" ||
        value.action !== action ||
        (action !== "SAVE" && value.revisionId !== command.revisionId) ||
        (action === "PUBLISH" || action === "ROLLBACK"
          ? value.publicationId === null || value.generation <= 0
          : value.publicationId !== null)
      )
        throw invalid();
      return value;
    },
  };
}
export type PaymentConfigurationApi = ReturnType<
  typeof createPaymentConfigurationApi
>;
