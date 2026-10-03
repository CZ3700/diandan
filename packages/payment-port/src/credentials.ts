import { z } from "zod";
import {
  paymentAccountConnectionSchema,
  providerAccountIdSchema,
} from "@fan-support/contracts";

export type PaymentCredentialRequest = Readonly<{
  schemaVersion: 1;
  secretRef: string;
  providerAccountId: string;
  environment: "TEST" | "LIVE";
  purpose: "API_AUTH" | "WEBHOOK_VERIFY";
}>;

/** Server-side secret store. Adapters resolve on every use, so a store rotation needs no code change. */
export interface PaymentCredentialResolver {
  resolve(request: PaymentCredentialRequest): Promise<unknown>;
}

const requestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  secretRef: paymentAccountConnectionSchema.shape.credentialRef,
  providerAccountId: providerAccountIdSchema,
  environment: z.enum(["TEST", "LIVE"]),
  purpose: z.enum(["API_AUTH", "WEBHOOK_VERIFY"]),
});
const receiptSchema = requestSchema.extend({
  version: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._:/@-]+$/u),
  values: z
    .array(z.string().min(1).max(4096))
    .min(1)
    .max(3)
    .refine((values) => new Set(values).size === values.length),
});

/**
 * Binds a receipt to its exact request and an adapter-specific value format.
 * Every failure collapses to one message so neither values nor causes leak.
 */
export async function resolvePaymentCredentials(
  resolver: PaymentCredentialResolver,
  request: PaymentCredentialRequest,
  acceptsValues: (
    purpose: PaymentCredentialRequest["purpose"],
    values: readonly string[],
  ) => boolean,
  timeoutMs = 10000,
): Promise<readonly string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const input = requestSchema.parse(request);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw new Error();
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error()), timeoutMs);
    });
    const receipt = receiptSchema.parse(
      await Promise.race([resolver.resolve(input), deadline]),
    );
    if (
      Object.keys(input).some(
        (key) =>
          receipt[key as keyof typeof input] !==
          input[key as keyof typeof input],
      ) ||
      !acceptsValues(input.purpose, receipt.values)
    )
      throw new Error();
    return receipt.values;
  } catch {
    throw new Error("Payment credentials unavailable");
  } finally {
    clearTimeout(timer);
  }
}
