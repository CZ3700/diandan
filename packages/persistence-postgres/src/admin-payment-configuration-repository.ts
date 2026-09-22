import { adminPaymentConfigurationStoreRequestSchema } from "@fan-support/contracts";
import type { AdminPaymentConfigurationRepository } from "@fan-support/persistence-port";
import {
  authorizeConfiguration,
  confirmConfigurationAuthority,
} from "./admin-payment-configuration-authorization.js";
import {
  readConfigurationWorkspace,
  readPublishedConfiguration,
} from "./admin-payment-configuration-read.js";
import {
  saveConfiguration,
  reviewConfiguration,
  recordConfigurationReceipt,
} from "./admin-payment-configuration-authoring.js";
import { validateConfiguration } from "./admin-payment-configuration-validation.js";
import { publishConfiguration } from "./admin-payment-configuration-publication.js";
import {
  configurationHead,
  configurationFailure,
  configurationResponse,
  draftRows,
  type TransactionClient,
} from "./admin-payment-configuration-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionScopeControl,
} from "./transaction-runner.js";
export function createAdminPaymentConfigurationRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): AdminPaymentConfigurationRepository {
  const run = <T>(work: () => Promise<T>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    readPublished: () => run(() => readPublishedConfiguration(client)),
    execute: (input) =>
      run(async () => {
        const parsed =
          adminPaymentConfigurationStoreRequestSchema.safeParse(input);
        if (!parsed.success) return configurationFailure("INVALID_COMMAND");
        const request = parsed.data,
          c = request.command,
          auth = await authorizeConfiguration(client, request.access);
        if (auth.outcome === "FAILURE") return auth;
        const { authority } = auth;
        const required =
          c.action === "APPROVE"
            ? "payments.review"
            : c.action === "PUBLISH" || c.action === "ROLLBACK"
              ? "payments.publish"
              : c.action === "READ"
                ? null
                : "payments.configure";
        if (required && !authority.permissions.includes(required))
          return configurationFailure("FORBIDDEN");
        if (
          c.action === "APPROVE" &&
          !authority.reviewLocales.includes(c.locale)
        )
          return configurationFailure("FORBIDDEN");
        if ("idempotencyKey" in c) {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [
              `admin-payment-configuration:${authority.actorId}:${c.action}:${c.idempotencyKey}`,
            ],
          );
          const [prior] = await draftRows(
            client,
            `SELECT * FROM public.admin_payment_configuration_receipts WHERE actor_id=$1 AND action=$2 AND idempotency_key=$3`,
            [authority.actorId, c.action, c.idempotencyKey],
          );
          if (prior) {
            const expired = await confirmConfigurationAuthority(
              client,
              authority,
            );
            if (expired) return expired;
            return prior["request_hash"] === request.requestHash
              ? configurationResponse({
                  schemaVersion: 1,
                  outcome: "SUCCESS",
                  kind: "MUTATION",
                  action: c.action,
                  revisionId: prior["config_version_id"],
                  publicationId: prior["publication_id"],
                  generation: Number(prior["generation"]),
                  replayed: true,
                })
              : configurationFailure("IDEMPOTENCY_CONFLICT");
          }
        }
        const head = await configurationHead(client, c.action !== "READ");
        const expired = await confirmConfigurationAuthority(client, authority);
        if (expired) return expired;
        if (
          "expectedPublicationId" in c &&
          c.expectedPublicationId !== (head?.["publication_id"] ?? null)
        )
          return configurationFailure("STALE_VERSION");
        let result;
        if (c.action === "READ")
          result = await readConfigurationWorkspace(
            client,
            request,
            authority,
            head,
          );
        else if (c.action === "VALIDATE")
          result = await validateConfiguration(
            client,
            request,
            authority,
            head,
          );
        else if (c.action === "PUBLISH" || c.action === "ROLLBACK")
          result = await publishConfiguration(client, request, authority, head);
        else {
          const saved =
            c.action === "SAVE"
              ? await saveConfiguration(client, request, authority)
              : await reviewConfiguration(client, request, authority);
          result =
            "outcome" in saved
              ? saved
              : await recordConfigurationReceipt(
                  client,
                  request,
                  authority,
                  head,
                  saved,
                );
        }
        const finalExpiry = await confirmConfigurationAuthority(
          client,
          authority,
        );
        if (finalExpiry && c.action !== "READ")
          throw new Error(
            "Payment configuration authority expired during mutation",
          );
        return finalExpiry ?? configurationResponse(result);
      }),
  };
}
