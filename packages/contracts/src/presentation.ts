import { z } from "zod";

export const slugSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .brand<"Slug">();

export const publicHttpsUrlSchema = z
  .url({ protocol: /^https$/u })
  .regex(/^https:\/\/(?![^/?#]*@)/u)
  .meta({ format: "uri" })
  .brand<"PublicHttpsUrl">();

const publicMediaFormats = new Set(["avif", "webp", "jpeg"]);

function isBlockedIpv4Address(octets: readonly number[]): boolean {
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function parseIpv4Address(hostname: string): readonly number[] | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) {
    return undefined;
  }
  const octets = hostname.split(".").map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255)
    ? octets
    : undefined;
}

function parseIpv6Address(hostname: string): readonly number[] | undefined {
  const address = hostname.startsWith("[")
    ? hostname.slice(1, hostname.endsWith("]") ? -1 : undefined)
    : hostname;
  const halves = address.split("::");
  if (halves.length > 2) {
    return undefined;
  }

  const left = halves[0] === "" ? [] : halves[0]!.split(":");
  const right =
    halves.length === 1 || halves[1] === "" ? [] : halves[1]!.split(":");
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return undefined;
  }

  const segments = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ];
  if (!segments.every((segment) => /^[0-9a-f]{1,4}$/u.test(segment))) {
    return undefined;
  }
  return segments.map((segment) => Number.parseInt(segment, 16));
}

function isBlockedIpLiteral(hostname: string): boolean {
  const ipv4 = parseIpv4Address(hostname);
  if (ipv4 !== undefined) {
    return isBlockedIpv4Address(ipv4);
  }

  const ipv6 = parseIpv6Address(hostname);
  if (ipv6 === undefined) {
    return false;
  }
  const [first] = ipv6;
  const isUnspecifiedOrLoopback =
    ipv6.slice(0, 7).every((segment) => segment === 0) &&
    (ipv6[7] === 0 || ipv6[7] === 1);
  const isUniqueLocal = first !== undefined && (first & 0xfe00) === 0xfc00;
  const isLinkLocal = first !== undefined && (first & 0xffc0) === 0xfe80;
  const isIpv4Embedded =
    ipv6.slice(0, 5).every((segment) => segment === 0) &&
    (ipv6[5] === 0 || ipv6[5] === 0xffff);
  const embeddedIpv4 = isIpv4Embedded
    ? [
        (ipv6[6]! >> 8) & 0xff,
        ipv6[6]! & 0xff,
        (ipv6[7]! >> 8) & 0xff,
        ipv6[7]! & 0xff,
      ]
    : undefined;

  return (
    isUnspecifiedOrLoopback ||
    isUniqueLocal ||
    isLinkLocal ||
    (embeddedIpv4 !== undefined && isBlockedIpv4Address(embeddedIpv4))
  );
}

function hasSafePublicMediaQueryParameters(url: URL): boolean {
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);

    if (key === "format") {
      if (!publicMediaFormats.has(value)) {
        return false;
      }
      continue;
    }
    if (key === "width") {
      if (!/^[1-9]\d*$/u.test(value)) {
        return false;
      }
      const width = Number(value);
      if (width > 4_096) {
        return false;
      }
      continue;
    }
    return false;
  }
  return true;
}

function isSafePublicMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (
      value.includes("#") ||
      url.username !== "" ||
      url.password !== "" ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      isBlockedIpLiteral(hostname)
    ) {
      return false;
    }
    return hasSafePublicMediaQueryParameters(url);
  } catch {
    return false;
  }
}

export const publicMediaUrlSchema = publicHttpsUrlSchema
  .refine(
    isSafePublicMediaUrl,
    "public media URL must use a public host without credentials or fragments and only supported transformation parameters",
  )
  .meta({
    format: "uri",
    "x-runtime-invariants": [
      "userinfo, fragments, localhost, and private, loopback, or link-local IP literals are rejected",
      "query parameters are limited to unique width (1..4096) and format (avif, webp, or jpeg) values",
      "storage and CDN signing credentials are rejected",
    ],
  })
  .brand<"PublicMediaUrl">();

export const publicMediaViewSchema = z.strictObject({
  url: publicMediaUrlSchema,
  alt: z.string().min(1).max(300),
});

export type PublicMediaView = z.infer<typeof publicMediaViewSchema>;
export type PublicMediaUrl = z.infer<typeof publicMediaUrlSchema>;
