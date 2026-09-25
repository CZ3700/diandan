import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolve a fixed argv so it can be spawned without a shell on every platform.
 *
 * Windows ships corepack as a `.cmd` shim, which Node refuses to spawn with
 * `shell: false`. There the bundled corepack JavaScript entry is run through the
 * current node.exe instead; every other command and platform is left unchanged.
 */
export function resolveSpawnCommand(
  command,
  args,
  {
    platform = process.platform,
    execPath = process.execPath,
    exists = existsSync,
  } = {},
) {
  if (platform !== "win32" || command !== "corepack") {
    return { command, args: [...args] };
  }
  const entry = path.win32.join(
    path.win32.dirname(execPath),
    "node_modules",
    "corepack",
    "dist",
    "corepack.js",
  );
  if (!exists(entry)) {
    throw new Error(
      `corepack entry not found next to ${execPath}; use an official Node.js distribution that bundles corepack`,
    );
  }
  return { command: execPath, args: [entry, ...args] };
}
