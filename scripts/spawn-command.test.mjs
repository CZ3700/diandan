import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveSpawnCommand } from "./spawn-command.mjs";

const windowsNode = "C:\\tools\\node-v24\\node.exe";
const windowsCorepack = path.win32.join(
  "C:\\tools\\node-v24",
  "node_modules",
  "corepack",
  "dist",
  "corepack.js",
);

test("non-Windows platforms keep the fixed argv unchanged", () => {
  for (const platform of ["linux", "darwin"]) {
    assert.deepEqual(
      resolveSpawnCommand("corepack", ["pnpm", "run", "lint"], {
        platform,
        execPath: "/usr/local/bin/node",
        exists: () => true,
      }),
      { command: "corepack", args: ["pnpm", "run", "lint"] },
    );
  }
});

test("Windows runs corepack through node.exe without a .cmd shim", () => {
  assert.deepEqual(
    resolveSpawnCommand("corepack", ["pnpm", "exec", "turbo"], {
      platform: "win32",
      execPath: windowsNode,
      exists: (candidate) => candidate === windowsCorepack,
    }),
    { command: windowsNode, args: [windowsCorepack, "pnpm", "exec", "turbo"] },
  );
});

test("Windows leaves every other command untouched", () => {
  for (const command of ["git", windowsNode]) {
    assert.deepEqual(
      resolveSpawnCommand(command, ["status"], {
        platform: "win32",
        execPath: windowsNode,
        exists: () => true,
      }),
      { command, args: ["status"] },
    );
  }
});

test("Windows fails clearly when the bundled corepack entry is absent", () => {
  assert.throws(
    () =>
      resolveSpawnCommand("corepack", ["pnpm"], {
        platform: "win32",
        execPath: windowsNode,
        exists: () => false,
      }),
    /corepack entry not found/u,
  );
});

test("the caller's argv array is never mutated", () => {
  const args = Object.freeze(["pnpm", "run", "format:check"]);
  const resolved = resolveSpawnCommand("corepack", args, {
    platform: "win32",
    execPath: windowsNode,
    exists: () => true,
  });
  assert.notEqual(resolved.args, args);
  assert.deepEqual(args, ["pnpm", "run", "format:check"]);
});
