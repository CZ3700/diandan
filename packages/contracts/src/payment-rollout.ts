import { z } from "zod";
import {
  checkoutSessionIdSchema,
  providerAccountIdSchema,
} from "./identifiers.js";

const basisPoints = z.number().int().min(0).max(10000);
const bucket = z.number().int().min(0).max(9999);

/** Internal only: identities come from the authorized checkout and published PG configuration. */
export const paymentRolloutInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  checkoutSessionId: checkoutSessionIdSchema,
  providerAccountId: providerAccountIdSchema,
  routeRuleId: z.uuid(),
  providerRolloutBasisPoints: basisPoints,
  ruleRolloutBasisPoints: basisPoints,
});
export const paymentRolloutDecisionSchema = z.union([
  z.strictObject({
    schemaVersion: z.literal(1),
    algorithmVersion: z.literal(1),
    kind: z.enum(["ELIGIBLE", "EXCLUDED"]),
    providerBucket: bucket,
    ruleBucket: bucket,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("INVALID"),
    reason: z.literal("INVALID_ROLLOUT_INPUT"),
  }),
]);
export type PaymentRolloutInput = z.infer<typeof paymentRolloutInputSchema>;
export type PaymentRolloutDecision = z.infer<
  typeof paymentRolloutDecisionSchema
>;
