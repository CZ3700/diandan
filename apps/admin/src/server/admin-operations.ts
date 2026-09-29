import * as contract from "@fan-support/contracts";

type Parser = Readonly<{ parse(input: unknown): unknown }>;
export type AdminOperation = Readonly<{
  path: string;
  credentials: "SESSION" | "PREVIEW";
  bodyLimit: number;
  readOnly: boolean;
  parseCommand(body: unknown, idempotencyKey?: string): unknown;
  parseResponse(input: unknown): unknown;
  responseMatches?: (command: unknown, response: unknown) => boolean;
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
/** ADR-021 account settings: an OIDC session answers NOT_LOCAL instead of the action's kind. */
function accountOperation(
  path: string,
  action: contract.AdminAccountCommand["action"],
  kind: string,
): AdminOperation {
  const base = operation(
    `/api/v1/admin/account/${path}`,
    contract.adminAccountCommandSchema,
    contract.adminAccountResponseSchema,
    action,
    kind,
    false,
    4096,
  );
  return Object.freeze({
    ...base,
    readOnly: action === "READ",
    parseResponse(input: unknown) {
      const parsed = contract.adminAccountResponseSchema.parse(input);
      if (
        parsed.outcome === "SUCCESS" &&
        parsed.kind !== kind &&
        parsed.kind !== "NOT_LOCAL"
      )
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
function exceptionOperation(
  action: contract.AdminExceptionsCommand["action"],
  kind: string,
  mutation = false,
): AdminOperation {
  return Object.freeze({
    ...operation(
      `/api/v1/admin/exceptions/${action.toLowerCase().replaceAll("_", "-")}`,
      contract.adminExceptionsCommandSchema,
      contract.adminExceptionsResponseSchema,
      action,
      kind,
      mutation,
    ),
    responseMatches(command: unknown, response: unknown) {
      return contract.adminExceptionsResponseMatches(
        contract.adminExceptionsCommandSchema.parse(command),
        response,
      );
    },
  });
}
function informationOperation(
  path: string,
  command: Parser,
  response: Parser,
  action: string,
  kind: string,
  mutation: boolean,
): AdminOperation {
  const base = operation(
    path,
    command,
    response,
    action,
    kind,
    mutation,
    action === "SAVE_DRAFT" ? 256 * 1024 : SMALL,
  );
  return {
    ...base,
    responseMatches(input, output) {
      const request = contract.informationPageCommandSchema.parse(input);
      const result = contract.informationPageResponseSchema.parse(output);
      if (result.outcome === "FAILURE") return true;
      if (request.action === "LIST") return result.kind === "LIST";
      if (request.action === "HISTORY")
        return (
          result.kind === "HISTORY" &&
          result.page === request.page &&
          result.pageSize === request.pageSize &&
          result.entries.every((entry) => entry.pageKey === request.pageKey)
        );
      if (
        result.kind !== "STATE" ||
        result.workspace.pageKey !== request.pageKey ||
        result.workspace.locale !== request.locale
      )
        return false;
      return (
        request.action === "READ" ||
        result.workspace.version === request.expectedVersion + 1
      );
    },
  };
}
const entries = {
  "information-pages-list": informationOperation(
    "/api/v1/admin/information-pages/list",
    contract.informationPageCommandSchema,
    contract.informationPageResponseSchema,
    "LIST",
    "LIST",
    false,
  ),
  "information-pages-read": informationOperation(
    "/api/v1/admin/information-pages/read",
    contract.informationPageCommandSchema,
    contract.informationPageResponseSchema,
    "READ",
    "STATE",
    false,
  ),
  "information-pages-save": informationOperation(
    "/api/v1/admin/information-pages/save",
    contract.informationPageCommandSchema,
    contract.informationPageResponseSchema,
    "SAVE_DRAFT",
    "STATE",
    true,
  ),
  "information-pages-submit": informationOperation(
    "/api/v1/admin/information-pages/submit",
    contract.informationPageCommandSchema,
    contract.informationPageResponseSchema,
    "SUBMIT_REVIEW",
    "STATE",
    true,
  ),
  "information-pages-approve": informationOperation(
    "/api/v1/admin/information-pages/approve",
    contract.informationPageCommandSchema,
    contract.informationPageResponseSchema,
    "APPROVE_REVIEW",
    "STATE",
    true,
  ),
  "information-pages-publish": informationOperation(
    "/api/v1/admin/information-pages/publish",
    contract.informationPageCommandSchema,
    contract.informationPageResponseSchema,
    "PUBLISH",
    "STATE",
    true,
  ),
  "information-pages-unpublish": informationOperation(
    "/api/v1/admin/information-pages/unpublish",
    contract.informationPageCommandSchema,
    contract.informationPageResponseSchema,
    "UNPUBLISH",
    "STATE",
    true,
  ),
  "information-pages-restore": informationOperation(
    "/api/v1/admin/information-pages/restore",
    contract.informationPageCommandSchema,
    contract.informationPageResponseSchema,
    "RESTORE",
    "STATE",
    true,
  ),
  "information-pages-history": informationOperation(
    "/api/v1/admin/information-pages/history",
    contract.informationPageCommandSchema,
    contract.informationPageResponseSchema,
    "HISTORY",
    "HISTORY",
    false,
  ),

  "home-layout-read": operation(
    "/api/v1/admin/home-layout/read",
    contract.homeLayoutCommandSchema,
    contract.homeLayoutResponseSchema,
    "READ",
    "STATE",
  ),
  "home-layout-draft": operation(
    "/api/v1/admin/home-layout/draft",
    contract.homeLayoutCommandSchema,
    contract.homeLayoutResponseSchema,
    "SAVE_DRAFT",
    "STATE",
    true,
  ),
  "home-layout-publish": operation(
    "/api/v1/admin/home-layout/publish",
    contract.homeLayoutCommandSchema,
    contract.homeLayoutResponseSchema,
    "PUBLISH",
    "STATE",
    true,
  ),
  "home-layout-restore": operation(
    "/api/v1/admin/home-layout/restore",
    contract.homeLayoutCommandSchema,
    contract.homeLayoutResponseSchema,
    "RESTORE",
    "STATE",
    true,
  ),
  "home-layout-history": operation(
    "/api/v1/admin/home-layout/history",
    contract.homeLayoutCommandSchema,
    contract.homeLayoutResponseSchema,
    "HISTORY",
    "HISTORY",
  ),
  "storefront-theme-read": operation(
    "/api/v1/admin/storefront-theme/read",
    contract.storefrontThemeCommandSchema,
    contract.storefrontThemeResponseSchema,
    "READ",
    "STATE",
  ),
  "storefront-theme-draft": operation(
    "/api/v1/admin/storefront-theme/draft",
    contract.storefrontThemeCommandSchema,
    contract.storefrontThemeResponseSchema,
    "SAVE_DRAFT",
    "STATE",
    true,
  ),
  "storefront-theme-publish": operation(
    "/api/v1/admin/storefront-theme/publish",
    contract.storefrontThemeCommandSchema,
    contract.storefrontThemeResponseSchema,
    "PUBLISH",
    "STATE",
    true,
  ),
  "storefront-theme-restore": operation(
    "/api/v1/admin/storefront-theme/restore",
    contract.storefrontThemeCommandSchema,
    contract.storefrontThemeResponseSchema,
    "RESTORE",
    "STATE",
    true,
  ),
  "storefront-theme-history": operation(
    "/api/v1/admin/storefront-theme/history",
    contract.storefrontThemeCommandSchema,
    contract.storefrontThemeResponseSchema,
    "HISTORY",
    "HISTORY",
  ),
  "display-order-read": operation(
    "/api/v1/admin/display-order/read",
    contract.catalogDisplayOrderCommandSchema,
    contract.catalogDisplayOrderResponseSchema,
    "READ",
    "DISPLAY_ORDER",
  ),
  "display-order-save": operation(
    "/api/v1/admin/display-order/save",
    contract.catalogDisplayOrderCommandSchema,
    contract.catalogDisplayOrderResponseSchema,
    "SAVE",
    "DISPLAY_ORDER",
    true,
  ),
  "storefront-navigation-read": operation(
    "/api/v1/admin/storefront-navigation/read",
    contract.storefrontNavigationCommandSchema,
    contract.storefrontNavigationResponseSchema,
    "READ",
    "STATE",
  ),
  "storefront-navigation-draft": operation(
    "/api/v1/admin/storefront-navigation/draft",
    contract.storefrontNavigationCommandSchema,
    contract.storefrontNavigationResponseSchema,
    "SAVE_DRAFT",
    "STATE",
    true,
  ),
  "storefront-navigation-publish": operation(
    "/api/v1/admin/storefront-navigation/publish",
    contract.storefrontNavigationCommandSchema,
    contract.storefrontNavigationResponseSchema,
    "PUBLISH",
    "STATE",
    true,
  ),
  "storefront-navigation-restore": operation(
    "/api/v1/admin/storefront-navigation/restore",
    contract.storefrontNavigationCommandSchema,
    contract.storefrontNavigationResponseSchema,
    "RESTORE",
    "STATE",
    true,
  ),
  "storefront-navigation-history": operation(
    "/api/v1/admin/storefront-navigation/history",
    contract.storefrontNavigationCommandSchema,
    contract.storefrontNavigationResponseSchema,
    "HISTORY",
    "HISTORY",
  ),
  "exceptions-context": exceptionOperation("CONTEXT", "CONTEXT"),
  "exceptions-list": exceptionOperation("LIST", "LIST"),
  "exceptions-detail": exceptionOperation("DETAIL", "DETAIL"),
  "exceptions-replay-webhook": exceptionOperation(
    "REPLAY_WEBHOOK",
    "MUTATION",
    true,
  ),
  "exceptions-retry-dead-letter": exceptionOperation(
    "RETRY_DEAD_LETTER",
    "MUTATION",
    true,
  ),
  "exceptions-reconcile-payment": exceptionOperation(
    "RECONCILE_PAYMENT",
    "MUTATION",
    true,
  ),
  "exceptions-retry-notification": exceptionOperation(
    "RETRY_NOTIFICATION",
    "MUTATION",
    true,
  ),
  "payment-config-read": operation(
    "/api/v1/admin/payment-configuration/read",
    contract.adminPaymentConfigurationCommandSchema,
    contract.adminPaymentConfigurationResponseSchema,
    "READ",
    "WORKSPACE",
  ),
  "payment-config-save": operation(
    "/api/v1/admin/payment-configuration/save",
    contract.adminPaymentConfigurationCommandSchema,
    contract.adminPaymentConfigurationResponseSchema,
    "SAVE",
    "MUTATION",
    true,
    512 * 1024,
  ),
  "payment-config-submit": operation(
    "/api/v1/admin/payment-configuration/submit",
    contract.adminPaymentConfigurationCommandSchema,
    contract.adminPaymentConfigurationResponseSchema,
    "SUBMIT",
    "MUTATION",
    true,
  ),
  "payment-config-approve": operation(
    "/api/v1/admin/payment-configuration/approve",
    contract.adminPaymentConfigurationCommandSchema,
    contract.adminPaymentConfigurationResponseSchema,
    "APPROVE",
    "MUTATION",
    true,
  ),
  "payment-config-validate": operation(
    "/api/v1/admin/payment-configuration/validate",
    contract.adminPaymentConfigurationCommandSchema,
    contract.adminPaymentConfigurationResponseSchema,
    "VALIDATE",
    "VALIDATION",
  ),
  "payment-config-publish": operation(
    "/api/v1/admin/payment-configuration/publish",
    contract.adminPaymentConfigurationCommandSchema,
    contract.adminPaymentConfigurationResponseSchema,
    "PUBLISH",
    "MUTATION",
    true,
  ),
  "payment-config-rollback": operation(
    "/api/v1/admin/payment-configuration/rollback",
    contract.adminPaymentConfigurationCommandSchema,
    contract.adminPaymentConfigurationResponseSchema,
    "ROLLBACK",
    "MUTATION",
    true,
  ),
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
  "orders-proof-begin": operation(
    "/api/v1/admin/orders/proof-uploads/begin",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "BEGIN_PROOF_UPLOAD",
    "PROOF_UPLOAD_GRANT",
    true,
  ),
  "orders-proof-complete": operation(
    "/api/v1/admin/orders/proof-uploads/complete",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "COMPLETE_PROOF_UPLOAD",
    "PROOF_UPLOAD",
  ),
  "orders-proofs-attach": operation(
    "/api/v1/admin/orders/proofs/attach",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "ATTACH_PROOFS",
    "MUTATION",
    true,
  ),
  "orders-proofs-withdraw": operation(
    "/api/v1/admin/orders/proofs/withdraw",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "WITHDRAW_PROOF",
    "MUTATION",
    true,
  ),
  "orders-proofs-view": operation(
    "/api/v1/admin/orders/proofs/view",
    contract.adminOrdersCommandSchema,
    contract.adminOrdersResponseSchema,
    "VIEW_PROOF",
    "PROOF_DOWNLOAD",
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
  "management-read-image-source": Object.freeze({
    ...operation(
      "/api/v1/admin/management/images/read",
      contract.managementCenterCommandSchema,
      contract.managementCenterResponseSchema,
      "READ_IMAGE_SOURCE",
      "ORIGINAL_IMAGE",
    ),
    responseMatches(command: unknown, response: unknown) {
      const request = contract.managementCenterCommandSchema.safeParse(command);
      const result =
        contract.managementCenterResponseSchema.safeParse(response);
      if (
        !request.success ||
        request.data.action !== "READ_IMAGE_SOURCE" ||
        !result.success
      )
        return false;
      if (result.data.outcome === "FAILURE") return true;
      if (result.data.kind !== "ORIGINAL_IMAGE") return false;
      const actual = result.data.target,
        expected = request.data.target;
      return (
        actual.kind === expected.kind &&
        actual.id.toLowerCase() === expected.id.toLowerCase() &&
        actual.expectedVersion === expected.expectedVersion
      );
    },
  }),
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
  "management-archive-poster": operation(
    "/api/v1/admin/management/posters/archive",
    contract.managementCenterCommandSchema,
    contract.managementCenterResponseSchema,
    "ARCHIVE_POSTER",
    "POSTER_ARCHIVED",
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
  "account-context": accountOperation("context", "READ", "ACCOUNT"),
  "account-change-password": accountOperation(
    "change-password",
    "CHANGE_PASSWORD",
    "PASSWORD_CHANGED",
  ),
  "account-totp-begin": accountOperation(
    "totp-begin",
    "BEGIN_TOTP",
    "TOTP_ENROLLMENT",
  ),
  "account-totp-confirm": accountOperation(
    "totp-confirm",
    "CONFIRM_TOTP",
    "TOTP_ENABLED",
  ),
  "account-totp-disable": accountOperation(
    "totp-disable",
    "DISABLE_TOTP",
    "TOTP_DISABLED",
  ),
  "account-recovery-codes": accountOperation(
    "recovery-codes",
    "REGENERATE_RECOVERY_CODES",
    "RECOVERY_CODES",
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
