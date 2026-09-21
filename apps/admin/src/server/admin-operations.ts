import * as contract from "@fan-support/contracts";

type Parser = Readonly<{ parse(input: unknown): unknown }>;
export type AdminOperation = Readonly<{
  path: string;
  credentials: "SESSION" | "PREVIEW";
  bodyLimit: number;
  readOnly: boolean;
  parseCommand(body: unknown, idempotencyKey?: string): unknown;
  parseResponse(input: unknown): unknown;
  apiBody(command: unknown): unknown;
}>;
const SMALL = 64 * 1024;
const LARGE = 16 * 1024 * 1024;
const forbidden = [
  "idempotencyKey",
  "requestId",
  "actorId",
  "sessionToken",
  "csrfToken",
];
function operation(
  path: string,
  command: Parser,
  response: Parser,
  action: string | null,
  kind: string | undefined,
  mutation = false,
  bodyLimit = SMALL,
  credentials: "SESSION" | "PREVIEW" = "SESSION",
): AdminOperation {
  return Object.freeze({
    path,
    credentials,
    bodyLimit,
    readOnly:
      !mutation && credentials === "SESSION" && !path.endsWith("/issue"),
    parseCommand(body, idempotencyKey) {
      if (
        body === null ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        forbidden.some((key) => Object.hasOwn(body, key)) ||
        (action !== null && Object.hasOwn(body, "action"))
      )
        throw new Error("Invalid administrative body");
      return command.parse({
        ...body,
        ...(action === null ? {} : { action }),
        ...(mutation ? { idempotencyKey } : {}),
      });
    },
    apiBody(command) {
      const value = { ...(command as Record<string, unknown>) };
      if (action !== null) delete value["action"];
      delete value["idempotencyKey"];
      return value;
    },
    parseResponse(input) {
      const parsed = response.parse(input) as {
        outcome: string;
        kind?: string;
      };
      if (parsed.outcome === "SUCCESS" && parsed.kind !== kind)
        throw new Error("Invalid administrative response");
      return parsed;
    },
  });
}
function commerceOperation(
  path: string,
  action: contract.GiftCommerceCommand["action"],
  mutation = false,
  bodyLimit = SMALL,
): AdminOperation {
  const base = operation(
    `/api/v1/admin/gift-commerce/${path}`,
    contract.giftCommerceCommandSchema,
    contract.giftCommerceResponseSchema,
    action,
    undefined,
    mutation,
    bodyLimit,
  );
  return Object.freeze({
    ...base,
    parseResponse(input) {
      const response = contract.giftCommerceResponseSchema.parse(input);
      if (response.outcome === "FAILURE") return response;
      let matches = false;
      if (mutation)
        matches = response.kind === "MUTATION" && response.action === action;
      else
        switch (action) {
          case "CONTEXT":
            matches = response.kind === "COMMERCE_CONTEXT";
            break;
          case "READ_GIFT":
            matches = response.kind === "GIFT";
            break;
          case "READ_PRICES":
            matches =
              response.kind === "PRICE_BOOKS" || response.kind === "PRICES";
            break;
          case "READ_INVENTORY":
            matches =
              response.kind === "INVENTORY_BALANCES" ||
              response.kind === "INVENTORY_LEDGER";
            break;
        }
      if (!matches) throw new Error("Invalid commerce response");
      return response;
    },
  });
}
const entries = {
  "finance-list": operation(
    "/api/v1/admin/finance/list",
    contract.adminFinanceCommandSchema,
    contract.adminFinanceResponseSchema,
    "LIST",
    "LIST",
  ),
  "finance-detail": operation(
    "/api/v1/admin/finance/detail",
    contract.adminFinanceCommandSchema,
    contract.adminFinanceResponseSchema,
    "DETAIL",
    "DETAIL",
  ),
  "finance-refund": operation(
    "/api/v1/admin/finance/refund",
    contract.adminFinanceCommandSchema,
    contract.adminFinanceResponseSchema,
    "REFUND",
    "MUTATION",
    true,
  ),
  "finance-cancel": operation(
    "/api/v1/admin/finance/cancel",
    contract.adminFinanceCommandSchema,
    contract.adminFinanceResponseSchema,
    "CANCEL",
    "MUTATION",
    true,
  ),
  "finance-reconcile": operation(
    "/api/v1/admin/finance/reconcile",
    contract.adminFinanceCommandSchema,
    contract.adminFinanceResponseSchema,
    "RECONCILE",
    "MUTATION",
    true,
  ),
  "orders-context": operation(
    "/api/v1/admin/orders/context",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "CONTEXT",
    "CONTEXT",
  ),
  "orders-list": operation(
    "/api/v1/admin/orders/list",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "LIST",
    "LIST",
  ),
  "orders-detail": operation(
    "/api/v1/admin/orders/detail",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "DETAIL",
    "DETAIL",
  ),
  "orders-message-read": operation(
    "/api/v1/admin/orders/message/read",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersPrivateResponseSchema,
    "READ_MESSAGE",
    "MESSAGE",
  ),
  "orders-message-review": operation(
    "/api/v1/admin/orders/message/review",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "REVIEW_MESSAGE",
    "MUTATION",
    true,
  ),
  "orders-prepare": operation(
    "/api/v1/admin/orders/prepare",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "PREPARE",
    "MUTATION",
    true,
  ),
  "orders-deliver": operation(
    "/api/v1/admin/orders/deliver",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "DELIVER",
    "MUTATION",
    true,
  ),
  "orders-hold": operation(
    "/api/v1/admin/orders/hold",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "HOLD",
    "MUTATION",
    true,
  ),
  "orders-resume": operation(
    "/api/v1/admin/orders/resume",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "RESUME",
    "MUTATION",
    true,
  ),
  "orders-note-add": operation(
    "/api/v1/admin/orders/note/add",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "ADD_NOTE",
    "MUTATION",
    true,
  ),
  "orders-notes-read": operation(
    "/api/v1/admin/orders/notes/read",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersPrivateResponseSchema,
    "READ_NOTES",
    "NOTES",
  ),
  "orders-notification-resend": operation(
    "/api/v1/admin/orders/notification/resend",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "RESEND_NOTIFICATION",
    "MUTATION",
    true,
  ),
  "management-context": operation(
    "/api/v1/admin/management/context",
    contract.managementCenterCommandSchema,
    contract.managementCenterResponseSchema,
    "CONTEXT",
    "CONTEXT",
  ),
  "management-list": operation(
    "/api/v1/admin/management/list",
    contract.managementCenterCommandSchema,
    contract.managementCenterResponseSchema,
    "LIST",
    "LIST",
  ),
  "management-prepare-upload": operation(
    "/api/v1/admin/management/uploads/prepare",
    contract.managementCenterCommandSchema,
    contract.managementCenterResponseSchema,
    "PREPARE_UPLOAD",
    "UPLOAD_GRANT",
    true,
  ),
  "management-submit": operation(
    "/api/v1/admin/management/submit",
    contract.managementCenterCommandSchema,
    contract.managementCenterResponseSchema,
    "SUBMIT",
    "OPERATION",
    true,
  ),
  "management-read-operation": operation(
    "/api/v1/admin/management/operations/read",
    contract.managementCenterCommandSchema,
    contract.managementCenterResponseSchema,
    "READ_OPERATION",
    "OPERATION",
  ),
  "management-retry-operation": operation(
    "/api/v1/admin/management/operations/retry",
    contract.managementCenterCommandSchema,
    contract.managementCenterResponseSchema,
    "RETRY_OPERATION",
    "OPERATION",
    true,
  ),
  "commerce-context": commerceOperation("context/read", "CONTEXT"),
  "gift-read": commerceOperation("gifts/read", "READ_GIFT"),
  "gift-create": commerceOperation("gifts/create", "CREATE_GIFT", true),
  "gift-status": commerceOperation("gifts/status", "SET_GIFT_STATUS", true),
  "gift-variant-save": commerceOperation(
    "variants/save",
    "SAVE_VARIANT",
    true,
    128 * 1024,
  ),
  "gift-content-save": commerceOperation(
    "content/save",
    "SAVE_GIFT_CONTENT",
    true,
    LARGE,
  ),
  "prices-read": commerceOperation("prices/read", "READ_PRICES"),
  "price-revision-create": commerceOperation(
    "prices/create",
    "CREATE_PRICE_REVISION",
    true,
  ),
  "price-book-publish": commerceOperation(
    "prices/publish",
    "PUBLISH_PRICE_BOOK",
    true,
  ),
  "price-book-rollback": commerceOperation(
    "prices/rollback",
    "ROLLBACK_PRICE_BOOK",
    true,
  ),
  "inventory-read": commerceOperation("inventory/read", "READ_INVENTORY"),
  "inventory-adjust": commerceOperation(
    "inventory/adjust",
    "ADJUST_INVENTORY",
    true,
  ),
  "inventory-location-create": commerceOperation(
    "inventory/locations/create",
    "CREATE_INVENTORY_LOCATION",
    true,
  ),
  session: operation(
    "/api/v1/admin/session/read",
    contract.adminSessionCommandSchema,
    contract.adminSessionResponseSchema,
    "READ_SESSION",
    "ADMIN_SESSION",
  ),
  "authoring-read": operation(
    "/api/v1/admin/content-authoring/read",
    contract.contentAuthoringCommandSchema,
    contract.contentAuthoringResponseSchema,
    "READ",
    "REVISION",
    false,
    LARGE,
  ),
  "authoring-create": operation(
    "/api/v1/admin/content-authoring/create",
    contract.contentAuthoringCommandSchema,
    contract.contentAuthoringResponseSchema,
    "CREATE",
    "MUTATION",
    true,
    LARGE,
  ),
  "authoring-copy": operation(
    "/api/v1/admin/content-authoring/copy",
    contract.contentAuthoringCommandSchema,
    contract.contentAuthoringResponseSchema,
    "COPY",
    "MUTATION",
    true,
    LARGE,
  ),
  "review-read": operation(
    "/api/v1/admin/content-review/read",
    contract.baseContentCommandSchema,
    contract.baseContentResponseSchema,
    "READ_REVIEW",
    "REVIEW",
  ),
  "review-submit": operation(
    "/api/v1/admin/content-review/submit",
    contract.baseContentCommandSchema,
    contract.baseContentResponseSchema,
    "SUBMIT_REVIEW",
    "MUTATION",
    true,
  ),
  "review-approve": operation(
    "/api/v1/admin/content-review/approve",
    contract.baseContentCommandSchema,
    contract.baseContentResponseSchema,
    "APPROVE_REVIEW",
    "MUTATION",
    true,
  ),
  "preview-issue": operation(
    "/api/v1/admin/content-review/preview/issue",
    contract.baseContentCommandSchema,
    contract.baseContentResponseSchema,
    "ISSUE_PREVIEW",
    "PREVIEW_GRANT",
  ),
  "preview-revoke": operation(
    "/api/v1/admin/content-review/preview/revoke",
    contract.baseContentCommandSchema,
    contract.baseContentResponseSchema,
    "REVOKE_PREVIEW",
    "MUTATION",
    true,
  ),
  "preview-content-read": operation(
    "/api/v1/content-review-preview/read",
    contract.baseContentPreviewRequestSchema,
    contract.baseContentPreviewResponseSchema,
    null,
    undefined,
    false,
    SMALL,
    "PREVIEW",
  ),
  "alias-draft-read": operation(
    "/api/v1/admin/content/drafts/read",
    contract.adminContentCommandSchema,
    contract.adminContentResponseSchema,
    "READ_DRAFT",
    "DRAFT",
    false,
    LARGE,
  ),
  "alias-draft-create": operation(
    "/api/v1/admin/content/drafts/aliases",
    contract.adminContentCommandSchema,
    contract.adminContentResponseSchema,
    "CREATE_IDOL_ALIASES",
    "MUTATION",
    true,
    LARGE,
  ),
  "gift-detail-draft-create": operation(
    "/api/v1/admin/content/drafts/gift-details",
    contract.adminContentCommandSchema,
    contract.adminContentResponseSchema,
    "CREATE_GIFT_DETAILS",
    "MUTATION",
    true,
    LARGE,
  ),
  "alias-review-read": operation(
    "/api/v1/admin/content/reviews/read",
    contract.adminContentCommandSchema,
    contract.adminContentResponseSchema,
    "READ_REVIEW",
    "REVIEW",
    false,
    LARGE,
  ),
  "alias-review-submit": operation(
    "/api/v1/admin/content/reviews/submit",
    contract.adminContentCommandSchema,
    contract.adminContentResponseSchema,
    "SUBMIT_REVIEW",
    "MUTATION",
    true,
    LARGE,
  ),
  "alias-review-approve": operation(
    "/api/v1/admin/content/reviews/approve",
    contract.adminContentCommandSchema,
    contract.adminContentResponseSchema,
    "APPROVE_REVIEW",
    "MUTATION",
    true,
    LARGE,
  ),
  "alias-preview-issue": operation(
    "/api/v1/admin/content/preview/issue",
    contract.adminContentCommandSchema,
    contract.adminContentResponseSchema,
    "ISSUE_PREVIEW",
    "PREVIEW_GRANT",
  ),
  "alias-preview-revoke": operation(
    "/api/v1/admin/content/preview/revoke",
    contract.adminContentCommandSchema,
    contract.adminContentResponseSchema,
    "REVOKE_PREVIEW",
    "MUTATION",
    true,
  ),
  "alias-preview-content-read": operation(
    "/api/v1/content-preview/read",
    contract.contentPreviewRequestSchema,
    contract.contentPreviewResponseSchema,
    null,
    undefined,
    false,
    SMALL,
    "PREVIEW",
  ),
  "preview-media-read": operation(
    "/api/v1/admin-preview-media/read",
    contract.adminPreviewMediaRequestSchema,
    contract.adminPreviewMediaResponseSchema,
    null,
    "PREVIEW_MEDIA",
    false,
    SMALL,
    "PREVIEW",
  ),
  "publication-preflight": operation(
    "/api/v1/admin/content/publication/preflight",
    contract.publicationPreflightCommandSchema,
    contract.publicationPreflightResponseSchema,
    null,
    "PUBLICATION_PREFLIGHT",
  ),
  "publication-validate": operation(
    "/api/v1/admin/content/publication/validate",
    contract.publicationRuntimeCommandSchema,
    contract.publicationRuntimeResponseSchema,
    "VALIDATE",
    "PUBLICATION_MUTATION",
    true,
  ),
  "publication-publish": operation(
    "/api/v1/admin/content/publication/publish",
    contract.publicationRuntimeCommandSchema,
    contract.publicationRuntimeResponseSchema,
    "PUBLISH",
    "PUBLICATION_MUTATION",
    true,
  ),
  "publication-rollback": operation(
    "/api/v1/admin/content/publication/rollback",
    contract.publicationRuntimeCommandSchema,
    contract.publicationRuntimeResponseSchema,
    "ROLLBACK",
    "PUBLICATION_MUTATION",
    true,
  ),
  "publication-status": operation(
    "/api/v1/admin/content/publication/status",
    contract.publicationRuntimeCommandSchema,
    contract.publicationRuntimeResponseSchema,
    "STATUS",
    "PUBLICATION_STATUS",
  ),
  "publication-retry": operation(
    "/api/v1/admin/content/publication/retry",
    contract.publicationRuntimeCommandSchema,
    contract.publicationRuntimeResponseSchema,
    "RETRY_PURGE",
    "PURGE_RETRY",
    true,
  ),
  "media-upload-begin": operation(
    "/api/v1/admin/resources/uploads/begin",
    contract.adminResourceCommandSchema,
    contract.adminResourceResponseSchema,
    "BEGIN_UPLOAD",
    "UPLOAD_GRANT",
    true,
  ),
  "media-upload-complete": operation(
    "/api/v1/admin/resources/uploads/complete",
    contract.adminResourceCommandSchema,
    contract.adminResourceResponseSchema,
    "COMPLETE_UPLOAD",
    "MUTATION",
    true,
  ),
  "media-upload-read": operation(
    "/api/v1/admin/resources/uploads/read",
    contract.adminResourceCommandSchema,
    contract.adminResourceResponseSchema,
    "READ_UPLOAD",
    "UPLOAD",
  ),
  "media-read": operation(
    "/api/v1/admin/resources/media/read",
    contract.adminResourceCommandSchema,
    contract.adminResourceResponseSchema,
    "READ_MEDIA",
    "MEDIA",
  ),
  "media-job-read": operation(
    "/api/v1/admin/resources/processing/read",
    contract.adminResourceCommandSchema,
    contract.adminResourceResponseSchema,
    "READ_MEDIA_JOB",
    "MEDIA_JOB",
  ),
  "media-rights": operation(
    "/api/v1/admin/resources/media/rights",
    contract.adminResourceCommandSchema,
    contract.adminResourceResponseSchema,
    "SET_MEDIA_RIGHTS",
    "MUTATION",
    true,
  ),
  "media-enqueue": operation(
    "/api/v1/admin/resources/processing/enqueue",
    contract.adminResourceCommandSchema,
    contract.adminResourceResponseSchema,
    "ENQUEUE_MEDIA",
    "MUTATION",
    true,
  ),
  "media-retry": operation(
    "/api/v1/admin/resources/processing/retry",
    contract.adminResourceCommandSchema,
    contract.adminResourceResponseSchema,
    "RETRY_MEDIA_JOB",
    "MUTATION",
    true,
  ),
  "policy-read": operation(
    "/api/v1/admin/resources/policies/read",
    contract.adminResourceCommandSchema,
    contract.adminResourceResponseSchema,
    "READ_POLICY",
    "POLICY",
  ),
  "policy-create": operation(
    "/api/v1/admin/resources/policies/register",
    contract.adminResourceCommandSchema,
    contract.adminResourceResponseSchema,
    "REGISTER_POLICY",
    "MUTATION",
    true,
  ),
  "catalog-list": operation(
    "/api/v1/admin/catalog/owners/list",
    contract.adminCatalogCommandSchema,
    contract.adminCatalogResponseSchema,
    "LIST_OWNERS",
    "OWNERS",
  ),
  "catalog-owner": operation(
    "/api/v1/admin/catalog/owners/read",
    contract.adminCatalogCommandSchema,
    contract.adminCatalogResponseSchema,
    "READ_OWNER",
    "OWNER",
  ),
  "catalog-history": operation(
    "/api/v1/admin/catalog/history/read",
    contract.adminCatalogCommandSchema,
    contract.adminCatalogResponseSchema,
    "READ_HISTORY",
    "HISTORY",
  ),
  "idol-create": operation(
    "/api/v1/admin/catalog/idols/create",
    contract.adminCatalogCommandSchema,
    contract.adminCatalogResponseSchema,
    "CREATE_IDOL",
    "MUTATION",
    true,
  ),
  "idol-rename": operation(
    "/api/v1/admin/catalog/idols/rename",
    contract.adminCatalogCommandSchema,
    contract.adminCatalogResponseSchema,
    "RENAME_IDOL",
    "MUTATION",
    true,
  ),
  "idol-status": operation(
    "/api/v1/admin/catalog/idols/status",
    contract.adminCatalogCommandSchema,
    contract.adminCatalogResponseSchema,
    "SET_IDOL_STATUS",
    "MUTATION",
    true,
  ),
  "translation-read": operation(
    "/api/v1/admin/translation-workspace/read",
    contract.translationWorkspaceCommandSchema,
    contract.translationWorkspaceResponseSchema,
    "READ",
    "TRANSLATION_WORKSPACE",
  ),
  "translation-export": operation(
    "/api/v1/admin/translation-transfer/export",
    contract.translationTransferCommandSchema,
    contract.translationTransferResponseSchema,
    "EXPORT",
    "TRANSLATION_EXPORT",
    true,
    LARGE,
  ),
  "translation-import": operation(
    "/api/v1/admin/translation-transfer/import",
    contract.translationTransferCommandSchema,
    contract.translationTransferResponseSchema,
    "IMPORT",
    "MUTATION",
    true,
    LARGE,
  ),
} as const;
export type AdminOperationKey = Exclude<keyof typeof entries, "session">;
export const ADMIN_OPERATION_KEYS = Object.freeze(
  Object.keys(entries).filter(
    (key) => key !== "session",
  ) as AdminOperationKey[],
);
export function getAdminOperation(key: string): AdminOperation | undefined {
  return Object.hasOwn(entries, key)
    ? entries[key as keyof typeof entries]
    : undefined;
}
