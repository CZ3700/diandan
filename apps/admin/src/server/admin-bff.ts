import "server-only";
import { timingSafeEqual } from "node:crypto";
import {
  adminOpaqueTokenSchema,
  adminSessionBootstrapResponseSchema,
} from "@fan-support/contracts";
import type { AdminRuntimeConfig } from "@fan-support/config/server";
import {
  ADMIN_PRIVACY_HEADERS,
  adminError,
  callAdminApi,
  readBoundedJson,
  type AdminCredentials,
} from "./admin-api-client";
import { getAdminOperation } from "./admin-operations";

export function readAdminCookies(
  header: string | null,
): AdminCredentials | undefined {
  if (!header) return undefined;
  const values = new Map<string, string>();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) return undefined;
    const key = part.slice(0, separator).trim();
    if (key !== "__Host-fan-admin-session" && key !== "__Host-fan-admin-csrf")
      continue;
    if (values.has(key)) return undefined;
    values.set(key, part.slice(separator + 1).trim());
  }
  const session = adminOpaqueTokenSchema.safeParse(
    values.get("__Host-fan-admin-session"),
  );
  const csrf = adminOpaqueTokenSchema.safeParse(
    values.get("__Host-fan-admin-csrf"),
  );
  return session.success && csrf.success
    ? { sessionToken: session.data, csrfToken: csrf.data }
    : undefined;
}
function sameToken(left: string | null, right: string): boolean {
  const parsed = adminOpaqueTokenSchema.safeParse(left);
  if (!parsed.success) return false;
  const a = Buffer.from(parsed.data),
    b = Buffer.from(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
export function createAdminBff(
  options: Readonly<{ config: AdminRuntimeConfig; fetch?: typeof fetch }>,
) {
  function boundary(request: Request, bootstrap = false): Response | undefined {
    if (options.config.mode !== "TEST") return adminError("NOT_FOUND", 404);
    const url = new URL(request.url);
    if (url.search) return adminError("INVALID_COMMAND", 400);
    if (url.origin !== options.config.siteOrigin)
      return adminError("FORBIDDEN", 403);
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (bootstrap) {
      if (
        site !== "same-origin" ||
        (origin !== null && origin !== options.config.siteOrigin)
      )
        return adminError("FORBIDDEN", 403);
    } else if (
      origin !== options.config.siteOrigin ||
      (site !== null && site !== "same-origin")
    )
      return adminError("FORBIDDEN", 403);
    return undefined;
  }
  return Object.freeze({
    async session(request: Request): Promise<Response> {
      const rejected = boundary(request, true);
      if (rejected) return rejected;
      if (request.method !== "GET") return adminError("NOT_FOUND", 404);
      const credentials = readAdminCookies(request.headers.get("cookie"));
      if (!credentials) return adminError("UNAUTHENTICATED", 401);
      const operation = getAdminOperation("session")!;
      if (options.config.mode !== "TEST") return adminError("NOT_FOUND", 404);
      const response = await callAdminApi({
        config: options.config,
        operation,
        credentials,
        command: operation.parseCommand({ schemaVersion: 1 }),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
      if (response.status !== 200) return response;
      try {
        const value = adminSessionBootstrapResponseSchema.parse({
          ...(await response.json()),
          csrfToken: credentials.csrfToken,
        });
        return Response.json(value, { headers: ADMIN_PRIVACY_HEADERS });
      } catch {
        return adminError("CONTENT_UNAVAILABLE", 503);
      }
    },
    async operation(request: Request, key: string): Promise<Response> {
      const rejected = boundary(request);
      if (rejected) return rejected;
      const operation = key === "session" ? undefined : getAdminOperation(key);
      if (!operation || request.method !== "POST")
        return adminError("NOT_FOUND", 404);
      const credentials = readAdminCookies(request.headers.get("cookie"));
      if (!credentials) return adminError("UNAUTHENTICATED", 401);
      if (
        !sameToken(request.headers.get("x-csrf-token"), credentials.csrfToken)
      )
        return adminError("CSRF_INVALID", 403);
      if (
        !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
          request.headers.get("content-type") ?? "",
        )
      )
        return adminError("INVALID_COMMAND", 400);
      const idempotencyKey =
        request.headers.get("idempotency-key") ?? undefined;
      let command: unknown;
      try {
        command = operation.parseCommand(
          await readBoundedJson(request.body, operation.bodyLimit),
          idempotencyKey,
        );
      } catch (error) {
        return adminError(
          "INVALID_COMMAND",
          error instanceof RangeError ? 413 : 400,
        );
      }
      if (options.config.mode !== "TEST") return adminError("NOT_FOUND", 404);
      return callAdminApi({
        config: options.config,
        operation,
        credentials,
        command,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    },
  });
}
