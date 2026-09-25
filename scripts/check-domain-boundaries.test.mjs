import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateDomainBoundaries } from "./check-domain-boundaries.mjs";

async function fixture(source = "export const value = 1;\n") {
  const root = await mkdtemp(path.join(os.tmpdir(), "domain-boundary-"));
  await mkdir(path.join(root, "packages/domain/src/test-support"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        check:
          "node --test ./scripts/check-domain-boundaries.test.mjs && node ./scripts/check-domain-boundaries.mjs",
      },
      devDependencies: { "@vitest/coverage-v8": "4.1.11" },
    }),
  );
  await writeFile(
    path.join(root, "packages/domain/package.json"),
    JSON.stringify({
      scripts: { test: "vitest run --coverage" },
      dependencies: { "@fan-support/contracts": "workspace:*" },
      devDependencies: { "fast-check": "4.9.0" },
    }),
  );
  await writeFile(
    path.join(root, "vitest.config.ts"),
    'defineConfig({test:{coverage:{provider:"v8",include:["src/**/*.ts"],exclude:["src/**/*.{test,spec}.{ts,tsx}","src/test-support/**"],reporter:["text","json-summary"],thresholds:{branches:90}}}});\n',
  );
  await writeFile(path.join(root, "packages/domain/src/value.ts"), source);
  return root;
}

test("accepts the minimal pure domain boundary", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await validateDomainBoundaries(root), []);
});

test("rejects framework imports, non-literal dynamic imports, and environment globals", async (context) => {
  const root = await fixture(
    'import "@nestjs/common";\nconst target = "drizzle-orm";\nvoid import(target);\nvoid fetch("https://invalid.example");\nMath.random();\ncrypto.randomUUID();\nDate.now();\nDate();\nperformance.now();\n',
  );
  context.after(() => rm(root, { recursive: true, force: true }));
  const errors = await validateDomainBoundaries(root);
  assert.ok(errors.some((error) => error.includes("@nestjs/common")));
  assert.ok(
    errors.some((error) => error.includes("non-literal dynamic import")),
  );
  for (const forbidden of [
    "fetch",
    "Math.random",
    "crypto.randomUUID",
    "Date.now",
    "Date()",
    "performance.now",
  ]) {
    assert.ok(errors.some((error) => error.includes(forbidden)));
  }
});

test("rejects computed access to environment, clock, and random globals", async (context) => {
  const root = await fixture(
    'globalThis["fetch"]("https://invalid.example");\nMath["random"]();\nglobalThis["Math"]["random"]();\nDate["now"]();\nglobalThis["Date"]["now"]();\nglobalThis["crypto"]["randomUUID"]();\nglobalThis["performance"]["now"]();\nnew globalThis["WebSocket"]("wss://invalid.example");\nsetTimeout(() => {}, 1);\nglobalThis["setInterval"](() => {}, 1);\n',
  );
  context.after(() => rm(root, { recursive: true, force: true }));
  const errors = await validateDomainBoundaries(root);
  for (const forbidden of [
    "globalThis.fetch",
    "Math.random",
    "globalThis.Math.random",
    "Date.now",
    "globalThis.Date.now",
    "globalThis.crypto.randomUUID",
    "globalThis.performance.now",
    "globalThis.WebSocket",
    "setTimeout",
    "globalThis.setInterval",
  ]) {
    assert.ok(errors.some((error) => error.includes(forbidden)));
  }
});

test("rejects const-computed and aliased implicit sources", async (context) => {
  const root = await fixture(
    'const fetchKey = "fetch";\nglobalThis[fetchKey]("https://invalid.example");\nconst nowKey = `now`;\nDate[nowKey]();\nconst environment = globalThis;\nenvironment[fetchKey]("https://invalid.example");\nconst clock = Date;\nclock[nowKey]();\nconst randomSource = Math;\nconst random = randomSource["random"];\nrandom();\nconst { randomUUID: uuid } = crypto;\nuuid();\n',
  );
  context.after(() => rm(root, { recursive: true, force: true }));
  const errors = await validateDomainBoundaries(root);
  for (const forbidden of [
    "globalThis.fetch",
    "Date.now",
    "Math.random",
    "crypto.randomUUID",
  ]) {
    assert.ok(
      errors.some((error) => error.includes(forbidden)),
      `expected ${forbidden} to be rejected, got ${errors.join(" | ")}`,
    );
  }
});

test("allows computed access on local domain objects", async (context) => {
  const root = await fixture(
    'const field = "now";\nconst schedule = { now: 42, fetch: "stored" };\nexport const value = schedule[field] + schedule.fetch.length;\n',
  );
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await validateDomainBoundaries(root), []);
});

test("terminates analysis for cyclic const aliases", async (context) => {
  const root = await fixture(
    "const first = second.value;\nconst second = first.value;\nexport const value = 1;\n",
  );
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await validateDomainBoundaries(root), []);
});

test("rejects relative escapes and source cycles", async (context) => {
  const root = await fixture('export { b } from "./b.js";\n');
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "packages/domain/src/b.ts"),
    'export { value as b } from "./value.js";\n',
  );
  await writeFile(
    path.join(root, "packages/domain/src/escape.ts"),
    'export * from "../../../outside.js";\n',
  );
  const errors = await validateDomainBoundaries(root);
  assert.ok(errors.some((error) => error.includes("escapes domain source")));
  assert.ok(errors.some((error) => error.includes("dependency cycle")));
});

test("rejects weakened coverage and manifest wiring", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: { check: "node ./scripts/check-domain-boundaries.mjs" },
      devDependencies: { "@vitest/coverage-v8": "4.1.11" },
    }),
  );
  await writeFile(
    path.join(root, "vitest.config.ts"),
    'defineConfig({test:{coverage:{provider:"v8",include:["src/**/*.ts"],thresholds:{branches:89}}}});\n',
  );
  const errors = await validateDomainBoundaries(root);
  assert.ok(errors.some((error) => error.includes("branch threshold")));
  assert.ok(errors.some((error) => error.includes("test-support")));
  assert.ok(errors.some((error) => error.includes("boundary self-test")));
});
