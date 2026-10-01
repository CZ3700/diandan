import "server-only";
import { randomUUID } from "node:crypto";
import type { AdminRuntimeConfig } from "@fan-support/config/server";
import type { AdminOperation } from "./admin-operations";

export type AdminCredentials = Readonly<{
  sessionToken: string;
  csrfToken: string;
}>;
export const ADMIN_PRIVACY_HEADERS = Object.freeze({
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});
export function adminError(code: string, status: number): Response {
  return Response.json(
    { schemaVersion: 1, outcome: "FAILURE", code },
    { status, headers: ADMIN_PRIVACY_HEADERS },
  );
}
export async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<string> {
  if (!body) throw new Error("Invalid JSON");
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0,
    text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RangeError("Body limit exceeded");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
export async function readBoundedJson(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<unknown> {
  return JSON.parse(await readBoundedText(body, limit)) as unknown;
}
export async function callAdminApi(
  options: Readonly<{
    config: Exclude<AdminRuntimeConfig, { mode: "DISABLED" }>;
    operation: AdminOperation;
    credentials: AdminCredentials;
    command: unknown;
    fetch?: typeof fetch;
    idempotencyKey?: string;
  }>,
): Promise<Response> {
  const { config, operation, credentials } = options;
  const headers = new Headers({
    "content-type": "application/json",
    origin: config.siteOrigin,
    "x-request-id": randomUUID(),
  });
  if (operation.credentials === "SESSION") {
    headers.set(
      "cookie",
      `__Host-fan-admin-session=${credentials.sessionToken}`,
    );
    headers.set("x-csrf-token", credentials.csrfToken);
  }
  if (options.idempotencyKey !== undefined)
    headers.set("idempotency-key", options.idempotencyKey);
  try {
    const response = await (options.fetch ?? fetch)(
      `${config.internalApiOrigin}${operation.path}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(operation.apiBody(options.command)),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    // Older local API compositions may omit a discovery capability. A real 404 at
    // this discovery endpoint is distinct from an unavailable service.
    if (
      [
        "/api/v1/admin/orders/context",
        "/api/v1/admin/ledger/context",
        "/api/v1/admin/artist-notes/context",
        "/api/v1/admin/exceptions/context",
        "/api/v1/admin/account/context",
        "/api/v1/admin/staff/context",
      ].includes(operation.path) &&
      response.status === 404
    ) {
      await response.body?.cancel();
      return adminError("NOT_FOUND", 404);
    }
    if (
      !/^application\/json(?:;|$)/iu.test(
        response.headers.get("content-type") ?? "",
      )
    )
      return adminError("CONTENT_UNAVAILABLE", 503);
    const value = operation.parseResponse(
      await readBoundedJson(response.body, 16 * 1024 * 1024),
    ) as { outcome: string; code?: string };
    if (
      operation.responseMatches &&
      !operation.responseMatches(options.command, value)
    )
      return adminError("CONTENT_UNAVAILABLE", 503);
    if (
      value.outcome === "SUCCESS"
        ? response.status !== 200
        : ![400, 401, 403, 404, 409, 413, 429, 503].includes(response.status)
    )
      return adminError("CONTENT_UNAVAILABLE", 503);
    return Response.json(value, {
      status: response.status,
      headers: ADMIN_PRIVACY_HEADERS,
    });
  } catch {
    return adminError("CONTENT_UNAVAILABLE", 503);
  }
}
