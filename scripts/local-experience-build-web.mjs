// Build admin, storefront, API and Worker for compiled (PREBUILT) instances, as the container image
// does, then stamp the checkout revision. Refuses while an instance runs; the exit code is the
// build's own, and a failed build leaves no stamp, so a PREBUILT instance will not start on it.
// Usage: pnpm local:build-web
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
try {
  const { buildLocalWeb } =
    await import("../apps/api/scripts/local-experience-web-build.mjs");
  const code = await buildLocalWeb({ workspaceRoot });
  console.log(
    code === 0 ? "build exit 0; compiled web stamped" : `build exit ${code}`,
  );
  process.exitCode = code;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
