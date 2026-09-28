import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AdminRuntimeConfig } from "@fan-support/config/server";
import {
  adminAccessBeginRequestSchema,
  adminAccessBeginResponseSchema,
  adminAccessBeginBrowserResponseSchema,
  adminAccessCallbackRequestSchema,
  adminAccessCallbackResponseSchema,
  adminAccessLogoutRequestSchema,
  adminAccessLogoutResponseSchema,
  adminOpaqueTokenSchema,
  DEFAULT_LOCALE,
  supportedLocaleSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { readAdminCookies } from "./admin-bff";
import { matchesConfiguredRequestOrigin } from "./request-origin";
import {
  ADMIN_PRIVACY_HEADERS,
  adminError,
  readBoundedJson,
  readBoundedText,
} from "./admin-api-client";

type AccessConfig = Extract<
  AdminRuntimeConfig,
  { mode: "LOCAL_OIDC" | "OIDC" }
>;
function supportsOidc(config: AdminRuntimeConfig): config is AccessConfig {
  return config.mode === "LOCAL_OIDC" || config.mode === "OIDC";
}
type Parser<T> = Readonly<{ parse(value: unknown): T }>;
const LOGIN_COOKIE = "__Host-fan-admin-login";
const LOGIN_LOCALE_COOKIE = "__Host-fan-admin-login-locale";
const LOGIN_COOKIES = [LOGIN_COOKIE, LOGIN_LOCALE_COOKIE] as const;
const SESSION_COOKIE = "__Host-fan-admin-session";
const CSRF_COOKIE = "__Host-fan-admin-csrf";

function cookie(
  name: string,
  value: string,
  maxAge: number,
  expiresAt?: string,
): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=${name === LOGIN_COOKIE || name === LOGIN_LOCALE_COOKIE ? "Lax" : "Strict"}; Max-Age=${maxAge}${expiresAt ? `; Expires=${new Date(expiresAt).toUTCString()}` : ""}`;
}
function clearCookie(name: string): string {
  return cookie(name, "", 0, "1970-01-01T00:00:00Z");
}
function redirect(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ ...ADMIN_PRIVACY_HEADERS, location });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status: 303, headers });
}
function cookieValue(header: string | null, name: string): string | undefined {
  if (!header || header.length > 8192) return undefined;
  let value: string | undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) return undefined;
    if (part.slice(0, separator).trim() !== name) continue;
    if (value !== undefined) return undefined;
    value = part.slice(separator + 1).trim();
  }
  return value;
}
function loginBinding(header: string | null): string | undefined {
  const parsed = adminOpaqueTokenSchema.safeParse(
    cookieValue(header, LOGIN_COOKIE),
  );
  return parsed.success ? parsed.data : undefined;
}
/** Non-authority hint: it can only select a supported failure-page language. */
function loginLocale(header: string | null, now: number): SupportedLocale {
  const parts = cookieValue(header, LOGIN_LOCALE_COOKIE)?.split(".");
  if (!parts || parts.length !== 2) return DEFAULT_LOCALE;
  const locale = supportedLocaleSchema.safeParse(parts[0]);
  const deadline = Number(parts[1]);
  return locale.success &&
    Number.isSafeInteger(deadline) &&
    String(deadline) === parts[1] &&
    deadline > now &&
    deadline <= now + 600_000
    ? locale.data
    : DEFAULT_LOCALE;
}
function maxAge(expiresAt: string, now: number, limit: number): number {
  const remaining = Math.ceil((Date.parse(expiresAt) - now) / 1000);
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > limit)
    throw new Error("Invalid credential lifetime");
  return remaining;
}

/** Only this server-side boundary handles credential-bearing identity responses. */
export function createAdminAccessBff(
  options: Readonly<{
    config: AdminRuntimeConfig;
    fetch?: typeof fetch;
    now?: () => number;
  }>,
) {
  const now = options.now ?? Date.now;
  function boundary(
    request: Request,
    action: "begin" | "callback" | "logout",
  ): Response | undefined {
    if (!supportsOidc(options.config)) return adminError("NOT_FOUND", 404);
    let headerBytes = 0;
    request.headers.forEach((value, key) => {
      headerBytes += value.length + key.length;
    });
    if (request.url.length > 8192 || headerBytes > 16384)
      return adminError("INVALID_COMMAND", 400);
    const url = new URL(request.url);
    if (!matchesConfiguredRequestOrigin(request, options.config.siteOrigin))
      return adminError("FORBIDDEN", 403);
    if (
      url.pathname !== `/api/admin/auth/${action}` ||
      request.method !== (action === "callback" ? "GET" : "POST")
    )
      return adminError("NOT_FOUND", 404);
    if (action !== "callback") {
      if (url.search) return adminError("INVALID_COMMAND", 400);
      if (
        request.headers.get("origin") !== options.config.siteOrigin ||
        request.headers.get("sec-fetch-site") !== "same-origin"
      )
        return adminError("FORBIDDEN", 403);
    }
    return undefined;
  }
  async function call<T extends { outcome: string }>(
    config: AccessConfig,
    action: string,
    command: unknown,
    parser: Parser<T>,
  ): Promise<{ value: T; status: number }> {
    const response = await (options.fetch ?? fetch)(
      `${config.internalApiOrigin}/api/v1/admin/access/${action}`,
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
      throw new Error("Invalid access response");
    const value = parser.parse(await readBoundedJson(response.body, 16 * 1024));
    if (
      value.outcome === "SUCCESS"
        ? response.status !== 200
        : ![400, 401, 403, 409, 429, 503].includes(response.status)
    )
      throw new Error("Invalid access status");
    return { value, status: response.status };
  }
  const envelope = () => ({ schemaVersion: 1, requestId: randomUUID() });
  function failedLogin(config: AccessConfig, request: Request): Response {
    const locale = loginLocale(request.headers.get("cookie"), now());
    return redirect(
      `${config.siteOrigin}/${locale}?login=failed`,
      LOGIN_COOKIES.map(clearCookie),
    );
  }
  function failedBegin(): Response {
    const response = adminError("ACCESS_UNAVAILABLE", 503);
    for (const name of LOGIN_COOKIES)
      response.headers.append("set-cookie", clearCookie(name));
    return response;
  }
  return Object.freeze({
    async begin(request: Request): Promise<Response> {
      const rejected = boundary(request, "begin");
      if (rejected) return rejected;
      const config = options.config;
      if (!supportsOidc(config)) return adminError("NOT_FOUND", 404);
      if (
        !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/iu.test(
          request.headers.get("content-type") ?? "",
        )
      )
        return adminError("INVALID_COMMAND", 400);
      let command;
      try {
        const form = new URLSearchParams(
          await readBoundedText(request.body, 4096),
        );
        if ([...form.keys()].length !== 1 || !form.has("locale"))
          return adminError("INVALID_COMMAND", 400);
        command = adminAccessBeginRequestSchema.parse({
          ...envelope(),
          locale: form.get("locale"),
        });
      } catch (error) {
        return adminError(
          "INVALID_COMMAND",
          error instanceof RangeError ? 413 : 400,
        );
      }
      try {
        const { value } = await call(
          config,
          "begin",
          command,
          adminAccessBeginResponseSchema,
        );
        if (value.outcome !== "SUCCESS") return failedBegin();
        const headers = new Headers(ADMIN_PRIVACY_HEADERS);
        const ttl = maxAge(value.expiresAt, now(), 600);
        headers.append(
          "set-cookie",
          cookie(LOGIN_COOKIE, value.browserToken, ttl, value.expiresAt),
        );
        headers.append(
          "set-cookie",
          cookie(
            LOGIN_LOCALE_COOKIE,
            `${command.locale}.${Date.parse(value.expiresAt)}`,
            ttl,
            value.expiresAt,
          ),
        );
        return Response.json(
          adminAccessBeginBrowserResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "LOGIN_REDIRECT",
            authorizationUrl: value.authorizationUrl,
          }),
          { headers },
        );
      } catch {
        return failedBegin();
      }
    },
    async callback(request: Request): Promise<Response> {
      const rejected = boundary(request, "callback");
      if (rejected) return rejected;
      const config = options.config;
      if (!supportsOidc(config)) return adminError("NOT_FOUND", 404);
      try {
        const query = new URL(request.url).searchParams;
        for (const key of query.keys())
          if (
            !["code", "state", "iss"].includes(key) ||
            query.getAll(key).length !== 1
          )
            return failedLogin(config, request);
        if (query.has("iss") && query.get("iss") !== config.oidcIssuer)
          return failedLogin(config, request);
        const command = adminAccessCallbackRequestSchema.parse({
          ...envelope(),
          browserToken: loginBinding(request.headers.get("cookie")),
          state: query.get("state"),
          code: query.get("code"),
        });
        const { value } = await call(
          config,
          "callback",
          command,
          adminAccessCallbackResponseSchema,
        );
        if (value.outcome !== "SUCCESS") return failedLogin(config, request);
        const ttl = maxAge(value.expiresAt, now(), 28_800);
        return redirect(`${config.siteOrigin}/${value.locale}`, [
          cookie(SESSION_COOKIE, value.sessionToken, ttl, value.expiresAt),
          cookie(CSRF_COOKIE, value.csrfToken, ttl, value.expiresAt),
          ...LOGIN_COOKIES.map(clearCookie),
        ]);
      } catch {
        return failedLogin(config, request);
      }
    },
    async logout(request: Request): Promise<Response> {
      const rejected = boundary(request, "logout");
      if (rejected) return rejected;
      const config = options.config;
      if (!supportsOidc(config)) return adminError("NOT_FOUND", 404);
      if (
        !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
          request.headers.get("content-type") ?? "",
        )
      )
        return adminError("INVALID_COMMAND", 400);
      const credentials = readAdminCookies(request.headers.get("cookie"));
      if (!credentials) return adminError("UNAUTHENTICATED", 401);
      const csrf = adminOpaqueTokenSchema.safeParse(
        request.headers.get("x-csrf-token"),
      );
      if (
        !csrf.success ||
        !timingSafeEqual(
          Buffer.from(csrf.data),
          Buffer.from(credentials.csrfToken),
        )
      )
        return adminError("CSRF_INVALID", 403);
      try {
        const body = await readBoundedJson(request.body, 64);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).length !== 1 ||
          !("schemaVersion" in body) ||
          body.schemaVersion !== 1
        )
          return adminError("INVALID_COMMAND", 400);
      } catch (error) {
        return adminError(
          "INVALID_COMMAND",
          error instanceof RangeError ? 413 : 400,
        );
      }
      try {
        const command = adminAccessLogoutRequestSchema.parse({
          ...envelope(),
          ...credentials,
          revokeAll: false,
        });
        const { value, status } = await call(
          config,
          "logout",
          command,
          adminAccessLogoutResponseSchema,
        );
        const headers = new Headers(ADMIN_PRIVACY_HEADERS);
        if (value.outcome === "SUCCESS")
          for (const name of [SESSION_COOKIE, CSRF_COOKIE, ...LOGIN_COOKIES])
            headers.append("set-cookie", clearCookie(name));
        return Response.json(value, { status, headers });
      } catch {
        return adminError("ACCESS_UNAVAILABLE", 503);
      }
    },
  });
}
