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

  if (parsed.protocol === "https:") {
    return true;
  }

  return parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname);
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
