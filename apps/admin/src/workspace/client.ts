"use client";
import { useEffect, useRef, useState } from "react";
import {
  adminSessionBootstrapResponseSchema,
  type AdminSessionBootstrapResponse,
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
        headers["Idempotency-Key"] = keys.forCommand(operation, body);
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
      if (mutation) keys.succeeded(operation, body);
      return result as Success<T>;
    },
  };
}
export type AdminClient = ReturnType<typeof createAdminClient>;
export type AdminSession = Extract<
  AdminSessionBootstrapResponse,
  { outcome: "SUCCESS" }
>;
export function useAdminSession() {
  const secret = useRef<string | null>(null);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [client] = useState(() =>
    createAdminClient(
      () => secret.current,
      () => {
        secret.current = null;
        setSession(null);
      },
    ),
  );
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    secret.current = null;
    setSession(null);
    client.clear();
    void fetch("/api/admin/session", {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((value: unknown) => {
        const result = adminSessionBootstrapResponseSchema.parse(value);
        if (!abort.signal.aborted && result.outcome === "SUCCESS") {
          secret.current = result.csrfToken;
          setSession(result);
        }
      })
      .catch(() => {
        /* Authentication details are deliberately not reflected into the UI. */
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
    reload: () => setRetry((value) => value + 1),
  };
}
