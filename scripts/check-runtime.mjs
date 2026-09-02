import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const appContracts = Object.freeze({
  storefront: {
    dependencies: [
      "@fan-support/config",
      "@fan-support/observability",
      "next",
      "react",
      "react-dom",
    ],
    files: [
      "next.config.ts",
      "next-env.d.ts",
      "src/instrumentation.ts",
      "src/proxy.ts",
      "src/app/global-error.tsx",
      "src/app/icon.svg",
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "src/app/healthz/route.ts",
      "src/app/%5Finternal/observability/route.ts",
      "src/server/observability-probe.ts",
    ],
    scripts: ["build", "dev", "start", "test", "typecheck"],
  },
  admin: {
    dependencies: [
      "@fan-support/config",
      "@fan-support/observability",
      "next",
      "react",
      "react-dom",
    ],
    files: [
      "next.config.ts",
      "next-env.d.ts",
      "src/instrumentation.ts",
      "src/proxy.ts",
      "src/app/global-error.tsx",
      "src/app/icon.svg",
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "src/app/healthz/route.ts",
    ],
    scripts: ["build", "dev", "start", "test", "typecheck"],
  },
  api: {
    dependencies: [
      "@fan-support/config",
      "@fan-support/observability",
      "@nestjs/common",
      "@nestjs/core",
      "@nestjs/platform-fastify",
      "fastify",
      "reflect-metadata",
      "rxjs",
    ],
    files: [
      "src/app.module.ts",
      "src/bootstrap.ts",
      "src/health.controller.ts",
      "src/main.ts",
      "src/safe-http-exception.filter.ts",
    ],
    scripts: ["build", "dev", "start", "test", "typecheck"],
  },
  worker: {
    dependencies: [
      "@fan-support/config",
      "@fan-support/observability",
      "@nestjs/common",
      "@nestjs/core",
      "@nestjs/platform-fastify",
      "fastify",
      "reflect-metadata",
      "rxjs",
    ],
    files: [
      "src/app.module.ts",
      "src/bootstrap.ts",
      "src/health.controller.ts",
      "src/main.ts",
      "src/safe-http-exception.filter.ts",
    ],
    scripts: ["build", "dev", "start", "test", "typecheck"],
  },
});

const rootRuntimeFiles = Object.freeze([
  ".dockerignore",
  "README.md",
  "infra/Caddyfile",
  "infra/compose.preview.yml",
  "infra/docker/Dockerfile",
  "scripts/runtime-preview.mjs",
  "scripts/check-observability.mjs",
]);

const rootRuntimeScripts = Object.freeze([
  "check:observability",
  "preview:config",
  "preview:down",
  "preview:logs",
  "preview:up",
  "preview:verify",
]);

async function exists(relativePath) {
  try {
    await stat(path.join(workspaceRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readText(relativePath, errors) {
  try {
    return await readFile(path.join(workspaceRoot, relativePath), "utf8");
  } catch {
    errors.push(`missing runtime file: ${relativePath}`);
    return undefined;
  }
}

async function readJson(relativePath, errors) {
  const text = await readText(relativePath, errors);
  if (text === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    errors.push(`runtime manifest is not valid JSON: ${relativePath}`);
    return undefined;
  }
}

function isExactVersion(value) {
  return (
    typeof value === "string" &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
  );
}

function isReadOnlyBindMount(volume, source, target) {
  return (
    volume !== null &&
    typeof volume === "object" &&
    volume.type === "bind" &&
    volume.source === source &&
    volume.target === target &&
    volume.read_only === true
  );
}

async function validateApp(name, contract, errors) {
  const directory = path.posix.join("apps", name);
  const manifestPath = path.posix.join(directory, "package.json");
  const manifest = await readJson(manifestPath, errors);

  for (const file of contract.files) {
    const relativePath = path.posix.join(directory, file);
    if (!(await exists(relativePath))) {
      errors.push(`missing ${name} runtime file: ${relativePath}`);
    }
  }

  if (manifest === undefined) {
    return;
  }

  for (const scriptName of contract.scripts) {
    if (typeof manifest.scripts?.[scriptName] !== "string") {
      errors.push(`${manifestPath} is missing runtime script ${scriptName}`);
    }
  }

  for (const dependencyName of contract.dependencies) {
    const specifier = manifest.dependencies?.[dependencyName];
    if (dependencyName.startsWith("@fan-support/")) {
      if (specifier !== "workspace:*") {
        errors.push(
          `${manifestPath} dependency ${dependencyName} must equal workspace:*`,
        );
      }
    } else if (!isExactVersion(specifier)) {
      errors.push(
        `${manifestPath} dependency ${dependencyName} must use an exact version`,
      );
    }
  }
}

async function walkSourceFiles(relativeDirectory) {
  const absoluteDirectory = path.join(workspaceRoot, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkSourceFiles(relativePath)));
    } else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

async function validateServerOnlyBoundary(errors) {
  const sourceFiles = await walkSourceFiles("apps");

  for (const relativePath of sourceFiles) {
    const text = await readFile(path.join(workspaceRoot, relativePath), "utf8");
    const isClientModule = /^\s*["']use client["'];?/u.test(text);
    if (isClientModule && text.includes("@fan-support/config/server")) {
      errors.push(
        `${relativePath} is a client module and must not import server config`,
      );
    }

    if (
      (relativePath.startsWith("apps/admin/") ||
        relativePath.startsWith("apps/storefront/")) &&
      text.includes("@fan-support/config/server") &&
      !relativePath.includes("/src/server/")
    ) {
      errors.push(
        `${relativePath} may import server config only from src/server`,
      );
    }
  }
}

async function validateNestFailureBoundary(errors) {
  for (const app of ["api", "worker"]) {
    const relativePath = `apps/${app}/src/bootstrap.ts`;
    const text = await readText(relativePath, errors);
    if (text !== undefined && !text.includes("abortOnError: false")) {
      errors.push(
        `${relativePath} must return Nest initialization failures to the observed runtime`,
      );
    }
  }
}

async function validateCompose(errors) {
  const relativePath = "infra/compose.preview.yml";
  const text = await readText(relativePath, errors);
  if (text === undefined) {
    return;
  }

  let document;
  try {
    document = parseDocument(text, { strict: true, uniqueKeys: true });
  } catch {
    errors.push(`${relativePath} cannot be parsed as YAML`);
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

  const expectedServices = [
    "admin",
    "api",
    "edge",
    "object-storage",
    "postgres",
    "storefront",
    "worker",
  ];
  const actualServices = Object.keys(compose?.services ?? {}).sort();
  if (
    actualServices.length !== expectedServices.length ||
    expectedServices.some((service, index) => service !== actualServices[index])
  ) {
    errors.push(
      `${relativePath} must define exactly ${expectedServices.join(", ")}`,
    );
  }

  for (const serviceName of expectedServices) {
    if (compose?.services?.[serviceName]?.healthcheck === undefined) {
      errors.push(`${relativePath} service ${serviceName} needs a healthcheck`);
    }
  }

  for (const serviceName of ["admin", "api", "storefront", "worker"]) {
    const service = compose?.services?.[serviceName];
    if (service?.profiles?.includes("preview") !== true) {
      errors.push(
        `${relativePath} service ${serviceName} needs preview profile`,
      );
    }
    if (service?.build?.target !== serviceName) {
      errors.push(
        `${relativePath} service ${serviceName} needs its own OCI target`,
      );
    }
    if (service?.image !== `fan-support/${serviceName}:p0-05`) {
      errors.push(
        `${relativePath} service ${serviceName} must use the P0-05 preview tag`,
      );
    }
  }

  if (
    compose?.services?.storefront?.environment
      ?.FAN_SUPPORT_INTERNAL_API_ORIGIN !== "http://api:3002"
  ) {
    errors.push(
      `${relativePath} storefront must use the explicit preview internal API origin`,
    );
  }

  for (const serviceName of ["api", "worker"]) {
    const service = compose?.services?.[serviceName];
    const volumes = service?.volumes;
    if (
      service?.environment?.NODE_ENV !== "production" ||
      service?.environment?.FAN_SUPPORT_DEPLOYMENT_ENV !== "preview"
    ) {
      errors.push(
        `${relativePath} service ${serviceName} must exercise production/preview config`,
      );
    }
    if (
      service?.environment?.FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT !==
        "https://edge:7443" ||
      service?.environment?.NODE_EXTRA_CA_CERTS !== "/run/preview-ca/ca.crt"
    ) {
      errors.push(
        `${relativePath} service ${serviceName} must trust and use the preview S3 TLS edge`,
      );
    }
    if (
      !Array.isArray(volumes) ||
      volumes.length !== 1 ||
      !isReadOnlyBindMount(
        volumes[0],
        "${PREVIEW_TLS_DIRECTORY:?managed by preview launcher}/clients",
        "/run/preview-ca",
      )
    ) {
      errors.push(
        `${relativePath} service ${serviceName} must mount only the client CA directory`,
      );
    }
  }

  if (compose?.services?.["object-storage"]?.ports !== undefined) {
    errors.push(
      `${relativePath} object storage must be host-accessible only through TLS edge`,
    );
  }
  const edge = compose?.services?.edge;
  if (edge?.ports?.includes("127.0.0.1:7443:7443") !== true) {
    errors.push(`${relativePath} edge must publish the preview S3 TLS port`);
  }
  const edgeVolumes = edge?.volumes;
  if (
    edge?.environment?.PREVIEW_TLS_DIRECTORY === undefined ||
    !Array.isArray(edgeVolumes) ||
    edgeVolumes.length !== 2 ||
    !edgeVolumes.includes("./Caddyfile:/etc/caddy/Caddyfile:ro") ||
    !edgeVolumes.some((volume) =>
      isReadOnlyBindMount(
        volume,
        "${PREVIEW_TLS_DIRECTORY:?managed by preview launcher}/edge",
        "/run/preview-tls",
      ),
    )
  ) {
    errors.push(
      `${relativePath} edge must retain the managed TLS path and exclusively mount its TLS directory`,
    );
  }

  for (const serviceName of ["edge", "object-storage", "postgres"]) {
    const image = compose?.services?.[serviceName]?.image;
    if (
      typeof image !== "string" ||
      !/:[^@\s]+@sha256:[a-f0-9]{64}$/u.test(image)
    ) {
      errors.push(
        `${relativePath} service ${serviceName} must pin tag and digest`,
      );
    }
  }

  if (text.toLowerCase().includes("redis")) {
    errors.push(`${relativePath} must not introduce Redis in the MVP runtime`);
  }
}

async function validateDockerfile(errors) {
  const relativePath = "infra/docker/Dockerfile";
  const text = await readText(relativePath, errors);
  if (text === undefined) {
    return;
  }

  for (const target of ["admin", "api", "storefront", "worker"]) {
    if (!new RegExp(`^FROM \\S+ AS ${target}$`, "mu").test(text)) {
      errors.push(`${relativePath} is missing independent target ${target}`);
    }
  }
  if (
    !text.includes(
      "node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e",
    )
  ) {
    errors.push(`${relativePath} must pin the approved Node image digest`);
  }
  if (
    !text.includes("pnpm fetch --frozen-lockfile") ||
    !text.includes("pnpm install --offline --frozen-lockfile")
  ) {
    errors.push(
      `${relativePath} must cache immutable dependencies before copying mutable source`,
    );
  }
  const observabilityBuild = text.indexOf(
    "pnpm --filter @fan-support/observability build",
  );
  const firstApplicationBuild = Math.min(
    ...["storefront", "admin", "api", "worker"].map((name) =>
      text.indexOf(`pnpm --filter @fan-support/${name} build`),
    ),
  );
  if (
    observabilityBuild < 0 ||
    firstApplicationBuild < 0 ||
    observabilityBuild > firstApplicationBuild
  ) {
    errors.push(
      `${relativePath} must build observability before every application`,
    );
  }
  const syntaxDirective = text.match(/^# syntax=(.+)$/mu)?.[1];
  if (
    syntaxDirective !== undefined &&
    !/@sha256:[a-f0-9]{64}$/u.test(syntaxDirective)
  ) {
    errors.push(
      `${relativePath} must not use an unpinned external Dockerfile frontend`,
    );
  }
}

async function validateDockerignore(errors) {
  const relativePath = ".dockerignore";
  const text = await readText(relativePath, errors);
  if (text === undefined) {
    return;
  }

  const entries = new Set(
    text
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "" && !entry.startsWith("#")),
  );
  if (!entries.has("output")) {
    errors.push(`${relativePath} must exclude local preview evidence`);
  }
}

async function validatePreviewLauncher(errors) {
  const relativePath = "scripts/runtime-preview.mjs";
  const text = await readText(relativePath, errors);
  if (text === undefined) {
    return;
  }

  if (!text.includes('COMPOSE_PARALLEL_LIMIT: "1"')) {
    errors.push(
      `${relativePath} must serialize legacy Compose builds for the supported 4 GiB Docker runtime`,
    );
  }

  if (!text.includes("current_setting('server_version_num')")) {
    errors.push(
      `${relativePath} must use PostgreSQL's machine-readable version number for its query probe`,
    );
  }

  if (!text.includes('"openssl"') || !text.includes("https://localhost:7443")) {
    errors.push(
      `${relativePath} must generate ephemeral TLS material and probe S3 through HTTPS`,
    );
  }
  if (
    !text.includes("/_internal/observability") ||
    !text.includes("traceparent") ||
    !text.includes("x-request-id")
  ) {
    errors.push(
      `${relativePath} must verify storefront-to-API request and trace correlation`,
    );
  }
  if (
    !text.includes("runtime.start_failed") ||
    !text.includes("runtime.stopped")
  ) {
    errors.push(
      `${relativePath} must verify fixed startup failure and graceful shutdown records`,
    );
  }
  if (
    !/path\.join\(\s*workspaceRoot,\s*"node_modules",\s*"\.cache",\s*"fan-support-preview",?\s*\)/u.test(
      text,
    ) ||
    !/path\.join\(\s*directory,\s*"clients"\s*\)/u.test(text) ||
    !/path\.join\(\s*directory,\s*"edge"\s*\)/u.test(text)
  ) {
    errors.push(
      `${relativePath} must use a container-shared ignored cache root and separate client/edge TLS mounts`,
    );
  }
}

async function validateCaddyfile(errors) {
  const relativePath = "infra/Caddyfile";
  const text = await readText(relativePath, errors);
  if (text === undefined) {
    return;
  }

  if (
    !text.includes(
      "tls /run/preview-tls/preview.crt /run/preview-tls/preview.key",
    ) ||
    !text.includes("reverse_proxy object-storage:7070")
  ) {
    errors.push(
      `${relativePath} must terminate ephemeral TLS for the internal S3 service`,
    );
  }
}

async function validateRoot(errors) {
  for (const relativePath of rootRuntimeFiles) {
    if (!(await exists(relativePath))) {
      errors.push(`missing runtime file: ${relativePath}`);
    }
  }

  const manifest = await readJson("package.json", errors);
  for (const scriptName of rootRuntimeScripts) {
    if (typeof manifest?.scripts?.[scriptName] !== "string") {
      errors.push(`package.json is missing runtime script ${scriptName}`);
    }
  }
}

const errors = [];
await validateRoot(errors);
for (const [name, contract] of Object.entries(appContracts)) {
  await validateApp(name, contract, errors);
}
await validateServerOnlyBoundary(errors);
await validateNestFailureBoundary(errors);
await validateCompose(errors);
await validateDockerfile(errors);
await validateDockerignore(errors);
await validatePreviewLauncher(errors);
await validateCaddyfile(errors);

if (errors.length > 0) {
  console.error("Runtime contract check failed:");
  for (const error of [...new Set(errors)].sort()) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    "Runtime contract check passed: four apps, PostgreSQL, object storage, healthchecks, and OCI preview are declared.",
  );
}
