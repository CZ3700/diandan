import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import postcss from "postcss";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function loadValidator() {
  let loaded;
  try {
    loaded = await import("./check-ui-motion.mjs");
  } catch {
    loaded = undefined;
  }
  assert.equal(
    typeof loaded?.validateUiMotion,
    "function",
    "UI motion validator must exist",
  );
  return loaded.validateUiMotion;
}

async function loadPersistedValidator() {
  const loaded = await import("./check-ui-motion.mjs");
  assert.equal(
    typeof loaded.validatePersistedUiMotionEvidence,
    "function",
    "persisted UI motion evidence validator must exist",
  );
  return loaded.validatePersistedUiMotionEvidence;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ui-motion-"));
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
    path.join(workspaceRoot, "apps/storefront/public/ui-motion"),
    path.join(root, "apps/storefront/public/ui-motion"),
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

test("accepts the reviewed motion entries, CSS and internal previews", async () => {
  const validate = await loadValidator();
  assert.deepEqual(await validate(workspaceRoot), []);
});

test("binds persisted browser evidence to the current motion render inputs", async () => {
  const validate = await loadPersistedValidator();
  assert.deepEqual(await validate(workspaceRoot), []);
});

test("rejects missing, widened or incorrectly side-effected motion exports", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await replace(
    root,
    "packages/ui/package.json",
    '"./motion.css": "./styles/motion.css"',
    '"./motion-extra": "./styles/motion.css"',
  );
  await replace(root, "packages/ui/package.json", '"./styles/motion.css",', "");

  const errors = await validate(root);
  assert.ok(
    errors.some((error) => error.includes("exact ./motion.css export")),
  );
  assert.ok(errors.some((error) => error.includes("unexpected motion export")));
  assert.ok(errors.some((error) => error.includes("motion.css side effect")));
});

test("rejects motion entry targets hidden behind unrelated public aliases", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await replace(
    root,
    "packages/ui/package.json",
    '"./motion": {',
    '"./animation": { "types": "./dist/motion.d.ts", "import": "./dist/motion.js" },\n    "./motion": {',
  );

  const errors = await validate(root);
  assert.ok(
    errors.some((error) =>
      error.includes("unexpected alias to a motion target"),
    ),
  );
});

test("enforces server and client directives plus exact runtime exports", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await replace(
    root,
    "packages/ui/src/motion.tsx",
    'import type { ReactElement, ReactNode } from "react";',
    '"use client";\nimport type { ReactElement, ReactNode } from "react";\nexport const SurpriseMotion = 1;',
  );
  await replace(
    root,
    "packages/ui/src/motion-client.tsx",
    '"use client";',
    '"use strict";\n"use client";',
  );

  const errors = await validate(root);
  assert.ok(
    errors.some((error) =>
      error.includes("motion server entry must not use client"),
    ),
  );
  assert.ok(
    errors.some((error) => error.includes("motion server runtime exports")),
  );
  assert.ok(
    errors.some((error) => error.includes("motion-client first statement")),
  );
});

test("rejects reverse motion exports from frozen UI entries", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await replace(
    root,
    "packages/ui/src/composites.ts",
    'export { Hero, type HeroProps } from "./hero.js";',
    'export { Hero, type HeroProps } from "./hero.js";\nexport { HeroEntrance as Entrance } from "./motion.js";',
  );

  const errors = await validate(root);
  assert.ok(errors.some((error) => error.includes("frozen composites entry")));
});

test("rejects unsafe duration, easing, repetition, scale and layout animation CSS", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await writeFile(
    path.join(root, "packages/ui/styles/motion.css"),
    `${await readFile(path.join(root, "packages/ui/styles/motion.css"), "utf8")}\n` +
      ".bad { transition: all 240ms ease-in; animation: bad 1s linear infinite; transform: scale(0); }\n" +
      "@keyframes bad { from { inline-size: 1px; } to { inline-size: 2px; } }\n",
  );

  const errors = await validate(root);
  assert.ok(errors.some((error) => error.includes("transition: all")));
  assert.ok(errors.some((error) => error.includes("raw motion duration")));
  assert.ok(errors.some((error) => error.includes("ease-in")));
  assert.ok(errors.some((error) => error.includes("infinite motion")));
  assert.ok(errors.some((error) => error.includes("scale(0)")));
  assert.ok(
    errors.some((error) => error.includes("layout property inline-size")),
  );
});

test("requires explicit reduced motion final state and one global import", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await replace(
    root,
    "packages/ui/styles/motion.css",
    "    transition: none;",
    "    transition: opacity var(--motion-control-effective) var(--ease-out);",
  );
  await replace(
    root,
    "apps/storefront/src/app/globals.css",
    '@import "@fan-support/ui/motion.css";\n',
    "",
  );

  const errors = await validate(root);
  assert.ok(
    errors.some((error) => error.includes("reduced-motion transition none")),
  );
  assert.ok(
    errors.some((error) => error.includes("import motion.css exactly once")),
  );
});

test("keeps the outgoing idol visible through prepare and owns one stable live region", async () => {
  const css = await readFile(
    path.join(workspaceRoot, "packages/ui/styles/motion.css"),
    "utf8",
  );
  const client = await readFile(
    path.join(workspaceRoot, "packages/ui/src/motion-client.tsx"),
    "utf8",
  );
  const stylesheet = postcss.parse(css);
  const exactOutgoingRules = [];
  const settledOutgoingRules = [];
  stylesheet.walkRules((rule) => {
    if (
      rule.selectors.includes(
        '.fs-motion-idol__media-layer[data-layer="outgoing"]',
      )
    ) {
      exactOutgoingRules.push(rule);
    }
    if (
      rule.selector.includes('data-motion-phase="settled"') &&
      rule.selector.includes('data-layer="outgoing"')
    ) {
      settledOutgoingRules.push(rule);
    }
  });
  const declaresZeroOpacity = (rule) =>
    rule.nodes.some(
      (node) =>
        node.type === "decl" &&
        node.prop === "opacity" &&
        node.value.trim() === "0",
    );

  assert.ok(settledOutgoingRules.some(declaresZeroOpacity));
  assert.ok(!exactOutgoingRules.some(declaresZeroOpacity));
  assert.equal(client.match(/<LiveRegion\b/gu)?.length, 1);
  assert.doesNotMatch(client, /<LiveRegion\b[^>]*\bkey=/su);
});

test("requires all eight internal motion routes and rejects public parallels", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await rm(
    path.join(
      root,
      "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/en/motion/page.tsx",
    ),
  );
  await mkdir(path.join(root, "apps/storefront/src/app/motion"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "apps/storefront/src/app/motion/page.tsx"),
    "export default function Page() { return null; }\n",
  );

  const errors = await validate(root);
  assert.ok(
    errors.some((error) => error.includes("missing motion preview route en")),
  );
  assert.ok(
    errors.some((error) => error.includes("unexpected motion preview route")),
  );
});

test("keeps fixtures explicit, local, fictional and without payment authority", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await replace(
    root,
    "apps/storefront/src/app/ui-motion-specimen.tsx",
    "preview only · no payment proof",
    "production checkout proof",
  );
  await replace(
    root,
    "apps/storefront/src/app/ui-motion-lab.tsx",
    'src: "/ui-motion/fictional-performer-noa-aster.webp"',
    'src: "https://cdn.example.com/celebrity.webp"',
  );

  const errors = await validate(root);
  assert.ok(errors.some((error) => error.includes("preview-only disclaimer")));
  assert.ok(
    errors.some((error) => error.includes("local fictional motion asset")),
  );
  assert.ok(errors.some((error) => error.includes("remote fixture media")));
});

test("rejects heavyweight motion dependencies", async (context) => {
  const validate = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  const manifestPath = path.join(root, "packages/ui/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.dependencies["framer-motion"] = "99.0.0";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const errors = await validate(root);
  assert.ok(
    errors.some((error) => error.includes("heavyweight motion dependency")),
  );
});
