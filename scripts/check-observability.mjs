import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const errors = [];

async function readText(relativePath) {
  try {
    return await readFile(path.join(workspaceRoot, relativePath), "utf8");
  } catch {
    errors.push(`missing observability file: ${relativePath}`);
    return undefined;
  }
}

async function readJson(relativePath) {
  const text = await readText(relativePath);
  if (text === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    errors.push(`observability manifest is not valid JSON: ${relativePath}`);
    return undefined;
  }
}

function normalizedJson(value) {
  if (Array.isArray(value)) {
    return value.map(normalizedJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizedJson(entry)]),
    );
  }
  return value;
}

function isDeepEqual(left, right) {
  return (
    JSON.stringify(normalizedJson(left)) ===
    JSON.stringify(normalizedJson(right))
  );
}

function requireText(relativePath, text, requiredSnippets) {
  if (text === undefined) {
    return;
  }
  for (const snippet of requiredSnippets) {
    if (!text.includes(snippet)) {
      errors.push(`${relativePath} must contain ${snippet}`);
    }
  }
}

async function validateObservabilityPackage() {
  const relativePath = "packages/observability/package.json";
  const manifest = await readJson(relativePath);
  if (manifest === undefined) {
    return;
  }

  const expectedExports = {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
    "./fastify": {
      types: "./dist/fastify.d.ts",
      import: "./dist/fastify.js",
    },
    "./node": {
      types: "./dist/node.d.ts",
      import: "./dist/node.js",
    },
  };
  if (!isDeepEqual(manifest.exports, expectedExports)) {
    errors.push(`${relativePath} must expose only ., ./fastify, and ./node`);
  }

  const expectedDependencies = {
    "@fan-support/contracts": "workspace:*",
    "@opentelemetry/api": "1.9.1",
    "@opentelemetry/core": "2.11.0",
    "@opentelemetry/resources": "2.11.0",
    "@opentelemetry/sdk-trace-node": "2.11.0",
    "@opentelemetry/semantic-conventions": "1.43.0",
    fastify: "5.12.1",
    zod: "4.5.4",
  };
  if (!isDeepEqual(manifest.dependencies, expectedDependencies)) {
    errors.push(
      `${relativePath} must pin the approved observability dependencies`,
    );
  }
}

async function validateApplicationContracts() {
  for (const app of ["storefront", "admin", "api", "worker"]) {
    const manifestPath = `apps/${app}/package.json`;
    const manifest = await readJson(manifestPath);
    if (
      manifest?.dependencies?.["@fan-support/observability"] !== "workspace:*"
    ) {
      errors.push(
        `${manifestPath} must depend on @fan-support/observability via workspace:*`,
      );
    }
  }

  const probeRoutePath =
    "apps/storefront/src/app/%5Finternal/observability/route.ts";
  requireText(probeRoutePath, await readText(probeRoutePath), [
    "GET",
    "observability-probe",
  ]);

  const probeHelperPath = "apps/storefront/src/server/observability-probe.ts";
  const probeHelper = await readText(probeHelperPath);
  requireText(probeHelperPath, probeHelper, [
    "runWithServerRequest",
    "createPropagationHeaders",
    "resolveInternalApiRuntimeConfig",
    "404",
    "UPSTREAM_UNAVAILABLE",
  ]);
  if (
    probeHelper !== undefined &&
    !(
      ["staging", "production"].every((tier) =>
        probeHelper.includes(`"${tier}"`),
      ) ||
      ["development", "test", "preview"].every((tier) =>
        probeHelper.includes(`"${tier}"`),
      )
    )
  ) {
    errors.push(
      `${probeHelperPath} must fail closed outside local and preview tiers`,
    );
  }

  for (const app of ["storefront", "admin"]) {
    const instrumentationPath = `apps/${app}/src/instrumentation.ts`;
    const instrumentation = await readText(instrumentationPath);
    requireText(instrumentationPath, instrumentation, [
      "NEXT_RUNTIME",
      "register",
      "onRequestError",
      "installSafeConsoleErrorBoundary",
    ]);

    const proxyPath = `apps/${app}/src/proxy.ts`;
    const proxy = await readText(proxyPath);
    requireText(proxyPath, proxy, [
      "REQUEST_ID_HEADER",
      "resolveRequestId",
      "proxy",
    ]);

    const errorPath = `apps/${app}/src/app/global-error.tsx`;
    const errorBoundary = await readText(errorPath);
    requireText(errorPath, errorBoundary, ['"use client"', "reset"]);
  }

  for (const app of ["api", "worker"]) {
    const mainPath = `apps/${app}/src/main.ts`;
    const main = await readText(mainPath);
    const lifecyclePath =
      app === "api" ? "apps/api/src/process-runtime.ts" : mainPath;
    const lifecycle =
      lifecyclePath === mainPath ? main : await readText(lifecyclePath);
    requireText(lifecyclePath, lifecycle, [
      "createRuntimeFatalHandler",
      "createRuntimeShutdownHandler",
      "createRuntimeShutdownCoordinator",
      'process.once("SIGINT"',
      'process.once("SIGTERM"',
      'process.on("uncaughtException"',
      'process.on("unhandledRejection"',
      "launchObservedRuntime",
      "attachRuntime",
    ]);
    if (
      lifecycle !== undefined &&
      lifecycle.indexOf('process.once("SIGTERM"') >
        lifecycle.indexOf("launchObservedRuntime({")
    ) {
      errors.push(
        `${lifecyclePath} must register shutdown signals before runtime startup`,
      );
    }
    if (
      lifecycle !== undefined &&
      lifecycle.indexOf('process.on("unhandledRejection"') >
        lifecycle.indexOf("launchObservedRuntime({")
    ) {
      errors.push(
        `${lifecyclePath} must register fatal error handlers before runtime startup`,
      );
    }
    if (app === "api") {
      requireText(mainPath, main, [
        "createProductionApiApplication",
        "startApiProcessRuntime",
      ]);
    }
  }

  const fastifyPath = "packages/observability/src/fastify.ts";
  requireText(fastifyPath, await readText(fastifyPath), [
    "finishFastifyRequest",
    'addHook("onRequestAbort"',
    'addHook("onTimeout"',
    'errorCode: "REQUEST_ABORTED"',
    'errorCode: "REQUEST_TIMEOUT"',
  ]);
}

async function walkSourceFiles(relativeDirectory) {
  let entries;
  try {
    entries = await readdir(path.join(workspaceRoot, relativeDirectory), {
      withFileTypes: true,
    });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkSourceFiles(relativePath)));
    } else if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

async function validateNoApplicationConsole() {
  for (const app of ["storefront", "admin", "api", "worker"]) {
    for (const relativePath of await walkSourceFiles(`apps/${app}/src`)) {
      const text = await readFile(
        path.join(workspaceRoot, relativePath),
        "utf8",
      );
      if (/\bconsole\s*(?:\.|\[)/u.test(text)) {
        errors.push(
          `${relativePath} must use the structured observability logger`,
        );
      }
    }
  }
}

async function validateDockerfile() {
  const relativePath = "infra/docker/Dockerfile";
  const text = await readText(relativePath);
  if (text === undefined) {
    return;
  }

  const executableText = text
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  const observabilityBuild = executableText.indexOf(
    "pnpm --filter @fan-support/observability build",
  );
  const explicitAppBuilds = ["storefront", "admin", "api", "worker"].map(
    (app) => executableText.indexOf(`pnpm --filter @fan-support/${app} build`),
  );
  const usesOrderedExplicitBuilds =
    observabilityBuild >= 0 &&
    explicitAppBuilds.every(
      (appBuild) => appBuild >= 0 && observabilityBuild < appBuild,
    );
  if (usesOrderedExplicitBuilds) {
    return;
  }

  const turboConfig = await readJson("turbo.json");
  const buildDependencies = turboConfig?.tasks?.build?.dependsOn;
  const usesDependencyAwareTurboBuild =
    executableText.includes("pnpm turbo run build") &&
    ["storefront", "admin", "api", "worker"].every((app) =>
      executableText.includes(`--filter=@fan-support/${app}`),
    ) &&
    Array.isArray(buildDependencies) &&
    buildDependencies.includes("^build");
  if (!usesDependencyAwareTurboBuild) {
    errors.push(
      `${relativePath} must build @fan-support/observability before every app, directly or through Turbo's dependency graph`,
    );
  }
}

async function validateCompose() {
  const relativePath = "infra/compose.preview.yml";
  const text = await readText(relativePath);
  if (text === undefined) {
    return;
  }

  let document;
  try {
    document = parseDocument(text, { strict: true, uniqueKeys: true });
  } catch {
    errors.push(`${relativePath} is not valid YAML`);
    return;
  }
  if (document.errors.length > 0 || document.warnings.length > 0) {
    errors.push(`${relativePath} contains a YAML issue`);
    return;
  }

  let compose;
  try {
    compose = document.toJS({ maxAliasCount: 0 });
  } catch {
    errors.push(`${relativePath} cannot resolve to a plain value`);
    return;
  }

  for (const app of ["storefront", "admin", "api", "worker"]) {
    if (compose?.services?.[app]?.image !== `fan-support/${app}:p0-05`) {
      errors.push(
        `${relativePath} service ${app} must use its p0-05 image tag`,
      );
    }
  }
  if (
    compose?.services?.storefront?.environment
      ?.FAN_SUPPORT_INTERNAL_API_ORIGIN !== "http://api:3002"
  ) {
    errors.push(
      `${relativePath} storefront must receive the internal API origin`,
    );
  }
}

function extractCodeBlocks(markdown) {
  return [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)]
    .map((match) => match[1] ?? "")
    .join("\n");
}

async function validateReadme() {
  const relativePath = "README.md";
  const text = await readText(relativePath);
  if (text === undefined) {
    return;
  }

  requireText(relativePath, text, [
    "Node.js 24.20.0",
    "pnpm 11.25.0",
    "Docker",
    "OpenSSL",
    "mise exec node@24.20.0 -- corepack pnpm install --frozen-lockfile",
    "mise exec node@24.20.0 -- corepack pnpm check",
    "mise exec node@24.20.0 -- corepack pnpm preview:up",
    "mise exec node@24.20.0 -- corepack pnpm preview:verify",
    "mise exec node@24.20.0 -- corepack pnpm preview:logs",
    "mise exec node@24.20.0 -- corepack pnpm preview:down",
    "https://localhost:3443/",
    "https://localhost:3444/",
    "http://localhost:3002/healthz",
    "http://localhost:3003/healthz",
    "x-request-id",
    "traceparent",
    "CONFIG_INVALID",
    "NODE_EXTRA_CA_CERTS",
    "SIGTERM",
    "preview:logs",
    "apps/storefront/src/app/%5Finternal/observability/route.ts",
    "Next.js private folder",
    "cloud exporter",
    "staging",
    "production",
  ]);

  for (const forbidden of [
    "curl -k",
    "--insecure",
    "NODE_TLS_REJECT_UNAUTHORIZED=0",
  ]) {
    const matchingLines = text
      .split(/\r?\n/u)
      .filter((line) => line.includes(forbidden));
    if (
      matchingLines.length !== 1 ||
      !matchingLines[0].match(/(?:\u7981\u6b62|\u4e0d\u5f97|\u4e0d\u8981)/u)
    ) {
      errors.push(
        `${relativePath} must identify ${forbidden} exactly once as forbidden`,
      );
    }
  }

  const commands = extractCodeBlocks(text);
  if (
    /curl\s+[^\n]*(?:\s-k(?:\s|$)|--insecure)/u.test(commands) ||
    /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0/u.test(commands)
  ) {
    errors.push(`${relativePath} must not contain a runnable TLS bypass`);
  }
  if (/\bdocker(?:-compose|\s+compose)?\s+logs\b/u.test(commands)) {
    errors.push(
      `${relativePath} must use only the scrubbed preview:logs command`,
    );
  }
}

async function validateRootManifest() {
  const relativePath = "package.json";
  const manifest = await readJson(relativePath);
  if (manifest === undefined) {
    return;
  }

  const expected = "node ./scripts/check-observability.mjs";
  if (manifest.scripts?.["check:observability"] !== expected) {
    errors.push(`${relativePath} must define check:observability`);
  }
  if (!manifest.scripts?.check?.includes(expected)) {
    errors.push(`${relativePath} check must run the observability contract`);
  }

  const documentedPreviewScripts = {
    "preview:down": "node ./scripts/runtime-preview.mjs down",
    "preview:logs": "node ./scripts/runtime-preview.mjs logs",
    "preview:up": "node ./scripts/runtime-preview.mjs up",
    "preview:verify": "node ./scripts/runtime-preview.mjs verify",
  };
  for (const [name, command] of Object.entries(documentedPreviewScripts)) {
    if (manifest.scripts?.[name] !== command) {
      errors.push(`${relativePath} must define documented script ${name}`);
    }
  }
}

await validateObservabilityPackage();
await validateApplicationContracts();
await validateNoApplicationConsole();
await validateDockerfile();
await validateCompose();
await validateReadme();
await validateRootManifest();

if (errors.length > 0) {
  console.error("Observability contract check failed:");
  for (const error of [...new Set(errors)].sort()) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    "Observability contract check passed: four runtimes declare safe request correlation, tracing, errors, preview wiring, and operator guidance.",
  );
}
