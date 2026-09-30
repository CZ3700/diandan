// Switch an existing local or remote TEST instance between compiled applications (PREBUILT: next
// start in the test tier, built-in accounts only) and development servers (DEVELOPMENT).
// Takes effect at the next start; PREBUILT needs `pnpm local:build-web` for the current checkout.
// Usage: pnpm local:web-mode --instance <name> --mode PREBUILT|DEVELOPMENT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setLocalWebMode } from "./local-experience-state.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
try {
  const instance = option("--instance") ?? "default";
  const config = await setLocalWebMode(
    workspaceRoot,
    instance,
    option("--mode"),
  );
  console.log(
    JSON.stringify({
      instance,
      webMode: config.webMode ?? "DEVELOPMENT",
      appliesAt: "next start",
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
