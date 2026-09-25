/**
 * Persisted browser evidence is no longer stored in git. CI regenerates it
 * (the quality suite runs verify:ui-*:browser before pnpm check) and must
 * validate it; local checks validate it only when explicitly asked.
 */
export function requiresBrowserEvidence(
  argv = process.argv,
  env = process.env,
) {
  return (
    argv.includes("--require-browser-evidence") ||
    env["CI"] === "1" ||
    env["CI"] === "true"
  );
}
