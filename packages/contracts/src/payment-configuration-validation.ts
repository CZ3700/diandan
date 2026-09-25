import { z } from "zod";
import {
  paymentConfigurationDocumentSchema,
  paymentConfigurationChannelSchema,
  paymentConfigurationHealthSettingsSchema,
  paymentConfigurationAccountSchema,
  paymentConfigurationReviewSchema,
  paymentConfigurationIssueSchema,
  paymentConfigurationDiffSchema,
} from "./admin-payment-configuration.js";
export const paymentConfigurationBaselineSchema =
  paymentConfigurationDocumentSchema.extend({
    channels: z
      .array(
        paymentConfigurationChannelSchema.extend({
          healthPolicy: paymentConfigurationHealthSettingsSchema.nullable(),
        }),
      )
      .max(100),
  });
export const paymentConfigurationValidationInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  configuration: paymentConfigurationDocumentSchema,
  accounts: z.array(paymentConfigurationAccountSchema).max(100),
  reviews: z.array(paymentConfigurationReviewSchema).max(700),
  mode: z.enum(["PUBLISH", "ROLLBACK"]),
  previouslyPublished: z.boolean(),
});
export const paymentConfigurationValidationResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  valid: z.boolean(),
  issues: z.array(paymentConfigurationIssueSchema).max(2000),
});
export const paymentConfigurationDiffInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  before: paymentConfigurationBaselineSchema.nullable(),
  after: paymentConfigurationDocumentSchema,
});
export const paymentConfigurationDiffResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  diff: z.array(paymentConfigurationDiffSchema).max(600),
});
export type PaymentConfigurationValidationInput = z.infer<
  typeof paymentConfigurationValidationInputSchema
>;
export type PaymentConfigurationValidationResult = z.infer<
  typeof paymentConfigurationValidationResultSchema
>;
export type PaymentConfigurationDiffInput = z.infer<
  typeof paymentConfigurationDiffInputSchema
>;
export type PaymentConfigurationDiffResult = z.infer<
  typeof paymentConfigurationDiffResultSchema
>;
export type PaymentConfigurationBaseline = z.infer<
  typeof paymentConfigurationBaselineSchema
>;
