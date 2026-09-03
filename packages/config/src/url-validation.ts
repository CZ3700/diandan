function hasAmbiguousUrlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x20 ||
      codePoint === 0x7f ||
      character === "\\"
    ) {
      return true;
    }
  }

  return false;
}

const previewSiteOrigins = new Set([
  "https://localhost:3443",
  "https://localhost:3444",
]);

function parseUnambiguousUrl(value: string): URL | undefined {
  if (hasAmbiguousUrlCharacter(value)) {
    return undefined;
  }

  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function isBlockedIpv4Address(octets: readonly number[]): boolean {
  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second !== undefined && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 31 && third === 196) ||
    (first === 192 && second === 52 && third === 193) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 175 && third === 48) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    (first !== undefined && first >= 224)
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
  const isGlobalUnicast =
    first !== undefined && first >= 0x2000 && first <= 0x3fff;
  const isDocumentation = first === 0x2001 && ipv6[1] === 0x0db8;
  const isBenchmarking =
    first === 0x2001 && ipv6[1] === 0x0002 && ipv6[2] === 0;
  const isTeredo = first === 0x2001 && ipv6[1] === 0;
  const isDeprecatedSixToFour = first === 0x2002;
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
    !isGlobalUnicast ||
    isDocumentation ||
    isBenchmarking ||
    isTeredo ||
    isDeprecatedSixToFour ||
    (embeddedIpv4 !== undefined && isBlockedIpv4Address(embeddedIpv4))
  );
}

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return (
    normalized !== "localhost" &&
    !normalized.endsWith(".localhost") &&
    !isBlockedIpLiteral(normalized)
  );
}

export function isPublicSiteOrigin(value: string): boolean {
  const parsed = parseUnambiguousUrl(value);
  if (
    parsed === undefined ||
    parsed.origin !== value ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    return false;
  }

  return (
    (parsed.protocol === "https:" && isPublicHostname(parsed.hostname)) ||
    (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname))
  );
}

export function isPreviewSiteOrigin(value: string): boolean {
  return previewSiteOrigins.has(value);
}

export function isSupportedBrowserSiteOrigin(value: string): boolean {
  return isPublicSiteOrigin(value) || isPreviewSiteOrigin(value);
}

export function isLoopbackHttpOrigin(value: string): boolean {
  const parsed = parseUnambiguousUrl(value);

  return (
    parsed !== undefined &&
    parsed.protocol === "http:" &&
    isLoopbackHostname(parsed.hostname)
  );
}

export function isPostgresUrl(value: string): boolean {
  const parsed = parseUnambiguousUrl(value);
  if (
    parsed === undefined ||
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hostname === "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname.length <= 1
  ) {
    return false;
  }

  try {
    return decodeURIComponent(parsed.pathname.slice(1)).trim().length > 0;
  } catch {
    return false;
  }
}

export function isObjectStorageEndpoint(value: string): boolean {
  const parsed = parseUnambiguousUrl(value);

  return (
    parsed !== undefined &&
    parsed.origin === value &&
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname === "/" &&
    parsed.search === "" &&
    parsed.hash === ""
  );
}

export function isPublicMediaOrigin(value: string): boolean {
  const parsed = parseUnambiguousUrl(value);

  return (
    parsed !== undefined &&
    parsed.origin === value &&
    parsed.protocol === "https:" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname === "/" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    !value.includes("#") &&
    isPublicHostname(parsed.hostname)
  );
}

export function isHttpOrigin(value: string): boolean {
  const parsed = parseUnambiguousUrl(value);

  return parsed !== undefined && parsed.protocol === "http:";
}
