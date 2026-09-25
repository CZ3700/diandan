export type GatewayCredentialRequest = Readonly<{
  schemaVersion: 1;
  secretRef: string;
  providerAccountId: string;
  environment: "TEST" | "LIVE";
  purpose: "API_AUTH" | "WEBHOOK_VERIFY";
}>;
export interface GatewayCredentialResolver {
  resolve(request: GatewayCredentialRequest): Promise<unknown>;
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
function validWebhookKey(value: string) {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/u.test(value)) return false;
  const raw = value.slice(6),
    bytes = Buffer.from(raw, "base64");
  return (
    bytes.length >= 24 && bytes.length <= 64 && bytes.toString("base64") === raw
  );
}
export async function resolveGatewayCredentials(
  resolver: GatewayCredentialResolver,
  request: GatewayCredentialRequest,
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
      )
    )
      throw new Error();
    const valid =
      input.purpose === "API_AUTH"
        ? receipt.values.length === 1 &&
          /^[A-Za-z0-9._~+/-]+=*$/u.test(receipt.values[0] ?? "")
        : receipt.values.every(validWebhookKey);
    if (!valid) throw new Error();
    return receipt.values;
  } catch {
    throw new Error("Gateway credentials unavailable");
  } finally {
    clearTimeout(timer);
  }
}
import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  paymentAccountConnectionSchema,
  providerAccountIdSchema,
} from "@fan-support/contracts";
