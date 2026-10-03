import { isIP } from "node:net";

const MAX_ENTRIES = 256;
// Narrower than this would trust most of the address space, which is the same as trusting every hop.
const MINIMUM_PREFIX = { 4: 8, 6: 16 } as const;

function validEntry(entry: string): boolean {
  const [address = "", prefix, extra] = entry.split("/");
  const family = isIP(address);
  if (family !== 4 && family !== 6) return false;
  if (prefix === undefined) return true;
  if (extra !== undefined || !/^\d{1,3}$/u.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= MINIMUM_PREFIX[family] && bits <= (family === 4 ? 32 : 128);
}

/** Exact proxy addresses or networks whose X-Forwarded-For entries are believed; absent trusts none. No hop counts. */
export function resolveTrustedProxyCidrs(
  environment: Readonly<Record<string, string | undefined>>,
): readonly string[] | undefined {
  const text = environment["FAN_SUPPORT_TRUSTED_PROXY_CIDRS"];
  if (text === undefined) return undefined;
  const entries = text.split(",").map((entry) => entry.trim());
  if (
    text.length > 16_384 ||
    entries.length > MAX_ENTRIES ||
    !entries.every(validEntry)
  )
    throw new TypeError("Invalid trusted proxy configuration");
  return Object.freeze(entries);
}

/** request.ip is the TCP peer unless the deployment lists the proxies in front of the API. */
export function apiAdapterOptions(
  environment: Readonly<Record<string, string | undefined>>,
): { logger: false; trustProxy?: string[] } {
  const trusted = resolveTrustedProxyCidrs(environment);
  return trusted === undefined
    ? { logger: false }
    : { logger: false, trustProxy: [...trusted] };
}
