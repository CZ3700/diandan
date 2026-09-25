import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadValidator() {
  let loaded;
  try {
    loaded = await import("./check-ui-primitives.mjs");
  } catch {
    loaded = undefined;
  }

  assert.equal(
    typeof loaded?.validateUiPrimitives,
    "function",
    "UI primitive validator must exist",
  );
  return loaded.validateUiPrimitives;
}

const localeProfiles = Object.freeze({
  en: "latin",
  es: "latin",
  ja: "japanese",
  pt: "latin",
  th: "thai",
  vi: "vietnamese",
  "zh-CN": "simplified-chinese",
  "en-XA": "latin",
});

async function write(root, relativePath, contents) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function replace(root, relativePath, from, to) {
  const absolutePath = path.join(root, relativePath);
  const current = await readFile(absolutePath, "utf8");
  assert.ok(current.includes(from), `${relativePath} must contain test target`);
  await writeFile(absolutePath, current.replace(from, to));
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ui-primitives-"));

  await write(
    root,
    "package.json",
    JSON.stringify({
      devDependencies: {
        "@tailwindcss/postcss": "4.3.3",
        tailwindcss: "4.3.3",
      },
    }),
  );

  await write(
    root,
    "packages/design-tokens/src/tokens.ts",
    `export const DESIGN_TOKEN_CONTRACT = Object.freeze({
  schemaVersion: 1,
  values: Object.freeze({
    "--border-width": "0.0625rem",
    "--color-accent": "#6888bd",
    "--color-border": "#45454d",
    "--color-text": "#f7f4ec",
    "--color-text-muted": "#b8b5ad",
    "--focus-ring-offset": "0.1875rem",
    "--focus-ring-width": "0.125rem",
    "--motion-control-effective": "var(--motion-control)",
    "--motion-fast-effective": "var(--motion-fast)",
    "--radius-control": "0.5rem",
    "--space-1": "0.25rem",
    "--space-2": "0.5rem",
    "--type-body-leading": "1.55",
  }),
});\n`,
  );

  await write(
    root,
    "packages/ui/package.json",
    JSON.stringify({
      name: "@fan-support/ui",
      version: "0.0.0",
      private: true,
      type: "module",
      sideEffects: ["./styles/primitives.css"],
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
        },
        "./client": {
          types: "./dist/client.d.ts",
          import: "./dist/client.js",
        },
        "./primitives.css": "./styles/primitives.css",
      },
      dependencies: {
        "@fan-support/contracts": "workspace:*",
        "class-variance-authority": "0.7.1",
      },
      peerDependencies: { react: "19.2.8" },
      devDependencies: {
        "@types/react": "19.2.18",
        "@types/react-dom": "19.2.5",
        react: "19.2.8",
        "react-dom": "19.2.8",
      },
    }),
  );
  await write(
    root,
    "packages/ui/src/index.ts",
    `export { Button, buttonVariants, type ButtonProps } from "./button.js";
export { Field, type FieldProps } from "./field.js";
export { Icon, type IconProps } from "./icon.js";
export { Link, type LinkProps } from "./link.js";
export { Price, type PriceProps } from "./price.js";
export { Status, type StatusProps } from "./status.js";
export type { MediaProps } from "./media.js";\n`,
  );
  await write(
    root,
    "packages/ui/src/client.ts",
    `"use client";

export { Media, type MediaProps } from "./media.js";
export { Quantity, type QuantityProps } from "./quantity.js";\n`,
  );

  for (const component of [
    "button",
    "field",
    "icon",
    "link",
    "media",
    "price",
    "quantity",
    "status",
  ]) {
    const exportName = `${component[0].toUpperCase()}${component.slice(1)}`;
    await write(
      root,
      `packages/ui/src/${component}.tsx`,
      `export function ${exportName}() { return null; }\nexport type ${exportName}Props = Readonly<Record<string, never>>;\n`,
    );
  }

  await write(
    root,
    "packages/ui/styles/primitives.css",
    `
.fs-button,
.fs-link,
.fs-field__input,
.fs-quantity__button,
.fs-quantity__input {
  @apply inline-flex items-center;
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-control);
  color: var(--color-text);
  transition: transform var(--motion-fast-effective);
}

.fs-button__label,
.fs-link__label,
.fs-price,
.fs-status,
.fs-field__label,
.fs-field__description,
.fs-field__error,
.fs-quantity__label,
.fs-media__fallback {
  color: var(--color-text-muted);
  line-height: var(--type-body-leading);
  overflow-wrap: anywhere;
}

.fs-field__input:hover:not(:disabled) {
  border-color: var(--color-text-muted);
}

.fs-status::before {
  block-size: var(--space-2);
  inline-size: var(--space-2);
  content: "";
}

.fs-button:focus-visible,
.fs-link:focus-visible,
.fs-field__input:focus-visible,
.fs-quantity__button:focus-visible,
.fs-quantity__input:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-accent);
  outline-offset: var(--focus-ring-offset);
}

.fs-button__spinner {
  animation: fs-spin var(--motion-control-effective) linear infinite;
}

.fs-media {
  --fs-media-ratio: 4 / 5;
  aspect-ratio: var(--fs-media-ratio);
}

@keyframes fs-spin {
  to { transform: rotate(1turn); }
}

@media (prefers-reduced-motion: reduce) {
  .fs-button:active { transform: none; }
  .fs-button__spinner { animation: none; }
}
`,
  );

  await write(
    root,
    "apps/storefront/package.json",
    JSON.stringify({
      name: "@fan-support/storefront",
      dependencies: { "@fan-support/ui": "workspace:*" },
    }),
  );
  await write(
    root,
    "apps/storefront/src/app/globals.css",
    '@import "tailwindcss" source(none);\n@import "@fan-support/design-tokens/foundations.css";\n@import "@fan-support/ui/primitives.css";\n',
  );
  await write(
    root,
    "apps/storefront/postcss.config.mjs",
    `const config = { plugins: { "@tailwindcss/postcss": {} } };\nexport default config;\n`,
  );
  await write(
    root,
    "apps/admin/package.json",
    JSON.stringify({
      name: "@fan-support/admin",
      dependencies: { "@fan-support/ui": "workspace:*" },
    }),
  );
  await write(
    root,
    "apps/admin/src/app/globals.css",
    '@import "tailwindcss" source(none);\n@import "@fan-support/design-tokens/foundations.css";\n@import "@fan-support/ui/primitives.css";\n',
  );
  await write(
    root,
    "apps/admin/postcss.config.mjs",
    `const config = { plugins: { "@tailwindcss/postcss": {} } };\nexport default config;\n`,
  );
  await write(
    root,
    "apps/storefront/src/app/ui-primitives-specimen.tsx",
    `import { Icon, Link, Price, Status } from "@fan-support/ui";
import { UiPrimitiveInteractions } from "./ui-primitives-interactions";
import styles from "./ui-primitives-specimen.module.css";

export function UiPrimitivesSpecimen({ locale }: { locale: string }) {
  return <main className={styles["specimen"]} lang={locale === "en-XA" ? "en" : locale}>
    <section className={styles["intro"]}><h1>Primitive fixture</h1></section>
    <Link href="#fixture">Link</Link>
    <Icon label="Fixture icon" />
    <Price currency="USD" locale={locale} minorUnits={1299} />
    <Status>Ready</Status>
    <UiPrimitiveInteractions />
  </main>;
}\n`,
  );
  await write(
    root,
    "apps/storefront/src/app/ui-primitives-specimen.module.css",
    `.specimen {
  padding-inline: var(--space-2);
  color: var(--color-text);
}

.intro h1 {
  color: var(--color-text);
  overflow-wrap: anywhere;
}\n`,
  );
  await write(
    root,
    "apps/storefront/src/app/ui-primitives-interactions.tsx",
    `"use client";

import { Button, Field } from "@fan-support/ui";
import { Media, Quantity } from "@fan-support/ui/client";

export function UiPrimitiveInteractions() {
  return <section>
    <Button disabled>Disabled</Button>
    <Button loading>Loading</Button>
    <Media alt="Fixture media" />
    <Field label="Label" />
    <Quantity label="Quantity" />
    <section dir="rtl">RTL structure smoke</section>
  </section>;
}\n`,
  );

  await write(
    root,
    "apps/storefront/src/design-foundations.ts",
    `export function isDesignFoundationPreviewEnabled(value: unknown): boolean {
  return value === "development" || value === "test" || value === "preview";
}\n`,
  );
  await write(
    root,
    "apps/storefront/src/app/%5Finternal/design-foundations/layout.tsx",
    `import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isDesignFoundationPreviewEnabled } from "../../../design-foundations";
import { loadStorefrontRuntimeConfig } from "../../../server/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

export default function DesignFoundationLayout({ children }: { children: ReactNode }) {
  if (!isDesignFoundationPreviewEnabled(process.env["FAN_SUPPORT_DEPLOYMENT_ENV"])) {
    notFound();
  }
  loadStorefrontRuntimeConfig();
  return children;
}\n`,
  );

  for (const [locale, profile] of Object.entries(localeProfiles)) {
    await write(
      root,
      `apps/storefront/src/app/%5Finternal/design-foundations/(${profile})/${locale}/primitives/page.tsx`,
      `import { UiPrimitivesSpecimen } from "../../../../../ui-primitives-specimen";

export default function UiPrimitivesPage() {
  return <UiPrimitivesSpecimen locale="${locale}" />;
}\n`,
    );
  }

  return root;
}

async function validateFixture(context) {
  const validateUiPrimitives = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  return { root, validateUiPrimitives };
}

function includesError(errors, fragment) {
  assert.ok(
    errors.some((error) => error.includes(fragment)),
    `expected an error containing ${JSON.stringify(fragment)}; got: ${errors.join(" | ")}`,
  );
}

test("accepts the frozen UI primitive package and nested preview fixture", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);

  assert.deepEqual(await validateUiPrimitives(root), []);
});

test("accepts the reviewed P2-03 client-only interaction package additions", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  const manifestPath = "packages/ui/package.json";
  const manifest = JSON.parse(
    await readFile(path.join(root, manifestPath), "utf8"),
  );
  manifest.dependencies["@base-ui/react"] = "1.7.0";
  manifest.exports["./interactions"] = {
    types: "./dist/interactions.d.ts",
    import: "./dist/interactions.js",
  };
  manifest.exports["./interactions.css"] = "./styles/interactions.css";
  manifest.sideEffects = [
    "./styles/interactions.css",
    "./styles/primitives.css",
  ];
  await write(root, manifestPath, JSON.stringify(manifest));
  await write(
    root,
    "packages/ui/src/overlay.tsx",
    '"use client";\nimport { Dialog } from "@base-ui/react/dialog";\nexport const Overlay = Dialog.Root;\n',
  );

  assert.deepEqual(await validateUiPrimitives(root), []);
});

test("requires exact root, client, and CSS package exports", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  const manifestPath = "packages/ui/package.json";
  const manifest = JSON.parse(
    await readFile(path.join(root, manifestPath), "utf8"),
  );
  manifest.exports["./client"].import = "./dist/browser.js";
  manifest.exports["./theme.css"] = "./styles/primitives.css";
  delete manifest.exports["./primitives.css"];
  await write(root, manifestPath, JSON.stringify(manifest));

  const errors = await validateUiPrimitives(root);
  includesError(errors, "exact package export ./client");
  includesError(errors, "exact package export ./primitives.css");
  includesError(errors, "unexpected public export ./theme.css");
});

test("keeps client primitives out of the server-compatible root", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await write(
    root,
    "packages/ui/src/index.ts",
    `"use client";\nexport { Button } from "./button.js";\nexport { Media } from "./media.js";\n`,
  );

  const errors = await validateUiPrimitives(root);
  includesError(errors, "server-compatible root must not contain use client");
  includesError(errors, "root must value-export Field");
  includesError(errors, "root must not value-export Media");
});

test("requires a client directive and limits the client entry to Media and Quantity", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await write(
    root,
    "packages/ui/src/client.ts",
    `export { Media } from "./media.js";\nexport { Button } from "./button.js";\n`,
  );

  const errors = await validateUiPrimitives(root);
  includesError(errors, "client entry must begin with use client");
  includesError(errors, "client entry must value-export Quantity");
  includesError(errors, "client entry must not value-export Button");
});

test("rejects premature component exports from either public entry", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/src/client.ts",
    'export { Quantity, type QuantityProps } from "./quantity.js";',
    'export { Quantity, type QuantityProps } from "./quantity.js";\nexport const Dialog = () => null;',
  );

  includesError(
    await validateUiPrimitives(root),
    "client entry has unexpected public value Dialog",
  );
});

test("rejects a server entry that reaches a client-only module indirectly", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/src/field.tsx",
    "export function Field()",
    'import { Media } from "./media.js";\nexport function Field()',
  );

  const errors = await validateUiPrimitives(root);
  includesError(errors, "server export graph reaches client-only module media");
});

test("rejects dynamic client-only imports in the server export graph", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/src/field.tsx",
    "export function Field()",
    'void import("./media.js");\nexport function Field()',
  );

  includesError(
    await validateUiPrimitives(root),
    "server export graph reaches client-only module media",
  );
});

test("enforces the UI dependency allowlist and exact source protocols", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  const manifestPath = "packages/ui/package.json";
  const manifest = JSON.parse(
    await readFile(path.join(root, manifestPath), "utf8"),
  );
  manifest.dependencies.react = "npm:preact@10.0.0";
  manifest.dependencies["left-pad"] = "1.3.0";
  manifest.dependencies["@fan-support/contracts"] = "file:../contracts";
  await write(root, manifestPath, JSON.stringify(manifest));

  const errors = await validateUiPrimitives(root);
  includesError(errors, "dependencies may contain only");
  includesError(errors, "@fan-support/contracts must be workspace:*");
  includesError(errors, "npm aliases and non-registry protocols are forbidden");
});

test("rejects production source imports outside the dependency allowlist", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/src/icon.tsx",
    "export function Icon()",
    'import Image from "next/image";\nexport function Icon()',
  );

  includesError(
    await validateUiPrimitives(root),
    "production source dependency next is outside the UI allowlist",
  );
});

test("requires explicit CSS export, side effect declaration, and Storefront consumption", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  const manifestPath = "packages/ui/package.json";
  const manifest = JSON.parse(
    await readFile(path.join(root, manifestPath), "utf8"),
  );
  manifest.sideEffects = false;
  await write(root, manifestPath, JSON.stringify(manifest));
  await write(
    root,
    "apps/storefront/src/app/globals.css",
    "body { margin: 0; }\n",
  );
  const storefrontPath = "apps/storefront/package.json";
  const storefront = JSON.parse(
    await readFile(path.join(root, storefrontPath), "utf8"),
  );
  delete storefront.dependencies["@fan-support/ui"];
  await write(root, storefrontPath, JSON.stringify(storefront));

  const errors = await validateUiPrimitives(root);
  includesError(
    errors,
    "sideEffects must explicitly list ./styles/primitives.css",
  );
  includesError(
    errors,
    "Storefront must depend on @fan-support/ui via workspace:*",
  );
  includesError(
    errors,
    "Storefront must import @fan-support/ui/primitives.css",
  );
});

test("requires Admin to consume the same explicit UI CSS export", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await write(root, "apps/admin/src/app/globals.css", "body { margin: 0; }\n");
  const adminPath = "apps/admin/package.json";
  const admin = JSON.parse(await readFile(path.join(root, adminPath), "utf8"));
  delete admin.dependencies["@fan-support/ui"];
  await write(root, adminPath, JSON.stringify(admin));

  const errors = await validateUiPrimitives(root);
  includesError(errors, "Admin must depend on @fan-support/ui via workspace:*");
  includesError(errors, "Admin must import @fan-support/ui/primitives.css");
});

test("locks Tailwind and PostCSS wiring for both application CSS pipelines", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  const rootManifestPath = "package.json";
  const rootManifest = JSON.parse(
    await readFile(path.join(root, rootManifestPath), "utf8"),
  );
  rootManifest.devDependencies.tailwindcss = "^4.3.3";
  delete rootManifest.devDependencies["@tailwindcss/postcss"];
  await write(root, rootManifestPath, JSON.stringify(rootManifest));
  await write(
    root,
    "apps/admin/postcss.config.mjs",
    `const config = { plugins: {} };
// plugins: { "@tailwindcss/postcss": {} }
export default config;\n`,
  );
  await replace(
    root,
    "apps/storefront/src/app/globals.css",
    '@import "tailwindcss" source(none);\n',
    "",
  );
  await replace(
    root,
    "packages/ui/styles/primitives.css",
    "  @apply inline-flex items-center;\n",
    "",
  );

  const errors = await validateUiPrimitives(root);
  includesError(errors, "root must pin tailwindcss to 4.3.3");
  includesError(errors, "root must pin @tailwindcss/postcss to 4.3.3");
  includesError(
    errors,
    "Admin PostCSS config must enable @tailwindcss/postcss",
  );
  includesError(
    errors,
    "Storefront globals.css must explicitly import tailwindcss",
  );
  includesError(errors, "primitives.css must contain a structural @apply rule");
});

test("rejects fixed sizing and truncation on critical translated text", async (context) => {
  const cases = [
    "block-size: var(--space-2);",
    "height: var(--space-2);",
    "max-block-size: var(--space-2);",
    "max-height: var(--space-2);",
    "text-overflow: ellipsis;",
    "line-clamp: 2;",
    "-webkit-line-clamp: 2;",
    "white-space: nowrap;",
  ];

  for (const declaration of cases) {
    await context.test(declaration, async (subContext) => {
      const { root, validateUiPrimitives } = await validateFixture(subContext);
      await replace(
        root,
        "packages/ui/styles/primitives.css",
        "overflow-wrap: anywhere;",
        `${declaration}\n  overflow-wrap: anywhere;`,
      );

      includesError(
        await validateUiPrimitives(root),
        "critical translated text must not use",
      );
    });
  }
});

test("rejects truncation even when a new selector is not yet classified", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/primitives.css",
    ".fs-media {",
    ".fs-unclassified-copy { white-space: nowrap; }\n\n.fs-media {",
  );

  includesError(
    await validateUiPrimitives(root),
    "critical translated text must not use white-space",
  );
});

test("rejects physical-direction CSS that breaks RTL structure", async (context) => {
  const cases = [
    "margin-left: var(--space-1);",
    "padding-right: var(--space-1);",
    "border-left: var(--border-width) solid var(--color-border);",
    "right: var(--space-1);",
    "text-align: right;",
  ];

  for (const declaration of cases) {
    await context.test(declaration, async (subContext) => {
      const { root, validateUiPrimitives } = await validateFixture(subContext);
      await replace(
        root,
        "packages/ui/styles/primitives.css",
        "color: var(--color-text);",
        `${declaration}\n  color: var(--color-text);`,
      );

      includesError(
        await validateUiPrimitives(root),
        "physical-direction property is forbidden",
      );
    });
  }
});

test("rejects CSS variable references that are neither tokens nor locally declared", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/primitives.css",
    "color: var(--color-text);",
    "color: var(--missing-ui-token);",
  );

  includesError(
    await validateUiPrimitives(root),
    "unknown CSS variable --missing-ui-token",
  );
});

test("applies text, RTL, and token policies to the preview stylesheet", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await write(
    root,
    "apps/storefront/src/app/ui-primitives-specimen.module.css",
    `.specimen {
  margin-left: var(--space-2);
  color: var(--unknown-preview-token);
}
.intro h1 {
  max-block-size: var(--space-2);
  text-overflow: ellipsis;
}\n`,
  );

  const errors = await validateUiPrimitives(root);
  includesError(errors, "physical-direction property is forbidden");
  includesError(errors, "unknown CSS variable --unknown-preview-token");
  includesError(errors, "critical translated text must not use max-block-size");
  includesError(errors, "critical translated text must not use text-overflow");
});

test("requires visible focus treatment for every interactive primitive", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/primitives.css",
    ".fs-link:focus-visible,",
    ".fs-link:focus,",
  );

  includesError(
    await validateUiPrimitives(root),
    "Link must have a :focus-visible rule",
  );
});

test("requires Field hover feedback to differ from its default boundary", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/primitives.css",
    "border-color: var(--color-text-muted);",
    "border-color: var(--color-border);",
  );

  includesError(
    await validateUiPrimitives(root),
    "Field hover boundary must differ from its default boundary",
  );
});

test("rejects focus-visible rules that suppress the visible indicator", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/primitives.css",
    "outline: var(--focus-ring-width) solid var(--color-accent);",
    "outline: none;",
  );

  includesError(
    await validateUiPrimitives(root),
    "focus-visible rule must provide a visible outline or box-shadow",
  );
});

test("requires a reduced-motion override for movement and loading animation", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/primitives.css",
    "@media (prefers-reduced-motion: reduce)",
    "@media (prefers-reduced-motion: no-preference)",
  );

  includesError(
    await validateUiPrimitives(root),
    "must include a prefers-reduced-motion: reduce override",
  );
});

test("requires effective motion tokens outside the reduced-motion override", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/primitives.css",
    "var(--motion-fast-effective)",
    "var(--motion-fast)",
  );

  const errors = await validateUiPrimitives(root);
  includesError(errors, "unknown CSS variable --motion-fast");
  includesError(errors, "motion declarations must use effective motion tokens");
});

test("requires exactly eight nested locale preview pages", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await rm(
    path.join(
      root,
      "apps/storefront/src/app/%5Finternal/design-foundations/(thai)/th/primitives/page.tsx",
    ),
  );
  await write(
    root,
    "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/fr/primitives/page.tsx",
    'export default function Page() { return <UiPrimitivesSpecimen locale="fr" />; }\n',
  );

  const errors = await validateUiPrimitives(root);
  includesError(errors, "missing preview fixture th");
  includesError(errors, "unexpected UI primitive preview page");
});

test("requires each preview page to render the matching locale fixture", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/es/primitives/page.tsx",
    'locale="es"',
    'locale="en"',
  );

  includesError(
    await validateUiPrimitives(root),
    'preview fixture es must render UiPrimitivesSpecimen with locale="es"',
  );
});

test("rejects a parallel preview root that bypasses inherited gates and fonts", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await write(
    root,
    "apps/storefront/src/app/%5Finternal/ui-primitives/en/page.tsx",
    'export default function Page() { return <UiPrimitivesSpecimen locale="en" />; }\n',
  );

  includesError(
    await validateUiPrimitives(root),
    "UI primitive previews must inherit the design-foundations gate",
  );
});

test("requires the specimen to exercise client exports, disabled/loading, and RTL", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "apps/storefront/src/app/ui-primitives-interactions.tsx",
    'import { Media, Quantity } from "@fan-support/ui/client";',
    'import { Media } from "@fan-support/ui/client";',
  );
  await replace(
    root,
    "apps/storefront/src/app/ui-primitives-interactions.tsx",
    "<Button loading>Loading</Button>",
    "<Button>Loading</Button>",
  );
  await replace(
    root,
    "apps/storefront/src/app/ui-primitives-interactions.tsx",
    '<section dir="rtl">',
    "<section>",
  );

  const errors = await validateUiPrimitives(root);
  includesError(
    errors,
    "specimen must import Quantity from @fan-support/ui/client",
  );
  includesError(errors, "specimen must include a loading state");
  includesError(errors, 'specimen must include an explicit dir="rtl" smoke');
});

test("keeps the preview shell server-compatible and isolates interactions", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "apps/storefront/src/app/ui-primitives-specimen.tsx",
    'import { Icon, Link, Price, Status } from "@fan-support/ui";',
    `"use client";\nimport { Icon, Link, Price, Status } from "@fan-support/ui";`,
  );
  await replace(
    root,
    "apps/storefront/src/app/ui-primitives-interactions.tsx",
    '"use client";',
    "",
  );

  const errors = await validateUiPrimitives(root);
  includesError(errors, "preview specimen must remain server-compatible");
  includesError(errors, "preview interactions must begin with use client");
});

test("requires the server specimen to consume its scoped stylesheet", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "apps/storefront/src/app/ui-primitives-specimen.tsx",
    'import styles from "./ui-primitives-specimen.module.css";\n',
    "",
  );

  includesError(
    await validateUiPrimitives(root),
    "preview specimen must consume ./ui-primitives-specimen.module.css",
  );
});

test("requires the inherited preview layout to remain noindex and fail closed", async (context) => {
  const { root, validateUiPrimitives } = await validateFixture(context);
  await replace(
    root,
    "apps/storefront/src/design-foundations.ts",
    'value === "preview"',
    'value === "preview" || value === "staging"',
  );
  await replace(
    root,
    "apps/storefront/src/app/%5Finternal/design-foundations/layout.tsx",
    "robots: { follow: false, index: false }",
    "robots: { follow: true, index: true }",
  );
  await replace(
    root,
    "apps/storefront/src/app/%5Finternal/design-foundations/layout.tsx",
    "  loadStorefrontRuntimeConfig();\n  return children;",
    "  return children;\n  loadStorefrontRuntimeConfig();",
  );

  const errors = await validateUiPrimitives(root);
  includesError(
    errors,
    "preview helper must allow exactly development, test, and preview",
  );
  includesError(errors, "inherited preview layout must be noindex,nofollow");
  includesError(
    errors,
    "preview gate must run before runtime config and rendering",
  );
});
