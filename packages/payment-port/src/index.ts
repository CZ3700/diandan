import type {
  CancelPaymentCommand,
  CancelPaymentResponse,
  CreatePaymentCommand,
  CreatePaymentResponse,
  GetPaymentCapabilitiesCommand,
  GetPaymentCapabilitiesResponse,
  GetPaymentCommand,
  GetPaymentResponse,
  PaymentWebhookVerificationCommand,
  PaymentWebhookVerificationResponse,
  ReconcilePaymentCommand,
  ReconcilePaymentResponse,
  ReconcileRefundCommand,
  ReconcileRefundResponse,
  RefundPaymentCommand,
  RefundPaymentResponse,
  VerifyAndParseWebhookCommand,
  VerifyAndParseWebhookResponse,
} from "@fan-support/contracts";

export {
  paymentPortCommandSchema,
  paymentPortErrorCodeSchema,
  paymentPortErrorSchema,
  paymentPortOperationSchema,
  paymentPortResponseSchema,
  paymentPortResponseMatchesCommand,
  paymentWebhookVerificationCommandSchema,
  paymentWebhookVerificationErrorCodeSchema,
  paymentWebhookVerificationErrorSchema,
  paymentWebhookVerificationResponseMatchesCommand,
  paymentWebhookVerificationResponseSchema,
  verifiedWebhookEventCandidateSchema,
} from "@fan-support/contracts";
export type {
  CancelPaymentCommand,
  CancelPaymentResponse,
  CreatePaymentCommand,
  CreatePaymentResponse,
  GetPaymentCapabilitiesCommand,
  GetPaymentCapabilitiesResponse,
  GetPaymentCommand,
  GetPaymentResponse,
  PaymentPortCommand,
  PaymentPortError,
  PaymentPortFailure,
  PaymentPortResponse,
  PaymentWebhookVerificationCommand,
  PaymentWebhookVerificationError,
  PaymentWebhookVerificationResponse,
  ReconcilePaymentCommand,
  ReconcilePaymentResponse,
  ReconcileRefundCommand,
  ReconcileRefundResponse,
  RefundPaymentCommand,
  RefundPaymentResponse,
  VerifyAndParseWebhookCommand,
  VerifyAndParseWebhookResponse,
  VerifiedWebhookEventCandidate,
} from "@fan-support/contracts";

export const PAYMENT_PROVIDER_OPERATIONS = [
  "GET_CAPABILITIES",
  "CREATE_PAYMENT",
  "GET_PAYMENT",
  "CANCEL_PAYMENT",
  "REFUND_PAYMENT",
  "RECONCILE_PAYMENT",
  "RECONCILE_REFUND",
] as const;

/** Frozen v1 decode-only operation; production ingress must not use it. */
export const LEGACY_WEBHOOK_PARSER_OPERATIONS = [
  "VERIFY_AND_PARSE_WEBHOOK",
] as const;

export const PAYMENT_WEBHOOK_VERIFIER_OPERATIONS = [
  "VERIFY_PAYMENT_WEBHOOK",
] as const;

export interface PaymentProvider {
  getCapabilities(
    command: GetPaymentCapabilitiesCommand,
  ): Promise<GetPaymentCapabilitiesResponse>;
  createPayment(command: CreatePaymentCommand): Promise<CreatePaymentResponse>;
  getPayment(command: GetPaymentCommand): Promise<GetPaymentResponse>;
  cancelPayment(command: CancelPaymentCommand): Promise<CancelPaymentResponse>;
  refundPayment(command: RefundPaymentCommand): Promise<RefundPaymentResponse>;
  reconcilePayment(
    command: ReconcilePaymentCommand,
  ): Promise<ReconcilePaymentResponse>;
  reconcileRefund(
    command: ReconcileRefundCommand,
  ): Promise<ReconcileRefundResponse>;
}

/**
 * Legacy v1 compatibility surface for TEST-only adapters and fixture decoding.
 * Production webhook ingress uses PaymentWebhookVerifier exclusively.
 */
export interface LegacyWebhookParser {
  verifyAndParseWebhook(
    command: VerifyAndParseWebhookCommand,
  ): Promise<VerifyAndParseWebhookResponse>;
}

/** Endpoint-scoped raw webhook verification, separate from persistence. */
export interface PaymentWebhookVerifier {
  verifyPaymentWebhook(
    command: PaymentWebhookVerificationCommand,
  ): Promise<PaymentWebhookVerificationResponse>;
}

export const workspacePackageName = "@fan-support/payment-port" as const;
