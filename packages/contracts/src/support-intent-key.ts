import { z } from "zod";
import { encryptedValueSchema, keyVersionSchema } from "./commerce.js";
import { keyManagementPortErrorSchema } from "./key-management-port-contracts.js";

// Separate roots retain the frozen key-management v1 command and response unions.
export const generateSupportIntentKeyCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.literal("GENERATE_SUPPORT_INTENT_KEY"),
  subjectId: z.uuid(),
});
export const generateSupportIntentKeyResponseSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({
      schemaVersion: z.literal(1),
      operation: z.literal("GENERATE_SUPPORT_INTENT_KEY"),
      outcome: z.literal("SUCCESS"),
      value: z.strictObject({
        encryptedDataKey: encryptedValueSchema,
        keyVersion: keyVersionSchema,
        algorithm: z.literal("AES_256_GCM"),
      }),
    }),
    z.strictObject({
      schemaVersion: z.literal(1),
      operation: z.literal("GENERATE_SUPPORT_INTENT_KEY"),
      outcome: z.literal("FAILURE"),
      error: keyManagementPortErrorSchema,
    }),
  ],
);
export type GenerateSupportIntentKeyCommand = z.infer<
  typeof generateSupportIntentKeyCommandSchema
>;
export type GenerateSupportIntentKeyResponse = z.infer<
  typeof generateSupportIntentKeyResponseSchema
>;
