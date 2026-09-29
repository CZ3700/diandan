import "server-only";
import { randomUUID } from "node:crypto";
import type { AdminRuntimeConfig } from "@fan-support/config/server";
import {
  adminLocalAccessBrowserResponseSchema,
  adminLocalAccessResponseSchema,
  adminLocalLoginBrowserRequestSchema,
  adminLocalLoginRequestSchema,
  adminLocalStepBrowserRequestSchema,
  adminLocalStepRequestSchema,
  adminOpaqueTokenSchema,
  type AdminLocalAccessResponse,
} from "@fan-support/contracts";
import {
  ADMIN_PRIVACY_HEADERS,
  adminError,
  readBoundedJson,
} from "./admin-api-client";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  cookie,
  cookieValue,
  maxAge,
} from "./admin-access-bff";
import { matchesConfiguredRequestOrigin } from "./request-origin";

// ADR-021 / L3-10 ④: built-in sign-in. Passwords pass through once; tokens never reach JavaScript.
type LocalConfig = Extract<AdminRuntimeConfig, { mode: "LOCAL_ACCOUNT" }>;
const CHALLENGE_COOKIE = "__Host-fan-admin-local-login";
/** Failures after which the stored challenge can never succeed. */
const ENDING = new Set(["LOGIN_RESTART_REQUIRED", "ACCOUNT_LOCKED"]);

export function createAdminLocalAuthBff(
  options: Readonly<{
    config: AdminRuntimeConfig;
    fetch?: typeof fetch;
    now?: () => number;
  }>,
) {
  const now = options.now ?? Date.now;
  function boundary(
    request: Request,
    action: "login" | "step",
  ): Response | LocalConfig {
    const config = options.config;
    if (config.mode !== "LOCAL_ACCOUNT") return adminError("NOT_FOUND", 404);
    let headerBytes = 0;
    request.headers.forEach((value, key) => {
      headerBytes += value.length + key.length;
    });
    if (request.url.length > 8192 || headerBytes > 16384)
      return adminError("INVALID_COMMAND", 400);
    const url = new URL(request.url);
    if (!matchesConfiguredRequestOrigin(request, config.siteOrigin))
      return adminError("FORBIDDEN", 403);
    if (
      url.pathname !== `/api/admin/local-auth/${action}` ||
      request.method !== "POST"
    )
      return adminError("NOT_FOUND", 404);
    if (url.search) return adminError("INVALID_COMMAND", 400);
    if (
      request.headers.get("origin") !== config.siteOrigin ||
      request.headers.get("sec-fetch-site") !== "same-origin"
    )
      return adminError("FORBIDDEN", 403);
    if (
      !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
        request.headers.get("content-type") ?? "",
      )
    )
      return adminError("INVALID_COMMAND", 400);
    return config;
  }
  async function call(
    config: LocalConfig,
    action: "login" | "step",
    command: unknown,
  ): Promise<{ value: AdminLocalAccessResponse; status: number }> {
    const response = await (options.fetch ?? fetch)(
      `${config.internalApiOrigin}/api/v1/admin/local-access/${action}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: config.siteOrigin,
          "x-admin-access-key": config.adminAccessKey,
        },
        body: JSON.stringify(command),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (
      !/^application\/json(?:;|$)/iu.test(
        response.headers.get("content-type") ?? "",
      )
    )
      throw new Error("Invalid sign-in response");
    const value = adminLocalAccessResponseSchema.parse(
      await readBoundedJson(response.body, 16 * 1024),
    );
    if (
      value.outcome === "SUCCESS"
        ? response.status !== 200
        : ![400, 401, 403, 409, 429, 503].includes(response.status)
    )
      throw new Error("Invalid sign-in status");
    return { value, status: response.status };
  }
  function present(value: AdminLocalAccessResponse, status: number): Response {
    const headers = new Headers(ADMIN_PRIVACY_HEADERS);
    if (value.outcome === "FAILURE") {
      if (ENDING.has(value.code))
        headers.append("set-cookie", clearCookie(CHALLENGE_COOKIE));
      return Response.json(adminLocalAccessBrowserResponseSchema.parse(value), {
        status,
        headers,
      });
    }
    if (value.kind === "SESSION_CREATED") {
      const ttl = maxAge(value.expiresAt, now(), 28_800);
      headers.append(
        "set-cookie",
        cookie(SESSION_COOKIE, value.sessionToken, ttl, value.expiresAt),
      );
      headers.append(
        "set-cookie",
        cookie(CSRF_COOKIE, value.csrfToken, ttl, value.expiresAt),
      );
      headers.append("set-cookie", clearCookie(CHALLENGE_COOKIE));
      return Response.json(
        adminLocalAccessBrowserResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "SIGNED_IN",
          locale: value.locale,
        }),
        { headers },
      );
    }
    const ttl = maxAge(value.expiresAt, now(), 300);
    headers.append(
      "set-cookie",
      cookie(CHALLENGE_COOKIE, value.challengeToken, ttl, value.expiresAt),
    );
    return Response.json(
      adminLocalAccessBrowserResponseSchema.parse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STEP_REQUIRED",
        step: value.step,
      }),
      { headers },
    );
  }
  async function run(
    request: Request,
    action: "login" | "step",
    build: (body: unknown, cookies: string | null) => unknown,
  ): Promise<Response> {
    const config = boundary(request, action);
    if (config instanceof Response) return config;
    let command: unknown;
    try {
      command = build(
        await readBoundedJson(request.body, 4096),
        request.headers.get("cookie"),
      );
    } catch (error) {
      return adminError(
        "INVALID_COMMAND",
        error instanceof RangeError ? 413 : 400,
      );
    }
    if (command === undefined)
      return present(
        {
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "LOGIN_RESTART_REQUIRED",
        },
        403,
      );
    try {
      const { value, status } = await call(config, action, command);
      return present(value, status);
    } catch {
      return adminError("ACCESS_UNAVAILABLE", 503);
    }
  }
  return Object.freeze({
    login: (request: Request) =>
      run(request, "login", (body) =>
        adminLocalLoginRequestSchema.parse({
          ...adminLocalLoginBrowserRequestSchema.parse(body),
          requestId: randomUUID(),
        }),
      ),
    step: (request: Request) =>
      run(request, "step", (body, cookies) => {
        const { step } = adminLocalStepBrowserRequestSchema.parse(body);
        const challenge = adminOpaqueTokenSchema.safeParse(
          cookieValue(cookies, CHALLENGE_COOKIE),
        );
        if (!challenge.success) return undefined;
        return adminLocalStepRequestSchema.parse({
          schemaVersion: 1,
          requestId: randomUUID(),
          challengeToken: challenge.data,
          step,
        });
      }),
  });
}
