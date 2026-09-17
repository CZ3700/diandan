import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const helperUrl = new URL(
  "./admin-access-browser-diagnostics.mjs",
  import.meta.url,
);
const diagnostics = existsSync(helperUrl) ? await import(helperUrl.href) : {};
function inspect(
  message,
  initialCleanDocument = true,
  authenticationStarted = false,
) {
  assert.equal(
    typeof diagnostics.diagnoseAdminAccessConsole,
    "function",
    "bounded diagnostic classifier exists",
  );
  return diagnostics.diagnoseAdminAccessConsole({
    message,
    initialCleanDocument,
    authenticationStarted,
  });
}

test("classifies browser execution failures separately without requiring raw credentials", () => {
  for (const [message, category] of [
    [
      "Refused to execute script because its MIME type is text/html",
      "SCRIPT_MIME",
    ],
    [
      "Failed to find a valid digest in the integrity attribute",
      "SCRIPT_INTEGRITY",
    ],
    [
      "Evaluating a string as JavaScript violates Content Security Policy",
      "SCRIPT_EVAL_POLICY",
    ],
    [
      "Loading the script violates Content Security Policy",
      "CONTENT_SECURITY_POLICY",
    ],
    ["Access blocked by CORS policy", "CORS_POLICY"],
    ["ChunkLoadError: Loading chunk failed", "CHUNK_LOAD"],
    ["WebSocket connection failed", "DEV_WEBSOCKET"],
    ["Blocked cross-origin request; allowedDevOrigins", "DEV_ORIGIN_POLICY"],
  ])
    assert.equal(inspect(message).category, category);
});
test("early clean-document snippets redact URLs and opaque values and stop after authentication begins", () => {
  const raw = `Chunk error https://admin.example.invalid:1234/_next/chunk.js?code=private-sentinel https://elsewhere.invalid/trace wss://admin.example.invalid:1234/_next/hmr?id=private-websocket ws://localhost/hmr?id=private-cleartext ${"a".repeat(64)} state=private-state`;
  const value = inspect(raw);
  assert.ok(value.snippet);
  assert.ok(
    !/private-sentinel|private-state|private-websocket|private-cleartext|https?:|wss?:|a{64}/u.test(
      value.snippet,
    ),
  );
  assert.equal(inspect(raw, false).snippet, undefined);
  assert.equal(inspect(raw, true, true).snippet, undefined);
  assert.equal(inspect("sessionToken: private-token").snippet, undefined);
  assert.ok(inspect("Error: " + "word ".repeat(300)).snippet.length <= 600);
});
