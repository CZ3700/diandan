import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import postcss from "postcss";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const pluginPath = path.join(
  workspaceRoot,
  "apps/storefront/postcss-font-display-optional/index.cjs",
);

async function loadPlugin() {
  const loaded = await import(pathToFileURL(pluginPath).href);
  assert.equal(typeof loaded.default, "function");
  return loaded.default;
}

test("rewrites only swap descriptors inside font-face rules", async () => {
  const createPlugin = await loadPlugin();
  const input = `
@font-face {
  font-family: "Example";
  font-display: swap;
  src: url(example.woff2) format("woff2");
}
@font-face {
  font-family: "Already stable";
  font-display: optional;
  src: url(stable.woff2) format("woff2");
}
.example { font-display: swap; }
`;

  const result = await postcss([createPlugin()]).process(input, {
    from: undefined,
  });

  assert.equal(result.css.match(/font-display: optional/gu)?.length, 2);
  assert.match(result.css, /\.example \{ font-display: swap; \}/u);
});

test("stabilizes every self-hosted variable-font profile", async () => {
  const createPlugin = await loadPlugin();
  const packages = [
    "manrope",
    "noto-sans",
    "noto-sans-jp",
    "noto-sans-sc",
    "noto-sans-thai",
  ];

  for (const packageName of packages) {
    const source = await readFile(
      path.join(
        workspaceRoot,
        "packages/design-tokens/node_modules/@fontsource-variable",
        packageName,
        "wght.css",
      ),
      "utf8",
    );
    const originalFaceCount = source.match(/@font-face/gu)?.length ?? 0;
    const result = await postcss([createPlugin()]).process(source, {
      from: undefined,
    });

    assert.ok(originalFaceCount > 0, `${packageName} must define font faces`);
    assert.doesNotMatch(result.css, /font-display:\s*swap/iu);
    assert.equal(
      result.css.match(/font-display:\s*optional/giu)?.length,
      originalFaceCount,
      `${packageName} must make every font face layout-stable`,
    );
  }
});

test("storefront enables the font policy before Tailwind processing", async () => {
  const configUrl = pathToFileURL(
    path.join(workspaceRoot, "apps/storefront/postcss.config.mjs"),
  );
  configUrl.searchParams.set("test", String(Date.now()));
  const { default: config } = await import(configUrl.href);

  assert.deepEqual(Object.keys(config.plugins), [
    "fan-support-postcss-font-display-optional",
    "@tailwindcss/postcss",
  ]);
});
