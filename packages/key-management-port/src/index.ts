import type {
  ComputeBlindIndexCommand,
  ComputeBlindIndexResponse,
  DecryptEnvelopeCommand,
  DecryptEnvelopeResponse,
  EncryptEnvelopeCommand,
  EncryptEnvelopeFieldsCommand,
  EncryptEnvelopeFieldsResponse,
  EncryptEnvelopeResponse,
} from "@fan-support/contracts";

export {
  MAX_BLIND_INDEX_VALUE_BYTES,
  MAX_ENVELOPE_PLAINTEXT_BYTES,
  blindIndexPurposeSchema,
  envelopeEncryptionPurposeSchema,
  keyManagementPortCommandSchema,
  keyManagementPortErrorCodeSchema,
  keyManagementPortErrorSchema,
  keyManagementPortOperationSchema,
  keyManagementPortResponseSchema,
} from "@fan-support/contracts";
export type {
  ComputeBlindIndexCommand,
  ComputeBlindIndexResponse,
  DecryptEnvelopeCommand,
  DecryptEnvelopeResponse,
  EncryptEnvelopeCommand,
  EncryptEnvelopeFieldsCommand,
  EncryptEnvelopeFieldsResponse,
  EncryptEnvelopeResponse,
  KeyManagementPortCommand,
  KeyManagementPortError,
  KeyManagementPortFailure,
  KeyManagementPortResponse,
} from "@fan-support/contracts";

export interface KeyManagementPort {
  encryptEnvelope(
    command: EncryptEnvelopeCommand,
  ): Promise<EncryptEnvelopeResponse>;
  encryptEnvelopeFields(
    command: EncryptEnvelopeFieldsCommand,
  ): Promise<EncryptEnvelopeFieldsResponse>;
  decryptEnvelope(
    command: DecryptEnvelopeCommand,
  ): Promise<DecryptEnvelopeResponse>;
  computeBlindIndex(
    command: ComputeBlindIndexCommand,
  ): Promise<ComputeBlindIndexResponse>;
}

export const workspacePackageName = "@fan-support/key-management-port" as const;
