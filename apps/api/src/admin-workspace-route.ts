import type { FastifyInstance } from "fastify";
import * as contract from "@fan-support/contracts";
import {
  registerPrivateAdminEndpoint,
  registerPreviewAdminEndpoint,
} from "./admin-workspace-transport.js";
type Parser = Readonly<{ parse(input: unknown): unknown }>;
type Dependencies<Response> = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<Response> }>;
}>;
export type AdminCatalogRouteDependencies =
  Dependencies<contract.AdminCatalogResponse>;
export type TranslationWorkspaceRouteDependencies =
  Dependencies<contract.TranslationWorkspaceResponse>;
export type TranslationTransferRouteDependencies =
  Dependencies<contract.TranslationTransferResponse>;
export type AdminPreviewMediaRouteDependencies =
  Dependencies<contract.AdminPreviewMediaResponse>;
function readCommand(
  body: unknown,
  action: string,
  parser: Parser,
  key?: string,
  mutation = false,
): unknown {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    [
      "action",
      "idempotencyKey",
      "requestId",
      "actorId",
      "sessionToken",
      "csrfToken",
    ].some((field) => Object.hasOwn(body, field))
  )
    throw new Error("Invalid administrative body");
  return parser.parse({
    ...body,
    action,
    ...(mutation ? { idempotencyKey: key } : {}),
  });
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "string" && /^[a-f0-9-]{36}$/iu.test(item)
      ? item.toLowerCase()
      : item,
  );
}
function result(
  input: unknown,
  parser: Parser,
  expectedKind: string,
): Record<string, unknown> {
  const response = parser.parse(input) as Record<string, unknown>;
  if (response["outcome"] === "SUCCESS" && response["kind"] !== expectedKind)
    throw new Error("Invalid administrative response");
  return response;
}
export function registerAdminCatalogRoute(
  instance: FastifyInstance,
  options: AdminCatalogRouteDependencies,
): void {
  const routes = [
    ["owners/list", "LIST_OWNERS", "OWNERS", false],
    ["owners/read", "READ_OWNER", "OWNER", false],
    ["history/read", "READ_HISTORY", "HISTORY", false],
    ["idols/create", "CREATE_IDOL", "MUTATION", true],
    ["idols/rename", "RENAME_IDOL", "MUTATION", true],
    ["idols/status", "SET_IDOL_STATUS", "MUTATION", true],
  ] as const;
  for (const [path, action, kind, mutation] of routes)
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/catalog/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 64 * 1024,
      parseRequest: (body, envelope, key) =>
        contract.adminCatalogRequestSchema.parse({
          ...envelope,
          command: readCommand(
            body,
            action,
            contract.adminCatalogCommandSchema,
            key,
            mutation,
          ),
        }),
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const response = contract.adminCatalogResponseSchema.parse(
          result(input, contract.adminCatalogResponseSchema, kind),
        );
        const command =
          contract.adminCatalogRequestSchema.parse(request).command;
        if (response.outcome === "SUCCESS") {
          if (
            response.kind === "OWNER" &&
            command.action === "READ_OWNER" &&
            canonical(response.owner.target) !== canonical(command.target)
          )
            throw new Error("Owner mismatch");
          if (
            (response.kind === "OWNERS" || response.kind === "HISTORY") &&
            (command.action === "LIST_OWNERS" ||
              command.action === "READ_HISTORY") &&
            (response.page !== command.page ||
              response.pageSize !== command.pageSize)
          )
            throw new Error("Pagination mismatch");
          if (
            response.kind === "OWNERS" &&
            command.action === "LIST_OWNERS" &&
            response.items.some(
              (owner) =>
                owner.target.kind !== command.kind ||
                owner.locale !== command.locale,
            )
          )
            throw new Error("Directory mismatch");
        }
        return response;
      },
    });
}
export function registerTranslationWorkspaceRoute(
  instance: FastifyInstance,
  options: TranslationWorkspaceRouteDependencies,
): void {
  registerPrivateAdminEndpoint(instance, {
    path: "/api/v1/admin/translation-workspace/read",
    allowedOrigin: options.allowedOrigin,
    bodyLimit: 64 * 1024,
    parseRequest: (body, envelope) =>
      contract.translationWorkspaceRequestSchema.parse({
        ...envelope,
        command: readCommand(
          body,
          "READ",
          contract.translationWorkspaceCommandSchema,
        ),
      }),
    execute: (input) => options.useCases.execute(input),
    parseResponse(input, request) {
      const response = contract.translationWorkspaceResponseSchema.parse(input),
        command =
          contract.translationWorkspaceRequestSchema.parse(request).command;
      if (
        response.outcome === "SUCCESS" &&
        canonical(response.target) !== canonical(command.target)
      )
        throw new Error("Workspace mismatch");
      return response;
    },
  });
}
export function registerTranslationTransferRoute(
  instance: FastifyInstance,
  options: TranslationTransferRouteDependencies,
): void {
  for (const action of ["EXPORT", "IMPORT"] as const)
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/translation-transfer/${action.toLowerCase()}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 16 * 1024 * 1024,
      parseRequest: (body, envelope, key) =>
        contract.translationTransferRequestSchema.parse({
          ...envelope,
          command: readCommand(
            body,
            action,
            contract.translationTransferCommandSchema,
            key,
            true,
          ),
        }),
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const response = contract.translationTransferResponseSchema.parse(
          result(
            input,
            contract.translationTransferResponseSchema,
            action === "EXPORT" ? "TRANSLATION_EXPORT" : "MUTATION",
          ),
        );
        const command =
          contract.translationTransferRequestSchema.parse(request).command;
        if (
          response.outcome === "SUCCESS" &&
          response.kind === "TRANSLATION_EXPORT" &&
          command.action === "EXPORT" &&
          canonical(response.package.target) !== canonical(command.target)
        )
          throw new Error("Transfer mismatch");
        return response;
      },
    });
}
export function registerAdminPreviewMediaRoute(
  instance: FastifyInstance,
  options: AdminPreviewMediaRouteDependencies,
): void {
  registerPreviewAdminEndpoint(instance, {
    path: "/api/v1/admin-preview-media/read",
    allowedOrigin: options.allowedOrigin,
    parseRequest: (input) =>
      contract.adminPreviewMediaRequestSchema.parse(input),
    execute: (input) => options.useCases.execute(input),
    parseResponse(input, request) {
      const response = contract.adminPreviewMediaResponseSchema.parse(input),
        command = contract.adminPreviewMediaRequestSchema.parse(request);
      if (
        response.outcome === "SUCCESS" &&
        canonical(response.target) !== canonical(command.target)
      )
        throw new Error("Preview mismatch");
      return response;
    },
  });
}
