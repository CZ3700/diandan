import { z } from "zod";

import { schemaVersionSchema } from "./versioning.js";

export const portTimestampSchema = z.iso.datetime({ offset: true });
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function containsC0OrDelControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true;
    }
  }
  return false;
}

export function containsC0C1OrDelControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function isCanonicalUnpaddedBase64Url(value: string): boolean {
  const remainder = value.length % 4;
  if (remainder === 1) {
    return false;
  }
  if (remainder === 0) {
    return true;
  }
  const lastValue = BASE64URL_ALPHABET.indexOf(value.at(-1) ?? "");
  return remainder === 2
    ? (lastValue & 0b1111) === 0
    : (lastValue & 0b11) === 0;
}

export const portBase64Schema = z
  .string()
  .min(1)
  .max(65_536)
  .regex(/^[A-Za-z0-9_-]+$/u)
  .refine(isCanonicalUnpaddedBase64Url, {
    message: "value must be canonical unpadded base64url",
  });
export const portKeyVersionSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const portOpaqueReferenceSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/+=-]*$/u);

export const portErrorRecoverySchema = z.enum([
  "NONE",
  "RETRY_SAME_COMMAND",
  "RECONCILE_REQUIRED",
  "RESTART_AUTHORIZATION",
]);

export const portErrorBaseShape = {
  schemaVersion: schemaVersionSchema,
  recovery: portErrorRecoverySchema,
  retryAfterMs: z.number().int().min(100).max(86_400_000).optional(),
} as const;

export function validatePortErrorRecovery(
  error: Readonly<{ recovery: string; retryAfterMs?: number | undefined }>,
  context: z.core.$RefinementCtx,
): void {
  if (
    (error.recovery === "RETRY_SAME_COMMAND") !==
    (error.retryAfterMs !== undefined)
  ) {
    context.addIssue({
      code: "custom",
      path: ["retryAfterMs"],
      message: "retry delay is required only for retryable failures",
    });
  }
}

export function validatePortErrorPolicy(
  error: Readonly<{
    code: string;
    recovery: string;
    retryAfterMs?: number | undefined;
  }>,
  context: z.core.$RefinementCtx,
  policy: Readonly<{
    retryableCodes: readonly string[];
    reconcileCodes?: readonly string[] | undefined;
  }>,
): void {
  validatePortErrorRecovery(error, context);
  let expectedRecovery = "NONE";
  if (policy.reconcileCodes?.includes(error.code)) {
    expectedRecovery = "RECONCILE_REQUIRED";
  } else if (policy.retryableCodes.includes(error.code)) {
    expectedRecovery = "RETRY_SAME_COMMAND";
  }
  if (error.recovery !== expectedRecovery) {
    context.addIssue({
      code: "custom",
      path: ["recovery"],
      message:
        "recovery classification does not match the normalized error code",
    });
  }
}

export type PortErrorRecovery = z.infer<typeof portErrorRecoverySchema>;
