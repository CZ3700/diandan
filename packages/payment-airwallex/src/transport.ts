export const AIRWALLEX_API_VERSION = "2026-08-21";
export const AIRWALLEX_API_ORIGINS = Object.freeze({
  TEST: "https://api.sandbox.airwallex.com",
  LIVE: "https://api.airwallex.com",
} as const);
export type AirwallexApiOrigin =
  (typeof AIRWALLEX_API_ORIGINS)[keyof typeof AIRWALLEX_API_ORIGINS];
const MAX_RESPONSE_BYTES = 1_048_576;

export type AirwallexRequest = Readonly<{
  method: "GET" | "POST";
  /** Fixed by the adapter; never derived from caller input. */
  path: string;
  query?: readonly (readonly [string, string])[];
  body?: Readonly<Record<string, unknown>>;
}>;
export type AirwallexAuthorization =
  | Readonly<{ kind: "token"; token: string }>
  | Readonly<{ kind: "login"; clientId: string; apiKey: string }>;
export type AirwallexResponse = Readonly<{ status: number; body: unknown }>;
export type AirwallexTransport = (
  origin: AirwallexApiOrigin,
  request: AirwallexRequest,
  authorization: AirwallexAuthorization,
  timeoutMs: number,
) => Promise<AirwallexResponse>;

/** The outcome of the request is unknown: network failure, deadline, or an unreadable reply. */
export class AirwallexTransportError extends Error {
  public constructor() {
    super("Airwallex transport failed");
    this.name = "AirwallexTransportError";
  }
}

async function readBounded(response: Response): Promise<unknown> {
  if (!response.body) throw new AirwallexTransportError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AirwallexTransportError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as unknown;
}

const isApiOrigin = (value: string): value is AirwallexApiOrigin =>
  Object.values(AIRWALLEX_API_ORIGINS).some((origin) => origin === value);

export function createAirwallexTransport(
  fetcher: typeof fetch = fetch,
): AirwallexTransport {
  return async (origin, request, authorization, timeoutMs) => {
    if (!isApiOrigin(origin))
      throw new TypeError("Unexpected Airwallex origin");
    const url = new URL(request.path, origin);
    if (url.origin !== origin || !url.pathname.startsWith("/api/v1/"))
      throw new TypeError("Unexpected Airwallex API path");
    url.search = new URLSearchParams(
      (request.query ?? []).map(([key, value]): [string, string] => [
        key,
        value,
      ]),
    ).toString();
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-version": AIRWALLEX_API_VERSION,
    };
    if (authorization.kind === "token")
      headers["authorization"] = `Bearer ${authorization.token}`;
    else {
      headers["x-client-id"] = authorization.clientId;
      headers["x-api-key"] = authorization.apiKey;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AirwallexTransportError());
      }, timeoutMs);
    });
    const exchange = async (): Promise<AirwallexResponse> => {
      let response: Response;
      try {
        response = await fetcher(url, {
          method: request.method,
          headers,
          ...(request.body === undefined
            ? {}
            : { body: JSON.stringify(request.body) }),
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        throw new AirwallexTransportError();
      }
      const json = /^application\/json(?:;|$)/iu.test(
        response.headers.get("content-type") ?? "",
      );
      // A client error was definitely not applied, even when a gateway answers without JSON.
      if (
        !response.redirected &&
        !json &&
        response.status >= 400 &&
        response.status < 500
      ) {
        await response.body?.cancel().catch(() => undefined);
        return Object.freeze({ status: response.status, body: undefined });
      }
      if (response.redirected || !json) {
        await response.body?.cancel().catch(() => undefined);
        throw new AirwallexTransportError();
      }
      let body: unknown;
      try {
        body = await readBounded(response);
      } catch {
        throw new AirwallexTransportError();
      }
      return Object.freeze({ status: response.status, body });
    };
    try {
      return await Promise.race([exchange(), deadline]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
