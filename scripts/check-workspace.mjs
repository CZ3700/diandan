import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const appNames = ["storefront", "admin", "api", "worker"];
const packageNames = [
  "domain",
  "application",
  "contracts",
  "i18n",
  "catalog",
  "pricing",
  "inventory",
  "cart",
  "orders",
  "content",
  "payment-port",
  "payment-fake",
  "payment-routing",
  "persistence-port",
  "persistence-postgres",
  "media-port",
  "media-s3",
  "identity-port",
  "identity-oidc",
  "notification-port",
  "notification-provider",
  "cache-purge-port",
  "cache-purge-cdn",
  "key-management-port",
  "key-management-kms",
  "observability",
  "design-tokens",
  "ui",
  "config",
  "testing",
];

const units = [
  ...appNames.map((name) => ({ directory: path.join("apps", name), name })),
  ...packageNames.map((name) => ({
    directory: path.join("packages", name),
    name,
  })),
];

const expectedUnitByDirectory = new Map(
  units.map((unit) => [unit.directory, unit]),
);

const requiredRootFiles = [
  ".env.example",
  ".github/workflows/ci.yml",
  ".gitignore",
  ".node-version",
  ".prettierignore",
  ".secretlintignore",
  ".secretlintrc.json",
  "eslint.config.mjs",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "provider-fixtures/manifest.json",
  "provider-fixtures/identity-oidc.v1.json",
  "provider-fixtures/media-s3.v1.json",
  "provider-fixtures/notification.v1.json",
  "provider-fixtures/payment-fake.v1.json",
  "database/migrations/manifest.json",
  "database/schema/expected-catalog.json",
  "scripts/check-adapter-boundaries.mjs",
  "scripts/check-adapter-boundaries.test.mjs",
  "scripts/check-build-artifacts.mjs",
  "scripts/check-ci.mjs",
  "scripts/check-contracts.mjs",
  "scripts/check-design-foundations.mjs",
  "scripts/check-design-foundations.test.mjs",
  "scripts/generate-contract-artifacts.mjs",
  "scripts/scan-secrets.mjs",
  "packages/design-tokens/THIRD_PARTY_NOTICES.md",
  "tsconfig.base.json",
  "turbo.json",
  "vitest.config.ts",
];

const requiredRootScripts = [
  "build",
  "check",
  "check:adapter-boundaries",
  "check:artifacts",
  "check:ci",
  "check:contracts",
  "check:design-foundations",
  "contracts:generate",
  "format:check",
  "lint",
  "security:secrets",
  "test",
  "test:postgres",
  "test:s3",
  "typecheck",
];

const requiredUnitFiles = [
  "package.json",
  path.join("src", "index.test.ts"),
  path.join("src", "index.ts"),
  "tsconfig.build.json",
  "tsconfig.json",
];

async function exists(relativePath) {
  try {
    await stat(path.join(workspaceRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readJson(relativePath, errors) {
  try {
    return JSON.parse(
      await readFile(path.join(workspaceRoot, relativePath), "utf8"),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`${relativePath} is not valid JSON: ${detail}`);
    return undefined;
  }
}

function dependencyEntries(manifest) {
  return [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ].flatMap((groupName) =>
    Object.entries(manifest[groupName] ?? {}).map(([name, specifier]) => ({
      groupName,
      name,
      specifier,
    })),
  );
}

async function discoverWorkspaceUnits(errors) {
  const discoveredUnits = [];

  for (const parentDirectory of ["apps", "packages"]) {
    let entries;
    try {
      entries = await readdir(path.join(workspaceRoot, parentDirectory), {
        withFileTypes: true,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(
        `cannot read workspace directory ${parentDirectory}: ${detail}`,
      );
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const directory = path.join(parentDirectory, entry.name);
      if (await exists(path.join(directory, "package.json"))) {
        discoveredUnits.push({ directory });
      }
    }
  }

  return discoveredUnits.sort((left, right) =>
    left.directory.localeCompare(right.directory),
  );
}

function findCycles(graph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(node) {
    if (visiting.has(node)) {
      const cycleStart = stack.indexOf(node);
      cycles.push([...stack.slice(cycleStart), node]);
      return;
    }

    if (visited.has(node)) {
      return;
    }

    visiting.add(node);
    stack.push(node);

    for (const dependency of graph.get(node) ?? []) {
      visit(dependency);
    }

    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) {
    visit(node);
  }

  return cycles;
}

async function validateWorkspace() {
  const errors = [];

  for (const requiredFile of requiredRootFiles) {
    if (!(await exists(requiredFile))) {
      errors.push(`missing root file: ${requiredFile}`);
    }
  }

  let rootManifest;
  if (await exists("package.json")) {
    rootManifest = await readJson("package.json", errors);
  }

  if (rootManifest) {
    if (rootManifest.private !== true) {
      errors.push("root package.json must set private=true");
    }

    if (!/^pnpm@\d+\.\d+\.\d+$/.test(rootManifest.packageManager ?? "")) {
      errors.push(
        "root package.json must pin an exact pnpm packageManager version",
      );
    }

    for (const scriptName of requiredRootScripts) {
      if (typeof rootManifest.scripts?.[scriptName] !== "string") {
        errors.push(`root package.json is missing script: ${scriptName}`);
      }
    }

    if (!rootManifest.scripts?.check?.includes("pnpm check:contracts")) {
      errors.push("root check script must run the contract freshness gate");
    }
    if (
      !rootManifest.scripts?.check?.includes("pnpm check:design-foundations")
    ) {
      errors.push("root check script must run the design foundation gate");
    }
    if (!rootManifest.scripts?.check?.includes("pnpm test:postgres")) {
      errors.push("root check script must run the PostgreSQL migration gate");
    }
    if (!rootManifest.scripts?.check?.includes("pnpm test:s3")) {
      errors.push("root check script must run the S3 adapter integration gate");
    }
  }

  for (const unit of units) {
    for (const requiredFile of requiredUnitFiles) {
      const relativePath = path.join(unit.directory, requiredFile);
      if (!(await exists(relativePath))) {
        errors.push(`missing workspace file: ${relativePath}`);
      }
    }
  }

  const discoveredUnits = await discoverWorkspaceUnits(errors);
  const discoveredDirectories = new Set(
    discoveredUnits.map((unit) => unit.directory),
  );

  for (const unit of units) {
    if (!discoveredDirectories.has(unit.directory)) {
      errors.push(`missing workspace unit: ${unit.directory}`);
    }
  }

  for (const unit of discoveredUnits) {
    if (!expectedUnitByDirectory.has(unit.directory)) {
      errors.push(`unexpected workspace unit: ${unit.directory}`);
    }
  }

  const manifestRecords = [];
  const manifests = new Map();

  for (const unit of discoveredUnits) {
    const manifestPath = path.join(unit.directory, "package.json");
    const manifest = await readJson(manifestPath, errors);
    if (!manifest) {
      continue;
    }

    const expectedUnit = expectedUnitByDirectory.get(unit.directory);
    if (expectedUnit) {
      const expectedName = `@fan-support/${expectedUnit.name}`;
      if (manifest.name !== expectedName) {
        errors.push(`${manifestPath} must use package name ${expectedName}`);
      }
    }

    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      errors.push(`${manifestPath} must define a non-empty package name`);
      continue;
    }

    if (manifest.private !== true) {
      errors.push(`${manifestPath} must set private=true`);
    }

    for (const scriptName of ["build", "test", "typecheck"]) {
      if (typeof manifest.scripts?.[scriptName] !== "string") {
        errors.push(`${manifestPath} is missing script: ${scriptName}`);
      }
    }

    if (manifests.has(manifest.name)) {
      errors.push(`duplicate workspace package name: ${manifest.name}`);
    }

    manifestRecords.push({ manifest, manifestPath });
    manifests.set(manifest.name, manifest);
  }

  const workspaceNames = new Set(manifests.keys());

  for (const { manifest, manifestPath } of manifestRecords) {
    for (const dependency of dependencyEntries(manifest)) {
      if (
        workspaceNames.has(dependency.name) &&
        (typeof dependency.specifier !== "string" ||
          !dependency.specifier.startsWith("workspace:"))
      ) {
        errors.push(
          `${manifestPath} ${dependency.groupName}.${dependency.name} must use the workspace: protocol`,
        );
      }

      if (
        dependency.name.startsWith("@fan-support/") &&
        !workspaceNames.has(dependency.name)
      ) {
        errors.push(
          `${manifestPath} references missing workspace package: ${dependency.name}`,
        );
      }
    }
  }

  const graph = new Map(
    [...manifests.entries()].map(([name, manifest]) => [
      name,
      dependencyEntries(manifest)
        .map((dependency) => dependency.name)
        .filter((dependencyName) => workspaceNames.has(dependencyName)),
    ]),
  );

  for (const cycle of findCycles(graph)) {
    errors.push(`workspace dependency cycle: ${cycle.join(" -> ")}`);
  }

  return { errors, unitCount: discoveredUnits.length };
}

const result = await validateWorkspace();

if (result.errors.length > 0) {
  console.error("Workspace validation failed:");
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Workspace validation passed: ${appNames.length} apps, ${packageNames.length} packages, ${result.unitCount} units, no dependency cycles.`,
  );
}
