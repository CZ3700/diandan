import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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

/**
 * Copy a package without recreating pnpm's dependency links, then link its
 * node_modules back. Junctions need no symlink privilege on Windows; other
 * platforms create an ordinary directory symlink, so resolution is unchanged.
 */
async function copyPackage(relativePath, root) {
  const source = path.join(workspaceRoot, relativePath);
  const destination = path.join(root, relativePath);
  await cp(source, destination, {
    recursive: true,
    filter: (candidate) => path.basename(candidate) !== "node_modules",
  });
  await symlink(
    path.join(source, "node_modules"),
    path.join(destination, "node_modules"),
    "junction",
  );
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ui-composites-"));
  await copyPackage("packages/ui", root);
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

test("binds persisted browser evidence to the current render inputs", async (context) => {
  const { requiresBrowserEvidence } =
    await import("./browser-evidence-policy.mjs");
  if (!requiresBrowserEvidence([], process.env)) {
    context.skip(
      "browser evidence is re-verified in CI after verify:ui-composites:browser",
    );
    return;
  }
  const validate = await loadEvidenceValidator();
  assert.deepEqual(await validate(workspaceRoot), []);
});

test("browser evidence is required only in CI or by explicit flag", async () => {
  const { requiresBrowserEvidence } =
    await import("./browser-evidence-policy.mjs");
  assert.equal(requiresBrowserEvidence([], {}), false);
  assert.equal(requiresBrowserEvidence([], { CI: "false" }), false);
  assert.equal(requiresBrowserEvidence([], { CI: "1" }), true);
  assert.equal(requiresBrowserEvidence([], { CI: "true" }), true);
  assert.equal(
    requiresBrowserEvidence(["--require-browser-evidence"], {}),
    true,
  );
});

test("local composite checks skip persisted evidence unless required", async () => {
  const { runUiCompositesCheck } = await import("./check-ui-composites.mjs");
  let evidenceCalls = 0;
  const options = {
    workspaceRoot: "/virtual-workspace",
    validateStructure: async () => ["structure finding"],
    validateEvidence: async () => {
      evidenceCalls += 1;
      return ["evidence finding"];
    },
  };
  assert.deepEqual(
    await runUiCompositesCheck({ ...options, requireBrowserEvidence: false }),
    ["structure finding"],
  );
  assert.equal(evidenceCalls, 0);
  assert.deepEqual(
    await runUiCompositesCheck({ ...options, requireBrowserEvidence: true }),
    ["structure finding", "evidence finding"],
  );
  assert.equal(evidenceCalls, 1);
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
    "apps/storefront/src/app/%5Finternal/design-foundations/layout.tsx",
    'import "@fan-support/ui/composites.css";\n',
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

async function internalStyleFixture() {
  const root = await fixture();
  const globalPath = path.join(root, "apps/storefront/src/app/globals.css");
  await writeFile(
    globalPath,
    (await readFile(globalPath, "utf8")).replace(
      '@import "@fan-support/ui/composites.css";\n',
      "",
    ),
  );
  const layoutPath = path.join(
    root,
    "apps/storefront/src/app/%5Finternal/design-foundations/layout.tsx",
  );
  const source = await readFile(layoutPath, "utf8");
  if (!source.includes('import "@fan-support/ui/composites.css";')) {
    await writeFile(
      layoutPath,
      `import "@fan-support/ui/composites.css";\n${source}`,
    );
  }
  return root;
}

test("accepts composite styles owned by the internal layout", async (context) => {
  const validate = await loadValidator();
  const root = await internalStyleFixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  assert.deepEqual(await validate(root), []);
});

for (const [label, replacement] of [
  ["missing", ""],
  ["duplicate", 'import "@fan-support/ui/composites.css";\n'.repeat(2)],
  ["comment", '// import "@fan-support/ui/composites.css";\n'],
  ["string", "const unused = 'import \"@fan-support/ui/composites.css\";';\n"],
  ["type-only", 'import type {} from "@fan-support/ui/composites.css";\n'],
]) {
  test(`rejects ${label} internal composite CSS consumption`, async (context) => {
    const validate = await loadValidator();
    const root = await internalStyleFixture();
    context.after(() => rm(root, { force: true, recursive: true }));
    await replace(
      root,
      "apps/storefront/src/app/%5Finternal/design-foundations/layout.tsx",
      'import "@fan-support/ui/composites.css";\n',
      replacement,
    );
    const errors = await validate(root);
    assert.ok(
      errors.some((error) =>
        error.includes(
          "internal layout must import composites.css exactly once",
        ),
      ),
    );
  });
}

test("rejects composite styles leaking back into the public root", async (context) => {
  const validate = await loadValidator();
  const root = await internalStyleFixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  const globalPath = path.join(root, "apps/storefront/src/app/globals.css");
  await writeFile(
    globalPath,
    `@import "@fan-support/ui/composites.css";\n${await readFile(globalPath, "utf8")}`,
  );
  const errors = await validate(root);
  assert.ok(
    errors.some((error) =>
      error.includes("public root must not import composites.css"),
    ),
  );
});
