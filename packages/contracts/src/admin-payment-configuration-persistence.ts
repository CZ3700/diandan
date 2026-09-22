import { z } from "zod";
import { adminOrdersAccessSchema } from "./admin-orders-persistence.js";
import {
  adminPaymentConfigurationCommandSchema,
  paymentConfigurationAccountSchema,
} from "./admin-payment-configuration.js";
import { sourceHashSchema } from "./content-lifecycle.js";
import { paymentHealthPolicySchema } from "./payment-health.js";
export const paymentConfigurationDeployedAccountSchema =
  paymentConfigurationAccountSchema.pick({
    providerAccountId: true,
    environment: true,
    adapterKey: true,
    adapterVersion: true,
    paymentMethods: true,
  });
export const paymentConfigurationDeployedAccountsSchema = z
  .array(paymentConfigurationDeployedAccountSchema)
  .max(100)
  .refine(
    (v) =>
      new Set(v.map((x) => x.providerAccountId.toLowerCase())).size ===
      v.length,
  );
export const adminPaymentConfigurationStoreRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    access: adminOrdersAccessSchema,
    command: adminPaymentConfigurationCommandSchema,
    requestHash: sourceHashSchema.nullable(),
    deployedAccounts: paymentConfigurationDeployedAccountsSchema,
  })
  .refine((v) => !("idempotencyKey" in v.command) || v.requestHash !== null);
/** A trusted PostgreSQL projection. Accounts retain all historically published bindings for recovery. */
export const paymentConfigurationPublishedProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generation: z.number().int().min(1).max(2147483647),
  publicationId: z.uuid(),
  revisionId: z.uuid(),
  accounts: z
    .array(
      paymentConfigurationDeployedAccountSchema.pick({
        providerAccountId: true,
        environment: true,
        adapterKey: true,
      }),
    )
    .max(100)
    .refine(
      (v) =>
        new Set(v.map((x) => x.providerAccountId.toLowerCase())).size ===
        v.length,
    ),
  policies: z
    .array(paymentHealthPolicySchema)
    .max(100)
    .refine(
      (v) =>
        new Set(v.map((x) => x.providerAccountId.toLowerCase())).size ===
        v.length,
    ),
});
export type PaymentConfigurationDeployedAccount = z.infer<
  typeof paymentConfigurationDeployedAccountSchema
>;
export type AdminPaymentConfigurationStoreRequest = z.infer<
  typeof adminPaymentConfigurationStoreRequestSchema
>;
export type PaymentConfigurationPublishedProjection = z.infer<
  typeof paymentConfigurationPublishedProjectionSchema
>;
