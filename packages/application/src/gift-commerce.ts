import { createHash } from "node:crypto";
import {
  giftCommerceRequestSchema,
  giftCommerceResponseSchema,
  giftCommerceReadResponseSchema,
  giftCommerceRawContextSchema,
  giftCommerceMutationSchema,
  giftCommerceFailureSchema,
  giftCommerceAccessContextResponseSchema,
  giftCommerceAuthorizationResponseSchema,
  giftCommerceReceiptReadCommandSchema,
  persistencePortResponseSchema,
  sourceHashSchema,
  type GiftCommerceRequest,
  type GiftCommerceResponse,
  type GiftCommerceCommand,
  type GiftCommercePermission,
} from "@fan-support/contracts";
import {
  parsePersistenceTransactionFailure,
  type GiftCommerceRepositories,
  type GiftCommerceRepository,
  type GiftCommerceTransactionManager,
  type JsonValue,
} from "@fan-support/persistence-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import { addBaseContentSeconds } from "./base-content-time.js";
import { authorizeGiftContent } from "./gift-commerce-content.js";
import {
  CommerceRejected,
  commerceFailure,
  rejectCommerce,
  requireCommerceSuccess,
  requireSameCommercePrincipal,
  rejectCommercePersistence,
} from "./gift-commerce-results.js";
import {
  validateCommerceMutation,
  validateCommerceRead,
} from "./gift-commerce-validation.js";

const permissions: Record<
  GiftCommerceCommand["action"],
  GiftCommercePermission
> = {
  CONTEXT: "commerce.read",
  READ_GIFT: "commerce.read",
  READ_PRICES: "commerce.read",
  READ_INVENTORY: "commerce.read",
  CREATE_GIFT: "gift.manage",
  SET_GIFT_STATUS: "gift.manage",
  SAVE_VARIANT: "gift.manage",
  SAVE_GIFT_CONTENT: "gift.manage",
  CREATE_PRICE_REVISION: "pricing.manage",
  PUBLISH_PRICE_BOOK: "pricing.manage",
  ROLLBACK_PRICE_BOOK: "pricing.manage",
  CREATE_INVENTORY_LOCATION: "inventory.manage",
  ADJUST_INVENTORY: "inventory.manage",
};
function repositoryFor(
  repositories: GiftCommerceRepositories,
  command: GiftCommerceCommand,
): GiftCommerceRepository {
  switch (command.action) {
    case "CONTEXT":
    case "READ_PRICES":
    case "CREATE_PRICE_REVISION":
    case "PUBLISH_PRICE_BOOK":
    case "ROLLBACK_PRICE_BOOK":
      return repositories.pricing;
    case "READ_INVENTORY":
    case "CREATE_INVENTORY_LOCATION":
    case "ADJUST_INVENTORY":
      return repositories.inventory;
    default:
      return repositories.catalog;
  }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => {
          if (a < b) return -1;
          return a > b ? 1 : 0;
        })
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
async function runCommand(
  repositories: GiftCommerceRepositories,
  request: GiftCommerceRequest,
  tokenPepper: string,
): Promise<GiftCommerceResponse> {
  const command = request.command;
  const authorization = {
    schemaVersion: 1 as const,
    sessionTokenDigest: sourceHashSchema.parse(
      digestAdminContentToken({
        tokenPepper,
        purpose: "admin-session",
        token: request.sessionToken,
      }),
    ),
    csrfTokenDigest: sourceHashSchema.parse(
      digestAdminContentToken({
        tokenPepper,
        purpose: "admin-csrf",
        token: request.csrfToken,
      }),
    ),
  };
  const principal = requireSameCommercePrincipal(
    requireCommerceSuccess(
      giftCommerceAuthorizationResponseSchema.parse(
        await repositories.authorization.authorize({
          ...authorization,
          permission: permissions[command.action],
          locales: command.action === "READ_GIFT" ? [command.locale] : [],
        }),
      ),
    ).principal,
  );
  const repository = repositoryFor(repositories, command);
  if (command.action === "CONTEXT") {
    const access = requireCommerceSuccess(
      giftCommerceAccessContextResponseSchema.parse(
        await repositories.authorization.context(authorization),
      ),
    );
    requireSameCommercePrincipal(access.principal, principal);
    if (!access.permissions.includes("commerce.read"))
      rejectCommerce("FORBIDDEN");
    const raw = await repository.read(command);
    if (raw.outcome === "FAILURE")
      requireCommerceSuccess(giftCommerceFailureSchema.parse(raw));
    return {
      ...giftCommerceRawContextSchema.parse(raw),
      permissions: access.permissions,
      localeScopes: access.localeScopes,
    };
  }
  if (!("idempotencyKey" in command)) {
    const result = requireCommerceSuccess(
      giftCommerceReadResponseSchema.parse(await repository.read(command)),
    );
    validateCommerceRead(command, result);
    return result;
  }
  if (command.action === "SAVE_GIFT_CONTENT")
    await authorizeGiftContent(repositories, request, authorization, principal);
  const identity = {
    schemaVersion: 1 as const,
    actor: `actor-ref:v1:admin:${principal.actorId.toLowerCase()}`,
    idempotencyOperation: `admin.gift-commerce.${command.action.toLowerCase()}`,
    idempotencyKey: command.idempotencyKey,
    canonicalRequestHash: createHash("sha256")
      .update(
        JSON.stringify(
          canonical({ purpose: "gift-commerce-command-v1", command }),
        ),
      )
      .digest("hex"),
  };
  const begin = persistencePortResponseSchema.parse(
    await repositories.idempotency.begin({
      ...identity,
      operation: "BEGIN_IDEMPOTENCY",
      expiresAt: addBaseContentSeconds(principal.authorizedAt, 86_400),
    }),
  );
  if (begin.outcome === "FAILURE") rejectCommercePersistence(begin.error.code);
  if (begin.operation !== "BEGIN_IDEMPOTENCY")
    rejectCommerce("COMMERCE_UNAVAILABLE");
  if (begin.value.decision === "CONFLICT")
    rejectCommerce("IDEMPOTENCY_CONFLICT");
  if (begin.value.decision === "IN_PROGRESS") rejectCommerce("CONFLICT");
  if (begin.value.decision === "REPLAY") {
    const prefix = "result-ref:v1:";
    if (!begin.value.safeResultReference.startsWith(prefix))
      rejectCommerce("COMMERCE_UNAVAILABLE");
    const receipt = requireCommerceSuccess(
      giftCommerceResponseSchema.parse(
        await repository.readReceipt(
          giftCommerceReceiptReadCommandSchema.parse({
            schemaVersion: 1,
            resultId: begin.value.safeResultReference.slice(prefix.length),
            actorId: principal.actorId,
          }),
        ),
      ),
    );
    if (receipt.kind !== "MUTATION") rejectCommerce("COMMERCE_UNAVAILABLE");
    validateCommerceMutation(command, receipt);
    return { ...receipt, replayed: true };
  }
  const result = requireCommerceSuccess(
    giftCommerceResponseSchema.parse(
      await repository.write({
        schemaVersion: 1,
        requestId: request.requestId,
        principal,
        command,
      }),
    ),
  );
  if (result.kind !== "MUTATION" || result.replayed)
    rejectCommerce("COMMERCE_UNAVAILABLE");
  validateCommerceMutation(command, result);
  const complete = persistencePortResponseSchema.parse(
    await repositories.idempotency.complete({
      ...identity,
      operation: "COMPLETE_IDEMPOTENCY",
      status: "SUCCEEDED",
      safeResultReference: `result-ref:v1:${result.resultId.toLowerCase()}`,
    }),
  );
  if (complete.outcome === "FAILURE")
    rejectCommercePersistence(complete.error.code);
  if (complete.operation !== "COMPLETE_IDEMPOTENCY")
    rejectCommerce("COMMERCE_UNAVAILABLE");
  return giftCommerceMutationSchema.parse(result);
}
export type GiftCommerceDependencies = Readonly<{
  transactions: GiftCommerceTransactionManager;
  tokenPepper: string;
}>;
export function createGiftCommerceUseCases(
  dependencies: GiftCommerceDependencies,
) {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  if (
    typeof dependencies.transactions?.runInGiftCommerceTransaction !==
    "function"
  )
    throw new TypeError("Invalid gift commerce transaction manager");
  return Object.freeze({
    async execute(input: unknown): Promise<GiftCommerceResponse> {
      const parsed = giftCommerceRequestSchema.safeParse(input);
      if (!parsed.success) return commerceFailure("INVALID_COMMAND");
      try {
        return giftCommerceResponseSchema.parse(
          await dependencies.transactions.runInGiftCommerceTransaction(
            async (repositories) =>
              JSON.parse(
                JSON.stringify(
                  await runCommand(
                    repositories,
                    parsed.data,
                    dependencies.tokenPepper,
                  ),
                ),
              ) as JsonValue,
          ),
        );
      } catch (error) {
        if (error instanceof CommerceRejected) return error.failure;
        const code = parsePersistenceTransactionFailure(error)?.error.code;
        if (code === "ALREADY_EXISTS") return commerceFailure("ALREADY_EXISTS");
        if (code === "TRANSACTION_ABORTED" || code === "VERSION_CONFLICT")
          return commerceFailure("CONFLICT");
        return commerceFailure("COMMERCE_UNAVAILABLE");
      }
    },
  });
}
export type GiftCommerceUseCases = ReturnType<
  typeof createGiftCommerceUseCases
>;
