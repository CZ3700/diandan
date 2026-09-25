import { z } from "zod";

import { currencySchema, minorAmountSchema } from "./commerce.js";
import {
  paymentAttemptIdSchema,
  providerAccountIdSchema,
  providerEventReferenceSchema,
  providerReferenceSchema,
} from "./identifiers.js";
import { paymentEnvironmentSchema, providerEvidenceSchema } from "./payment.js";
import { portOpaqueReferenceSchema } from "./port-common.js";
import { schemaVersionSchema } from "./versioning.js";

// Encoding bounds, not a chain's supply or monetary limits. No chain is enabled
// by these schemas; the adapter must use the deployed account's exact config.
export const paymentStablecoinDecimalsSchema = z.number().int().min(0).max(255);
export const paymentStablecoinAtomicAmountSchema = z
  .string()
  .max(256)
  .regex(/^(?:0|[1-9][0-9]*)$/u);
export const paymentStablecoinTimestampSchema = z.iso
  .datetime()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.[0-9]{1,6})?Z$/u);

function comparableTime(value: string): string {
  const [seconds, fraction = ""] = value.slice(0, -1).split(".");
  return `${seconds}.${fraction.padEnd(6, "0")}Z`;
}

export const paymentStablecoinConfigSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  asset: z.literal("USDT"),
  network: portOpaqueReferenceSchema,
  // Exact network-specific contract, mint, asset ID, or compound token reference.
  // Adapters canonicalize it before persistence; comparisons never fold its case.
  tokenReference: portOpaqueReferenceSchema,
  decimals: paymentStablecoinDecimalsSchema,
  minimumConfirmations: z.number().int().min(1).max(2_147_483_647),
});
const quoteIdentityShape = {
  providerAccountId: providerAccountIdSchema,
  environment: paymentEnvironmentSchema,
  attemptId: paymentAttemptIdSchema,
  quoteId: providerReferenceSchema,
} as const;

/** The provider supplies this quote; no implied fiat/USDT parity or FX exists. */
export const paymentStablecoinQuoteSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    ...quoteIdentityShape,
    amountMinor: minorAmountSchema,
    currency: currencySchema,
    asset: paymentStablecoinConfigSchema,
    atomicAmount: paymentStablecoinAtomicAmountSchema.refine(
      (value) => value !== "0",
    ),
    issuedAt: paymentStablecoinTimestampSchema,
    expiresAt: paymentStablecoinTimestampSchema,
  })
  .refine(
    (value) => comparableTime(value.expiresAt) > comparableTime(value.issuedAt),
    {
      path: ["expiresAt"],
      message: "quote expiry must follow issuance",
    },
  );

/**
 * Parsing is not authentication. Only a trusted adapter may produce this after
 * verifying/persisting the referenced webhook inbox or authenticated audit.
 * paidAtomicAmount is the deduplicated sum attributable to this exact quote;
 * confirmations is the minimum across its included deposits. lastPaymentAt is
 * the last included deposit time, not the later confirmation/observation time.
 */
export const paymentStablecoinObservationSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    ...quoteIdentityShape,
    asset: portOpaqueReferenceSchema,
    network: portOpaqueReferenceSchema,
    tokenReference: portOpaqueReferenceSchema,
    decimals: paymentStablecoinDecimalsSchema,
    paidAtomicAmount: paymentStablecoinAtomicAmountSchema,
    firstPaymentAt: paymentStablecoinTimestampSchema.nullable(),
    lastPaymentAt: paymentStablecoinTimestampSchema.nullable(),
    observedAt: paymentStablecoinTimestampSchema,
    confirmations: z.number().int().min(0).max(2_147_483_647),
    reorganized: z.boolean(),
    providerEventId: providerEventReferenceSchema,
    evidence: providerEvidenceSchema,
  })
  .superRefine((value, context) => {
    const unpaid = value.paidAtomicAmount === "0";
    const validTimes = unpaid
      ? value.firstPaymentAt === null &&
        value.lastPaymentAt === null &&
        value.confirmations === 0
      : value.firstPaymentAt !== null &&
        value.lastPaymentAt !== null &&
        comparableTime(value.firstPaymentAt) <=
          comparableTime(value.lastPaymentAt) &&
        comparableTime(value.lastPaymentAt) <= comparableTime(value.observedAt);
    if (!validTimes) {
      context.addIssue({
        code: "custom",
        path: ["firstPaymentAt"],
        message:
          "deposit times and confirmations must match the observed amount",
      });
    }
  });

export const paymentStablecoinEvaluationCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  quote: paymentStablecoinQuoteSchema,
  observation: paymentStablecoinObservationSchema,
  evaluatedAt: paymentStablecoinTimestampSchema,
});
export const paymentStablecoinEvaluationSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      outcome: z.literal("MATCHED_EVIDENCE"),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      outcome: z.literal("PENDING"),
      reason: z.enum(["AWAITING_PAYMENT", "INSUFFICIENT_CONFIRMATIONS"]),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      outcome: z.literal("REVIEW"),
      reason: z.enum([
        "IDENTITY_MISMATCH",
        "ASSET_MISMATCH",
        "NETWORK_MISMATCH",
        "TOKEN_MISMATCH",
        "DECIMALS_MISMATCH",
        "QUOTE_NOT_YET_VALID",
        "QUOTE_EXPIRED",
        "OBSERVATION_FROM_FUTURE",
        "PAYMENT_BEFORE_QUOTE",
        "LATE_PAYMENT",
        "UNDERPAID",
        "OVERPAID",
        "CHAIN_REORGANIZED",
      ]),
    }),
  ],
);

export const paymentStablecoinDecimalToAtomicCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    decimalAmount: z
      .string()
      .max(513)
      .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u),
    decimals: paymentStablecoinDecimalsSchema,
  })
  .refine(
    (value) =>
      (value.decimalAmount.split(".")[1]?.length ?? 0) <= value.decimals,
    {
      path: ["decimalAmount"],
      message: "decimal amount exceeds the configured precision",
    },
  );
export const paymentStablecoinAtomicToDecimalCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  atomicAmount: paymentStablecoinAtomicAmountSchema,
  decimals: paymentStablecoinDecimalsSchema,
});

export type PaymentStablecoinConfig = z.infer<
  typeof paymentStablecoinConfigSchema
>;
export type PaymentStablecoinQuote = z.infer<
  typeof paymentStablecoinQuoteSchema
>;
export type PaymentStablecoinObservation = z.infer<
  typeof paymentStablecoinObservationSchema
>;
export type PaymentStablecoinEvaluationCommand = z.infer<
  typeof paymentStablecoinEvaluationCommandSchema
>;
export type PaymentStablecoinEvaluation = z.infer<
  typeof paymentStablecoinEvaluationSchema
>;
export type PaymentStablecoinDecimalToAtomicCommand = z.infer<
  typeof paymentStablecoinDecimalToAtomicCommandSchema
>;
export type PaymentStablecoinAtomicToDecimalCommand = z.infer<
  typeof paymentStablecoinAtomicToDecimalCommandSchema
>;
