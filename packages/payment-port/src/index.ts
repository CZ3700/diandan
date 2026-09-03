import type {
  CancelPaymentCommand,
  CancelPaymentResponse,
  CreatePaymentCommand,
  CreatePaymentResponse,
  GetPaymentCapabilitiesCommand,
  GetPaymentCapabilitiesResponse,
  GetPaymentCommand,
  GetPaymentResponse,
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
  ReconcilePaymentCommand,
  ReconcilePaymentResponse,
  ReconcileRefundCommand,
  ReconcileRefundResponse,
  RefundPaymentCommand,
  RefundPaymentResponse,
  VerifyAndParseWebhookCommand,
  VerifyAndParseWebhookResponse,
} from "@fan-support/contracts";

export const PAYMENT_PROVIDER_OPERATIONS = [
  "GET_CAPABILITIES",
  "CREATE_PAYMENT",
  "VERIFY_AND_PARSE_WEBHOOK",
  "GET_PAYMENT",
  "CANCEL_PAYMENT",
  "REFUND_PAYMENT",
  "RECONCILE_PAYMENT",
  "RECONCILE_REFUND",
] as const;

export interface PaymentProvider {
  getCapabilities(
    command: GetPaymentCapabilitiesCommand,
  ): Promise<GetPaymentCapabilitiesResponse>;
  createPayment(command: CreatePaymentCommand): Promise<CreatePaymentResponse>;
  verifyAndParseWebhook(
    command: VerifyAndParseWebhookCommand,
  ): Promise<VerifyAndParseWebhookResponse>;
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

export const workspacePackageName = "@fan-support/payment-port" as const;
