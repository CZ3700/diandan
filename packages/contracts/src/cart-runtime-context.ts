import { z } from "zod";
import { cartRuntimeAccessesSchema } from "./cart-runtime.js";
import { canonicalRequestIdSchema } from "./envelopes.js";
import { idempotencyKeySchema } from "./identifiers.js";

/** Transport-authenticated context; never accepted in a browser command body. */
export const cartRuntimeRequestContextSchema = z.strictObject({
  schemaVersion: z.literal(1),
  accesses: cartRuntimeAccessesSchema,
  requestId: canonicalRequestIdSchema,
  correlationId: canonicalRequestIdSchema,
  idempotencyKey: idempotencyKeySchema.optional(),
});
export type CartRuntimeRequestContext = z.infer<
  typeof cartRuntimeRequestContextSchema
>;
