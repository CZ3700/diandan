/** Diagnostics may expose a bounded, redacted snippet only before the first login. */
export function diagnoseAdminAccessConsole({
  message,
  initialCleanDocument,
  authenticationStarted,
}) {
  const patterns = [
    ["SCRIPT_MIME", /MIME type|strict MIME/iu],
    [
      "SCRIPT_INTEGRITY",
      /integrity attribute|valid digest|subresource.integrity/iu,
    ],
    ["SCRIPT_EVAL_POLICY", /unsafe-eval|EvalError|evaluating a string/iu],
    [
      "DEV_ORIGIN_POLICY",
      /cross.origin.*(?:block|request)|allowedDevOrigins/iu,
    ],
    [
      "CONTENT_SECURITY_POLICY",
      /content.security.policy|refused to (?:load|execute)|violates.*directive/iu,
    ],
    ["CORS_POLICY", /CORS policy|access.control.allow.origin/iu],
    [
      "NETWORK_PERMISSION",
      /private network|local network|address space|ERR_BLOCKED_BY/iu,
    ],
    ["CHUNK_LOAD", /ChunkLoadError|loading chunk|load chunk|module factory/iu],
    ["DEV_WEBSOCKET", /WebSocket/iu],
    ["RESOURCE_LOAD_FAILED", /failed to load resource/iu],
    ["HYDRATION", /hydrat/iu],
  ];
  const category =
    patterns.find(([, pattern]) => pattern.test(message))?.[0] ??
    "MESSAGE_OMITTED";
  if (
    !initialCleanDocument ||
    authenticationStarted ||
    /adminAccessKey|sessionToken|csrfToken|browserToken|tokenPepper|subjectPepper|password/iu.test(
      message,
    )
  )
    return { category };
  const snippet = message
    .replace(/(?:https?|wss?):\/\/[^\s"'<>)]*/giu, "[URL]")
    .replace(
      /(?:authorization|bearer|code|state|token|cookie|secret|pepper|nonce|assertion)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;)]+)/giu,
      "[CREDENTIAL]",
    )
    .replace(/[A-Za-z0-9_-]{32,}/gu, "[OPAQUE]")
    .replace(/[\r\n\t]+/gu, " ")
    .slice(0, 600);
  return { category, snippet };
}
