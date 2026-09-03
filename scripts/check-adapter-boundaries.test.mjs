import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadValidator() {
  let loaded;
  try {
    loaded = await import("./check-adapter-boundaries.mjs");
  } catch {
    loaded = undefined;
  }

  assert.equal(
    typeof loaded?.validateAdapterBoundaries,
    "function",
    "adapter boundary validator must exist",
  );
  return loaded.validateAdapterBoundaries;
}

async function write(root, relativePath, contents) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function writePackageManifest(
  root,
  directoryName,
  packageName,
  extra = {},
) {
  await write(
    root,
    `packages/${directoryName}/package.json`,
    JSON.stringify({ name: packageName, ...extra }),
  );
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "adapter-boundary-"));
  await write(
    root,
    "package.json",
    JSON.stringify({
      scripts: {
        check:
          "node --test ./scripts/check-adapter-boundaries.test.mjs && turbo run build && node ./scripts/check-adapter-boundaries.mjs",
      },
    }),
  );
  await writePackageManifest(root, "domain", "@fan-support/domain");
  await write(
    root,
    "packages/domain/src/index.ts",
    'export type DomainId = string & { readonly __brand: "DomainId" };\n',
  );
  await write(
    root,
    "packages/domain/dist/index.d.ts",
    'export type DomainId = string & { readonly __brand: "DomainId" };\n',
  );
  await write(
    root,
    "packages/media-port/src/index.ts",
    "export interface MediaPort { put(key: string): Promise<void>; }\n",
  );
  await writePackageManifest(root, "media-port", "@fan-support/media-port");
  await write(
    root,
    "packages/media-port/dist/index.d.ts",
    "export interface MediaPort { put(key: string): Promise<void>; }\n",
  );
  await write(
    root,
    "packages/media-s3/src/index.ts",
    'export { createMediaAdapter } from "./public.js";\n',
  );
  await writePackageManifest(root, "media-s3", "@fan-support/media-s3", {
    dependencies: { "@aws-sdk/client-s3": "3.1119.0" },
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    },
  });
  await write(
    root,
    "packages/media-s3/src/client.ts",
    'import { S3Client } from "@aws-sdk/client-s3";\nexport const client = new S3Client({});\n',
  );
  await write(
    root,
    "packages/media-s3/dist/index.d.ts",
    'export { createMediaAdapter } from "./public.js";\n',
  );
  await write(
    root,
    "packages/media-s3/dist/public.d.ts",
    "export declare function createMediaAdapter(): { put(key: string): Promise<void> };\n",
  );
  await write(
    root,
    "packages/media-s3/dist/client.d.ts",
    'import type { S3Client } from "@aws-sdk/client-s3";\nexport declare const client: S3Client;\n',
  );
  return root;
}

test("accepts pure inner layers and ignores private adapter declarations", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));

  assert.deepEqual(await validateAdapterBoundaries(root), []);
});

test("rejects provider imports from inner-layer source", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/domain/src/forbidden.ts",
    'import type { Client } from "pg";\nexport * from "drizzle-orm/pg-core";\nconst sdk = require("@aws-sdk/client-s3");\nvoid import("openid-client");\nexport { sdk };\n',
  );

  const errors = await validateAdapterBoundaries(root);
  for (const provider of [
    "pg",
    "drizzle-orm/pg-core",
    "@aws-sdk/client-s3",
    "openid-client",
  ]) {
    assert.ok(
      errors.some((error) => error.includes(provider)),
      `expected ${provider} to be rejected: ${errors.join(" | ")}`,
    );
  }
});

test("rejects relative imports that escape an inner package into an adapter", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/domain/src/adapter-leak.ts",
    'export type AdapterClient = import("../../media-s3/dist/client.js").client;\n',
  );
  await write(
    root,
    "packages/media-port/dist/adapter-leak.d.ts",
    'export type AdapterClient = import("../../media-s3/dist/client.js").client;\n',
  );

  const errors = await validateAdapterBoundaries(root);
  for (const declaration of [
    "packages/domain/src/adapter-leak.ts",
    "packages/media-port/dist/adapter-leak.d.ts",
  ]) {
    assert.ok(
      errors.some(
        (error) =>
          error.includes(declaration) &&
          error.includes("escapes inner-layer package"),
      ),
      `expected adapter escape from ${declaration} to be rejected: ${errors.join(" | ")}`,
    );
  }
});

test("rejects absolute filesystem imports from an inner package", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/domain/src/absolute-leak.ts",
    'export type AbsoluteLeak = import("/tmp/provider-adapter.js").Client;\n',
  );

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/domain/src/absolute-leak.ts") &&
        error.includes("absolute filesystem import"),
    ),
    `expected absolute import to be rejected: ${errors.join(" | ")}`,
  );
});

test("allows relative imports that stay inside an inner package", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/domain/src/index.ts",
    'export type { Local } from "./local.js";\n',
  );
  await write(
    root,
    "packages/domain/src/local.ts",
    "export type Local = string;\n",
  );
  await write(
    root,
    "packages/domain/dist/index.d.ts",
    'export type { Local } from "./local.js";\n',
  );
  await write(
    root,
    "packages/domain/dist/local.d.ts",
    "export type Local = string;\n",
  );

  assert.deepEqual(await validateAdapterBoundaries(root), []);
});

test("rejects provider imports from non-port domain modules", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(root, "contracts", "@fan-support/contracts");
  await write(
    root,
    "packages/contracts/src/index.ts",
    'export type Database = import("drizzle-orm").DrizzleD1Database;\n',
  );
  await write(
    root,
    "packages/contracts/dist/index.d.ts",
    "export type ContractId = string;\n",
  );

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/contracts/src/index.ts") &&
        error.includes("drizzle-orm"),
    ),
  );
});

test("rejects provider dependencies declared by inner packages", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(root, "domain", "@fan-support/domain", {
    dependencies: { pg: "8.23.0" },
  });

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/domain/package.json") && error.includes("pg"),
    ),
  );
});

test("rejects known adapter imports and dependencies from inner-layer packages", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(root, "domain", "@fan-support/domain", {
    dependencies: { "@fan-support/media-s3": "workspace:*" },
  });
  await write(
    root,
    "packages/domain/src/adapter-package-leak.ts",
    'export type Adapter = import("@fan-support/media-s3").MediaAdapter;\n',
  );

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/domain/package.json") &&
        error.includes("@fan-support/media-s3"),
    ),
    `expected adapter dependency to be rejected: ${errors.join(" | ")}`,
  );
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/domain/src/adapter-package-leak.ts") &&
        error.includes("@fan-support/media-s3"),
    ),
    `expected adapter import to be rejected: ${errors.join(" | ")}`,
  );
});

test("allows real inner workspace dependencies and rejects invented workspace names", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(root, "domain", "@fan-support/domain", {
    dependencies: {
      "@fan-support/media-port": "workspace:*",
      "@fan-support/not-a-workspace-package": "workspace:*",
    },
  });
  await write(
    root,
    "packages/domain/src/workspace.ts",
    'import type { MediaPort } from "@fan-support/media-port";\nexport type ValidPort = MediaPort;\nexport type FakePort = import("@fan-support/not-a-workspace-package").Port;\n',
  );

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some((error) =>
      error.includes("@fan-support/not-a-workspace-package"),
    ),
    `expected invented workspace package to be rejected: ${errors.join(" | ")}`,
  );
  assert.ok(
    !errors.some(
      (error) =>
        error.includes("forbidden provider") &&
        error.includes("@fan-support/media-port"),
    ),
    `expected real inner package to remain allowed: ${errors.join(" | ")}`,
  );
});

test("rejects unreviewed DefinitelyTyped packages from inner layers", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(root, "domain", "@fan-support/domain", {
    devDependencies: { "@types/stripe": "8.0.0" },
  });

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some((error) => error.includes("@types/stripe")),
    `expected unreviewed @types package to be rejected: ${errors.join(" | ")}`,
  );
});

test("rejects an unreviewed supplier SDK even when it is not hard-coded", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(root, "domain", "@fan-support/domain", {
    dependencies: { stripe: "20.0.0" },
  });
  await write(
    root,
    "packages/domain/src/stripe.ts",
    'export type StripeEvent = import("stripe").Stripe.Event;\n',
  );

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some((error) => error.includes("stripe")),
    `expected unreviewed supplier dependency to be rejected: ${errors.join(" | ")}`,
  );
});

test("rejects unscoped and scoped supplier targets hidden behind npm aliases", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(root, "domain", "@fan-support/domain", {
    dependencies: {
      zod: "npm:stripe@20.0.0",
      "fast-check": "npm:@aws-sdk/client-s3@3.1119.0",
    },
  });

  const errors = await validateAdapterBoundaries(root);
  for (const provider of ["stripe", "@aws-sdk/client-s3"]) {
    assert.ok(
      errors.some(
        (error) => error.includes("npm alias") && error.includes(provider),
      ),
      `expected npm alias target ${provider} to be rejected: ${errors.join(" | ")}`,
    );
  }
});

test("rejects malformed npm aliases instead of silently accepting them", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(root, "domain", "@fan-support/domain", {
    dependencies: { zod: "npm:@scope" },
  });

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/domain/package.json") &&
        error.includes("malformed npm alias"),
    ),
    `expected malformed alias to fail closed: ${errors.join(" | ")}`,
  );
});

test("rejects provider imports from emitted inner-layer declarations", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/media-port/dist/index.d.ts",
    'export type ProviderConfig = import("@aws-sdk/client-s3").S3ClientConfig;\n',
  );

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/media-port/dist/index.d.ts") &&
        error.includes("@aws-sdk/client-s3"),
    ),
  );
});

test("rejects provider types through a transitive adapter root export", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/media-s3/dist/public.d.ts",
    'export type { AdapterOptions } from "./options.js";\n',
  );
  await write(
    root,
    "packages/media-s3/dist/options.d.ts",
    'import type { S3ClientConfig } from "@aws-sdk/client-s3";\nexport type AdapterOptions = S3ClientConfig;\n',
  );

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/media-s3/dist/options.d.ts") &&
        error.includes("@aws-sdk/client-s3"),
    ),
  );
});

test("follows triple-slash path references from public adapter declarations", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/media-s3/dist/public.d.ts",
    '/// <reference path="./provider-reference.d.ts" />\nexport declare const safe: true;\n',
  );
  await write(
    root,
    "packages/media-s3/dist/provider-reference.d.ts",
    'export type ProviderReference = import("@aws-sdk/client-s3").S3Client;\n',
  );

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("provider-reference.d.ts") &&
        error.includes("@aws-sdk/client-s3"),
    ),
    `expected triple-slash declaration leak to be rejected: ${errors.join(" | ")}`,
  );
});

test("checks direct declaration exports and typesVersions targets", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(root, "media-s3", "@fan-support/media-s3", {
    dependencies: { "@aws-sdk/client-s3": "3.1119.0" },
    exports: {
      ".": "./dist/direct.d.ts",
    },
    typesVersions: {
      "*": {
        legacy: ["./dist/legacy.d.ts"],
      },
    },
  });
  await write(
    root,
    "packages/media-s3/dist/direct.d.ts",
    'export type DirectLeak = import("stripe").StripeClient;\n',
  );
  await write(
    root,
    "packages/media-s3/dist/legacy.d.ts",
    'export type LegacyLeak = import("openid-client").Configuration;\n',
  );

  const errors = await validateAdapterBoundaries(root);
  for (const declaration of ["direct.d.ts", "legacy.d.ts"]) {
    assert.ok(
      errors.some((error) => error.includes(declaration)),
      `expected ${declaration} to be checked: ${errors.join(" | ")}`,
    );
  }
});

test("checks every nested exports types target including public subpaths and arrays", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(root, "media-s3", "@fan-support/media-s3", {
    dependencies: { "@aws-sdk/client-s3": "3.1119.0" },
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
      "./raw": [
        {
          browser: {
            types: ["./dist/raw-browser.d.ts"],
          },
        },
        {
          types: "./dist/raw.d.ts",
        },
      ],
    },
  });
  await write(
    root,
    "packages/media-s3/dist/raw-browser.d.ts",
    'export type BrowserRawClient = import("stripe").StripeClient;\n',
  );
  await write(
    root,
    "packages/media-s3/dist/raw.d.ts",
    'export type RawClient = import("@aws-sdk/client-s3").S3Client;\n',
  );

  const errors = await validateAdapterBoundaries(root);
  for (const declaration of ["raw-browser.d.ts", "raw.d.ts"]) {
    assert.ok(
      errors.some((error) => error.includes(declaration)),
      `expected ${declaration} public type root to be checked: ${errors.join(" | ")}`,
    );
  }
});

test("checks both package types and typings declaration roots", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(root, "media-s3", "@fan-support/media-s3", {
    dependencies: { "@aws-sdk/client-s3": "3.1119.0" },
    types: "./dist/public-types.d.ts",
    typings: "./dist/public-typings.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    },
  });
  await write(
    root,
    "packages/media-s3/dist/public-types.d.ts",
    'export type PublicTypes = import("stripe").StripeClient;\n',
  );
  await write(
    root,
    "packages/media-s3/dist/public-typings.d.ts",
    'export type PublicTypings = import("openid-client").Configuration;\n',
  );

  const errors = await validateAdapterBoundaries(root);
  for (const declaration of ["public-types.d.ts", "public-typings.d.ts"]) {
    assert.ok(
      errors.some((error) => error.includes(declaration)),
      `expected ${declaration} public type root to be checked: ${errors.join(" | ")}`,
    );
  }
});

test("rejects malformed or package-escaping public types targets", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(root, "media-s3", "@fan-support/media-s3", {
    dependencies: { "@aws-sdk/client-s3": "3.1119.0" },
    types: "../outside.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
      "./malformed": {
        types: [42],
      },
      "./escape": {
        types: "./dist/../../../outside.d.ts",
      },
    },
  });
  await write(
    root,
    "outside.d.ts",
    'export type Outside = import("stripe").StripeClient;\n',
  );

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some((error) => error.includes("malformed public types target")),
    `expected malformed public target to fail closed: ${errors.join(" | ")}`,
  );
  assert.ok(
    errors.filter((error) => error.includes("escapes adapter package"))
      .length >= 2,
    `expected both escaping public targets to be rejected: ${errors.join(" | ")}`,
  );
  assert.ok(
    !errors.some(
      (error) => error.includes("outside.d.ts") && error.includes("stripe"),
    ),
    `outside declarations must not be traversed: ${errors.join(" | ")}`,
  );
});

test("rejects provider types through a workspace adapter re-export", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePackageManifest(
    root,
    "identity-oidc",
    "@fan-support/identity-oidc",
    { dependencies: { "openid-client": "6.8.1" } },
  );
  await write(
    root,
    "packages/identity-oidc/src/index.ts",
    "export const workspacePackageName = '@fan-support/identity-oidc';\n",
  );
  await write(
    root,
    "packages/identity-oidc/dist/index.d.ts",
    "export declare const workspacePackageName: string;\n",
  );
  await write(
    root,
    "packages/identity-oidc/dist/provider.d.ts",
    'export type ProviderThing = import("openid-client").Configuration;\n',
  );
  await write(
    root,
    "packages/media-s3/dist/index.d.ts",
    'export type { ProviderThing } from "@fan-support/identity-oidc/provider";\n',
  );

  const errors = await validateAdapterBoundaries(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/identity-oidc/dist/provider.d.ts") &&
        error.includes("openid-client"),
    ),
  );
});

test("requires self-test wiring and declaration validation after build", async (context) => {
  const validateAdapterBoundaries = await loadValidator();
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "package.json",
    JSON.stringify({
      scripts: {
        check: "node ./scripts/check-adapter-boundaries.mjs && turbo run build",
      },
    }),
  );

  const errors = await validateAdapterBoundaries(root);
  assert.ok(errors.some((error) => error.includes("self-test")));
  assert.ok(
    errors.some((error) => error.includes("after the workspace build")),
  );
});
