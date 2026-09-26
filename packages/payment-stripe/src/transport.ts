export const STRIPE_API_ORIGIN = "https://api.stripe.com";
export const STRIPE_API_VERSION = "2026-08-26.dahlia";
const MAX_RESPONSE_BYTES = 1_048_576;

/** Ordered pairs keep request bodies byte-stable, which idempotent replays require. */
export type StripeParameters = readonly (readonly [string, string])[];
export type StripeRequest = Readonly<{
  method: "GET" | "POST";
  /** Fixed by the adapter; never derived from caller input. */
  path: string;
  parameters?: StripeParameters;
  idempotencyKey?: string;
}>;
export type StripeResponse = Readonly<{
  status: number;
  /** Stripe marks a response served from an earlier request with the same idempotency key. */
  replayed: boolean;
  body: unknown;
}>;
export type StripeTransport = (
  request: StripeRequest,
  secretKey: string,
  timeoutMs: number,
) => Promise<StripeResponse>;

/** The outcome of the request is unknown: network failure, deadline, or a non-JSON reply. */
export class StripeTransportError extends Error {
  public constructor() {
    super("Stripe transport failed");
    this.name = "StripeTransportError";
  }
}

async function readBounded(response: Response): Promise<unknown> {
  if (!response.body) throw new StripeTransportError();
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
        throw new StripeTransportError();
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

export function createStripeTransport(
  fetcher: typeof fetch = fetch,
): StripeTransport {
  return async (request, secretKey, timeoutMs) => {
    const url = new URL(request.path, STRIPE_API_ORIGIN);
    if (url.origin !== STRIPE_API_ORIGIN || !url.pathname.startsWith("/v1/"))
      throw new TypeError("Unexpected Stripe API path");
    const parameters = new URLSearchParams(
      (request.parameters ?? []).map(([key, value]): [string, string] => [
        key,
        value,
      ]),
    );
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${secretKey}`,
      "stripe-version": STRIPE_API_VERSION,
    };
    if (request.method === "GET") url.search = parameters.toString();
    else headers["content-type"] = "application/x-www-form-urlencoded";
    if (request.idempotencyKey !== undefined)
      headers["idempotency-key"] = request.idempotencyKey;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new StripeTransportError());
      }, timeoutMs);
    });
    const exchange = async (): Promise<StripeResponse> => {
      let response: Response;
      try {
        response = await fetcher(url, {
          method: request.method,
          headers,
          ...(request.method === "POST" ? { body: parameters.toString() } : {}),
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        throw new StripeTransportError();
      }
      if (
        response.redirected ||
        !/^application\/json(?:;|$)/iu.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new StripeTransportError();
      }
      let body: unknown;
      try {
        body = await readBounded(response);
      } catch {
        throw new StripeTransportError();
      }
      return Object.freeze({
        status: response.status,
        replayed: response.headers.get("idempotent-replayed") === "true",
        body,
      });
    };
    try {
      return await Promise.race([exchange(), deadline]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
