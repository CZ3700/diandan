import type {
  ComputeBlindIndexCommand,
  ComputeBlindIndexResponse,
  DecryptEnvelopeCommand,
  DecryptEnvelopeResponse,
  EncryptEnvelopeCommand,
  EncryptEnvelopeFieldsCommand,
  EncryptEnvelopeFieldsResponse,
  EncryptEnvelopeResponse,
  GenerateSupportIntentKeyCommand,
  GenerateSupportIntentKeyResponse,
} from "@fan-support/contracts";

export {
  generateSupportIntentKeyCommandSchema,
  generateSupportIntentKeyResponseSchema,
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
  GenerateSupportIntentKeyCommand,
  GenerateSupportIntentKeyResponse,
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

/** Empty private intents still retain a real wrapped key under the existing storage contract. */
export interface SupportIntentKeyPort {
  generateSupportIntentKey(
    command: GenerateSupportIntentKeyCommand,
  ): Promise<GenerateSupportIntentKeyResponse>;
}

export const workspacePackageName = "@fan-support/key-management-port" as const;
