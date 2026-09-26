import type { z } from "zod";
import {
  paymentAccountConnectionSchema,
  paymentGatewayWebhookConfigSchema,
  paymentHealthPolicySchema,
  paymentRuntimeConfigurationSchema,
  type PaymentAccountConnection,
  type PaymentGatewayWebhookConfig,
  type PaymentHealthPolicy,
  type PaymentRuntimeConfiguration,
} from "@fan-support/contracts";

export type PaymentDeploymentConfig = Readonly<{
  /** Absent keeps checkout payment routes explicitly unavailable. */
  runtime: PaymentRuntimeConfiguration | undefined;
  /** Immutable deployed accounts; PostgreSQL publication decides which of them may take payments. */
  connections: readonly PaymentAccountConnection[];
  healthPolicies: readonly PaymentHealthPolicy[];
  /** Endpoint-scoped verification settings; every endpoint belongs to one deployed account. */
  webhookEndpoints: readonly PaymentGatewayWebhookConfig[];
}>;

const MAX_JSON_LENGTH = 262_144;
const identity = (value: { environment: string; providerAccountId: string }) =>
  `${value.environment}/${value.providerAccountId.toLowerCase()}`;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function parseJson(text: string): unknown {
  if (text.length > MAX_JSON_LENGTH)
    throw new Error("Payment configuration is too large");
  return JSON.parse(text) as unknown;
}

function parseList<Schema extends z.ZodType>(
  text: string | undefined,
  schema: Schema,
): z.infer<Schema>[] {
  if (text === undefined) return [];
  const raw = parseJson(text);
  if (!Array.isArray(raw) || raw.length > 100)
    throw new Error("Payment configuration must be a bounded list");
  return raw.map((entry: unknown) => schema.parse(entry));
}

/** Deployment metadata only: no credentials, adapter code or activation decisions live here. */
export function resolvePaymentDeploymentConfig(
  environment: Readonly<Record<string, string | undefined>>,
  siteOrigin: string,
): PaymentDeploymentConfig {
  let runtime: PaymentRuntimeConfiguration | undefined;
  let connections: PaymentAccountConnection[];
  let healthPolicies: PaymentHealthPolicy[];
  let webhookEndpoints: PaymentGatewayWebhookConfig[];
  try {
    const runtimeText = environment["FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON"];
    runtime =
      runtimeText === undefined
        ? undefined
        : paymentRuntimeConfigurationSchema.parse(parseJson(runtimeText));
    connections = parseList(
      environment["FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON"],
      paymentAccountConnectionSchema,
    );
    healthPolicies = parseList(
      environment["FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON"],
      paymentHealthPolicySchema,
    );
    const accounts = new Set(
      connections.map((value) => identity(value.binding)),
    );
    const policies = new Set(healthPolicies.map(identity));
    if (
      accounts.size !== connections.length ||
      policies.size !== healthPolicies.length ||
      accounts.size !== policies.size ||
      [...accounts].some((account) => !policies.has(account))
    )
      throw new Error("Every deployed account needs exactly one health policy");
    webhookEndpoints = parseList(
      environment["FAN_SUPPORT_PAYMENT_WEBHOOK_ENDPOINTS_JSON"],
      paymentGatewayWebhookConfigSchema,
    );
    const bindings = new Map(
      connections.map((value) => [
        identity(value.binding),
        canonical(value.binding),
      ]),
    );
    if (
      new Set(webhookEndpoints.map((value) => value.endpointId)).size !==
        webhookEndpoints.length ||
      webhookEndpoints.some(
        (value) =>
          bindings.get(identity(value.binding)) !== canonical(value.binding),
      )
    )
      throw new Error("Webhook endpoints must belong to deployed accounts");
  } catch {
    throw new TypeError("Invalid payment runtime configuration");
  }
  if (
    (runtime !== undefined && runtime.publicStorefrontOrigin !== siteOrigin) ||
    connections.some((connection) => connection.returnOrigin !== siteOrigin)
  )
    throw new TypeError("Payment storefront origin does not match deployment");
  return Object.freeze({
    runtime,
    connections: Object.freeze(connections),
    healthPolicies: Object.freeze(healthPolicies),
    webhookEndpoints: Object.freeze(webhookEndpoints),
  });
}
