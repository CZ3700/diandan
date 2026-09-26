import type { PaymentAccountConnection } from "@fan-support/contracts";
import type {
  PaymentCredentialResolver,
  PaymentPortError,
} from "@fan-support/payment-port";

import {
  airwallexLoginSchema,
  parseAirwallexTimestamp,
} from "./airwallex-objects.js";
import {
  apiOriginOf,
  resolveAirwallexApiCredentials,
  type AirwallexApiCredentials,
} from "./connection.js";
import {
  AirwallexTransportError,
  type AirwallexTransport,
} from "./transport.js";

export class AirwallexRejection extends Error {
  public constructor(public readonly code: PaymentPortError["code"]) {
    super("Airwallex operation rejected");
  }
}

/** Access tokens live 30 minutes; renewing a minute early keeps in-flight calls valid. */
const TOKEN_LIFETIME_MS = 1_800_000;
const RENEW_MARGIN_MS = 60_000;

type Cached = Readonly<{ key: string; token: string; expiresAt: number }>;

export type AirwallexSession = Readonly<{
  /** Resolves the current credentials and returns a bearer token for them. */
  token(timeoutMs: number): Promise<string>;
  /** Forgets a token Airwallex rejected, so the next call logs in again. */
  invalidate(token: string): void;
}>;

/**
 * Tokens stay in process memory only. Logging in never mutates payments, so every failure
 * here is retryable or a configuration problem, never an unknown payment outcome.
 */
export function createAirwallexSession(
  options: Readonly<{
    connection: PaymentAccountConnection;
    credentials: PaymentCredentialResolver;
    transport: AirwallexTransport;
    now: () => Date;
  }>,
): AirwallexSession {
  let cached: Cached | undefined;
  const pending = new Map<string, Promise<Cached>>();

  async function login(
    key: string,
    credentials: AirwallexApiCredentials,
    timeoutMs: number,
  ): Promise<Cached> {
    const startedAt = options.now().getTime();
    let status: number;
    let body: unknown;
    try {
      ({ status, body } = await options.transport(
        apiOriginOf(options.connection),
        { method: "POST", path: "/api/v1/authentication/login" },
        { kind: "login", ...credentials },
        timeoutMs,
      ));
    } catch (error) {
      if (error instanceof AirwallexTransportError)
        throw new AirwallexRejection("TEMPORARY_UNAVAILABLE");
      throw error;
    }
    if (status === 401 || status === 403)
      throw new AirwallexRejection("AUTHENTICATION_FAILED");
    if (status === 429) throw new AirwallexRejection("RATE_LIMITED");
    if (status >= 500) throw new AirwallexRejection("TEMPORARY_UNAVAILABLE");
    if (status !== 200 && status !== 201)
      throw new AirwallexRejection("CONFIGURATION_ERROR");
    // An unreadable token answer sent no payment request; the caller may simply retry.
    const parsed = airwallexLoginSchema.safeParse(body);
    if (!parsed.success) throw new AirwallexRejection("TEMPORARY_UNAVAILABLE");
    const stated = parseAirwallexTimestamp(parsed.data.expires_at);
    // Never trust a lifetime beyond the documented 30 minutes, whatever the clocks say.
    const expiresAt = Math.min(
      stated ?? startedAt + TOKEN_LIFETIME_MS,
      startedAt + TOKEN_LIFETIME_MS,
    );
    return { key, token: parsed.data.token, expiresAt };
  }

  return Object.freeze({
    async token(timeoutMs: number) {
      let credentials: AirwallexApiCredentials;
      try {
        credentials = await resolveAirwallexApiCredentials(
          options.credentials,
          options.connection,
          timeoutMs,
        );
      } catch {
        throw new AirwallexRejection("CONFIGURATION_ERROR");
      }
      const key = `${credentials.clientId}:${credentials.apiKey}`;
      const current = cached;
      if (
        current !== undefined &&
        current.key === key &&
        current.expiresAt - RENEW_MARGIN_MS > options.now().getTime()
      )
        return current.token;
      let flight = pending.get(key);
      if (flight === undefined) {
        flight = login(key, credentials, timeoutMs).finally(() => {
          pending.delete(key);
        });
        pending.set(key, flight);
      }
      const renewed = await flight;
      cached = renewed;
      return renewed.token;
    },
    invalidate(token: string) {
      if (cached?.token === token) cached = undefined;
    },
  });
}
