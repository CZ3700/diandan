import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function loadValidator() {
  let loaded;
  try {
    loaded = await import("./check-ui-composites.mjs");
  } catch {
    loaded = undefined;
  }
  assert.equal(
    typeof loaded?.validateUiComposites,
    "function",
    "UI composite validator must exist",
  );
  return loaded.validateUiComposites;
}

async function loadEvidenceValidator() {
  const loaded = await import("./check-ui-composites.mjs");
  assert.equal(
    typeof loaded.validatePersistedUiCompositeEvidence,
    "function",
    "persisted UI composite evidence validator must exist",
  );
  return loaded.validatePersistedUiCompositeEvidence;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ui-composites-"));
  await cp(
    path.join(workspaceRoot, "packages/ui"),
    path.join(root, "packages/ui"),
    {
      recursive: true,
    },
  );
  await cp(
    path.join(workspaceRoot, "apps/storefront/src/app"),
    path.join(root, "apps/storefront/src/app"),
    { recursive: true },
  );
  await cp(
    path.join(workspaceRoot, "package.json"),
    path.join(root, "package.json"),
  );
  return root;
}

async function replace(root, relativePath, from, to) {
  const absolutePath = path.join(root, relativePath);
  const source = await readFile(absolutePath, "utf8");
  assert.ok(
    source.includes(from),
    `${relativePath} must contain mutation target`,
  );
  await writeFile(absolutePath, source.replace(from, to));
}

test("accepts the reviewed composite package, CSS and preview routes", async () => {
  const validate = await loadValidator();
  assert.deepEqual(await validate(workspaceRoot), []);
});

test("binds persisted browser evidence to the current render inputs", async () => {
  const validate = await loadEvidenceValidator();
  assert.deepEqual(await validate(workspaceRoot), []);
});

test("fails closed when persisted browser evidence is missing", async (context) => {
  const validate = await loadEvidenceValidator();
  const root = await mkdtemp(path.join(os.tmpdir(), "ui-composites-evidence-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const errors = await validate(root);
  assert.ok(errors.some((error) => error.includes("missing")));
});

test("rejects missing or widened public exports and CSS side effects", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await replace(
    root,
    "packages/ui/package.json",
    '"./composites.css": "./styles/composites.css"',
    '"./composites-extra": "./styles/composites.css"',
  );
  const errors = await validate(root);
  assert.ok(errors.some((error) => error.includes("./composites.css")));
  assert.ok(errors.some((error) => error.includes("unexpected public export")));
});

test("rejects client directives, aliases and forbidden transitive modules", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await replace(
    root,
    "packages/ui/src/composites.ts",
    'export { Hero, type HeroProps } from "./hero.js";',
    '"use client";\nexport { Hero as hero, type HeroProps } from "./hero.js";\nimport "./media.js";',
  );
  const errors = await validate(root);
  assert.ok(errors.some((error) => error.includes("server-compatible")));
  assert.ok(errors.some((error) => error.includes("exact value exports")));
  assert.ok(
    errors.some((error) => error.includes("forbidden composite dependency")),
  );
});

test("allows only the reviewed runtime-media client leaf in the server graph", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await replace(
    root,
    "packages/ui/src/hero.tsx",
    'import type { ReactElement } from "react";',
    '"use client";\nimport type { ReactElement } from "react";',
  );
  const errors = await validate(root);
  assert.ok(
    errors.some((error) =>
      error.includes("server-compatible; reached packages/ui/src/hero.tsx"),
    ),
  );
});

test("rejects reverse contamination of the frozen root and client entries", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await replace(
    root,
    "packages/ui/src/index.ts",
    'export const workspacePackageName = "@fan-support/ui" as const;',
    'export const workspacePackageName = "@fan-support/ui" as const;\nexport { Hero as hero } from "./hero.js";',
  );
  const errors = await validate(root);
  assert.ok(
    errors.some((error) => error.includes("frozen root value exports")),
  );
  assert.ok(
    errors.some((error) => error.includes("must not reach composite modules")),
  );
});

test("rejects physical-direction CSS, text clipping and missing consumption", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await writeFile(
    path.join(root, "packages/ui/styles/composites.css"),
    ".fs-hero__heading { margin-left: 1rem; white-space: nowrap; }\n",
  );
  await replace(
    root,
    "apps/storefront/src/app/globals.css",
    '@import "@fan-support/ui/composites.css";\n',
    "",
  );
  const errors = await validate(root);
  assert.ok(errors.some((error) => error.includes("logical CSS")));
  assert.ok(errors.some((error) => error.includes("translatable text")));
  assert.ok(
    errors.some((error) =>
      error.includes("import composites.css exactly once"),
    ),
  );
});

test("rejects missing or parallel composite preview routes", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await rm(
    path.join(
      root,
      "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/en/components/page.tsx",
    ),
  );
  await mkdir(path.join(root, "apps/storefront/src/app/components"), {
    recursive: true,
  });
  await cp(
    path.join(
      root,
      "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/pt/components/page.tsx",
    ),
    path.join(root, "apps/storefront/src/app/components/page.tsx"),
    { recursive: true },
  );
  const errors = await validate(root);
  assert.ok(
    errors.some((error) =>
      error.includes("missing composite preview route en"),
    ),
  );
  assert.ok(
    errors.some((error) =>
      error.includes("unexpected composite preview route"),
    ),
  );
});

test("rejects removing the gate from the root check workflow", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await replace(
    root,
    "package.json",
    " && corepack pnpm check:ui-composites",
    "",
  );
  const errors = await validate(root);
  assert.ok(
    errors.some((error) =>
      error.includes("root check must run check:ui-composites"),
    ),
  );
});
