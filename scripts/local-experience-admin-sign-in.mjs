// ADR-021: switch an existing local or remote TEST instance between the local identity provider
// (LOCAL_OIDC) and built-in accounts (LOCAL_ACCOUNT). Takes effect at the next start; regenerate
// the Caddyfile afterwards so a public admin keeps or drops its Basic Auth accordingly.
// Usage: pnpm local:admin-sign-in --instance <name> --mode LOCAL_ACCOUNT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setLocalAdminSignIn } from "./local-experience-state.mjs";

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
  const config = await setLocalAdminSignIn(
    workspaceRoot,
    instance,
    option("--mode"),
  );
  console.log(
    JSON.stringify({
      instance,
      adminSignIn: config.adminSignIn,
      appliesAt: "next start",
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
