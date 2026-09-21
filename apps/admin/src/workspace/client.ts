"use client";
import { useEffect, useRef, useState } from "react";
import {
  adminSessionBootstrapResponseSchema,
  adminAccessLogoutResponseSchema,
  adminAccessBeginBrowserResponseSchema,
  type AdminSessionBootstrapResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import { createMutationKeys } from "./state";

type Parser<T> = { parse(value: unknown): T };
type Success<T> = Extract<T, { outcome: "SUCCESS" }>;
export class AdminClientError extends Error {
  constructor(
    readonly code: string,
    readonly issues: readonly {
      path: readonly (string | number)[];
      code: string;
      locale?: string;
    }[] = [],
  ) {
    super(code);
  }
}
export function createAdminClient(
  csrf: () => string | null,
  onExpired: () => void,
  transport: typeof fetch = fetch,
) {
  const keys = createMutationKeys();
  return {
    clear() {
      keys.clear();
    },
    async call<T>(
      operation: string,
      command: Readonly<Record<string, unknown>>,
      schema: Parser<T>,
      mutation = false,
      explicitMutationKey?: string,
    ): Promise<Success<T>> {
      const token = csrf();
      if (!token) throw new AdminClientError("UNAUTHENTICATED");
      const body = Object.fromEntries(
        Object.entries(command).filter(
          ([key]) =>
            key !== "idempotencyKey" &&
            (key !== "action" || operation === "publication-preflight"),
        ),
      );
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-CSRF-Token": token,
      };
      if (mutation)
        headers["Idempotency-Key"] =
          explicitMutationKey ?? keys.forCommand(operation, body);
      let response: Response;
      try {
        response = await transport(`/api/admin/${operation}`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          headers,
          body: JSON.stringify(body),
        });
      } catch {
        throw new AdminClientError("NETWORK_ERROR");
      }
      if (response.status === 401) onExpired();
      let result: T;
      try {
        result = schema.parse(await response.json());
      } catch {
        throw new AdminClientError("INVALID_RESPONSE");
      }
      const envelope = result as {
        outcome?: string;
        code?: string;
        issues?: AdminClientError["issues"];
      };
      if (envelope.outcome !== "SUCCESS") {
        if (
          envelope.code === "UNAUTHENTICATED" ||
          envelope.code === "SESSION_EXPIRED"
        )
          onExpired();
        throw new AdminClientError(
          envelope.code ?? "UNEXPECTED_FAILURE",
          envelope.issues,
        );
      }
      if (mutation && explicitMutationKey === undefined)
        keys.succeeded(operation, body);
      return result as Success<T>;
    },
  };
}
export type AdminClient = ReturnType<typeof createAdminClient>;
export type AdminSession = Extract<
  AdminSessionBootstrapResponse,
  { outcome: "SUCCESS" }
>;
export async function requestAdminLogin(
  locale: SupportedLocale,
  transport: typeof fetch = fetch,
): Promise<string> {
  try {
    const response = await transport("/api/admin/auth/begin", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ locale }).toString(),
    });
    const result = adminAccessBeginBrowserResponseSchema.parse(
      await response.json(),
    );
    if (response.status !== 200 || result.outcome !== "SUCCESS")
      throw new Error("Unconfirmed login start");
    return result.authorizationUrl;
  } catch {
    throw new AdminClientError("ACCESS_UNAVAILABLE");
  }
}
export async function requestAdminLogout(
  csrfToken: string,
  transport: typeof fetch = fetch,
): Promise<void> {
  try {
    const response = await transport("/api/admin/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ schemaVersion: 1 }),
    });
    const result = adminAccessLogoutResponseSchema.parse(await response.json());
    if (response.status !== 200 || result.outcome !== "SUCCESS")
      throw new Error("Unconfirmed logout");
  } catch {
    throw new AdminClientError("ACCESS_UNAVAILABLE");
  }
}
export async function readAdminSession(
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<AdminSession | null> {
  try {
    const response = await transport("/api/admin/session", {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
    });
    const result = adminSessionBootstrapResponseSchema.parse(
      await response.json(),
    );
    if (response.status === 200 && result.outcome === "SUCCESS") return result;
    if (
      [401, 403].includes(response.status) &&
      result.outcome === "FAILURE" &&
      ["UNAUTHENTICATED", "CSRF_INVALID"].includes(result.code)
    )
      return null;
    throw new Error("Unconfirmed session");
  } catch {
    throw new AdminClientError("ACCESS_UNAVAILABLE");
  }
}
export function useAdminSession() {
  const secret = useRef<string | null>(null);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [expired, setExpired] = useState(false);
  const [retry, setRetry] = useState(0);
  const [client] = useState<AdminClient>(() =>
    createAdminClient(
      () => secret.current,
      () => {
        secret.current = null;
        setSession(null);
        setExpired(true);
        client.clear();
      },
    ),
  );
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setUnavailable(false);
    secret.current = null;
    setSession(null);
    client.clear();
    void readAdminSession(abort.signal)
      .then((result) => {
        if (!abort.signal.aborted && result !== null) {
          secret.current = result.csrfToken;
          setSession(result);
          setExpired(false);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setUnavailable(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      secret.current = null;
      client.clear();
    };
  }, [retry, client]);
  return {
    client,
    session,
    loading,
    unavailable,
    expired,
    logout: async () => {
      if (!secret.current) throw new AdminClientError("ACCESS_UNAVAILABLE");
      await requestAdminLogout(secret.current);
      secret.current = null;
      client.clear();
      setSession(null);
      setExpired(false);
      setUnavailable(false);
    },
    reload: () => setRetry((value) => value + 1),
  };
}
