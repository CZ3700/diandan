import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const advisory = "GHSA-vcvr-r3jv-pc5j";

// The npm audit feed did not include this published advisory on 2026-09-24.
// https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j
function assertPatched(version) {
  assert.match(
    version,
    /^\d+\.\d+\.\d+$/u,
    "Use a pinned stable Next.js version",
  );
  const [major, minor, patch] = version.split(".").map(Number);
  assert.ok(
    !(major === 16 && minor >= 2 && (minor < 3 || (minor === 3 && patch < 6))),
    `${advisory}: affected Next.js ${version}; use the published patched release`,
  );
}

test("both application manifests exclude the published critical Next.js advisory", async () => {
  for (const app of ["storefront", "admin"]) {
    const manifest = JSON.parse(await read(`apps/${app}/package.json`));
    assertPatched(manifest.dependencies.next);
  }
});

test("the frozen lock has no affected Next.js resolution, including secondary copies", async () => {
  const lock = parse(await read("pnpm-lock.yaml"));
  const versions = Object.keys(lock.packages).filter((key) =>
    key.startsWith("next@"),
  );
  assert.ok(versions.length > 0, "Next.js must be present in the frozen lock");
  for (const key of versions) assertPatched(key.slice("next@".length));
});

test("both apps, the Next lint plugin and their locked versions stay aligned", async () => {
  const manifest = JSON.parse(await read("package.json"));
  const lock = parse(await read("pnpm-lock.yaml"));
  const version = manifest.devDependencies["@next/eslint-plugin-next"];
  for (const app of ["storefront", "admin"]) {
    const appManifest = JSON.parse(await read(`apps/${app}/package.json`));
    assert.equal(appManifest.dependencies.next, version);
    const dependency = lock.importers[`apps/${app}`].dependencies.next;
    assert.equal(dependency.specifier, version);
    assert.equal(dependency.version.split("(")[0], version);
  }
  const lint = lock.importers["."].devDependencies["@next/eslint-plugin-next"];
  assert.equal(lint.specifier, version);
  assert.equal(lint.version.split("(")[0], version);
});
