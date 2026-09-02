import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const workflowPath = ".github/workflows/ci.yml";
const secretlintConfigPath = ".secretlintrc.json";
const secretlintIgnorePath = ".secretlintignore";

const checkoutAction =
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const setupAction = "pnpm/setup@703c52620218391530e48b9e8870d5c0082e1b9b";

const checkoutStep = {
  name: "Check out repository",
  uses: checkoutAction,
  with: {
    "persist-credentials": false,
  },
};

const setupStep = {
  name: "Set up pnpm and Node.js",
  uses: setupAction,
  with: {
    runtime: "node@24.20.0",
    cache: true,
    "cache-dependency-path": "pnpm-lock.yaml",
    install: false,
  },
};

const installStep = {
  name: "Install dependencies",
  run: "pnpm install --frozen-lockfile",
};

const expectedWorkflow = {
  name: "CI",
  on: {
    pull_request: null,
    push: {
      branches: ["main"],
    },
  },
  permissions: {
    contents: "read",
  },
  concurrency: {
    group: "ci-${{ github.workflow }}-${{ github.ref }}",
    "cancel-in-progress": true,
  },
  env: {
    CI: "1",
    TURBO_TELEMETRY_DISABLED: "1",
  },
  jobs: {
    quality: {
      name: "Quality",
      "runs-on": "ubuntu-24.04",
      "timeout-minutes": 20,
      steps: [
        checkoutStep,
        setupStep,
        installStep,
        {
          name: "Run repository checks",
          run: "pnpm check",
        },
      ],
    },
    security: {
      name: "Security",
      "runs-on": "ubuntu-24.04",
      "timeout-minutes": 20,
      steps: [
        checkoutStep,
        setupStep,
        installStep,
        {
          name: "Audit dependencies",
          run: "pnpm audit --registry=https://registry.npmjs.org --audit-level=high",
        },
        {
          name: "Scan repository for secrets",
          run: "pnpm security:secrets",
        },
      ],
    },
  },
};

const expectedSecretlintConfig = {
  rules: [
    {
      id: "@secretlint/secretlint-rule-preset-recommend",
    },
  ],
};

const expectedSecretlintIgnore = `node_modules/
.pnpm-store/
.turbo/
.next/
dist/
coverage/
*.tsbuildinfo
*.log
test-results/
playwright-report/
blob-report/
`;

async function readText(relativePath, errors) {
  try {
    return await readFile(path.join(workspaceRoot, relativePath), "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`cannot read ${relativePath}: ${detail}`);
    return undefined;
  }
}

function validateWorkflow(text, errors) {
  let document;
  try {
    document = parseDocument(text, {
      strict: true,
      uniqueKeys: true,
    });
  } catch {
    errors.push(`${workflowPath} cannot be parsed as YAML`);
    return;
  }

  if (document.errors.length > 0 || document.warnings.length > 0) {
    for (const issue of [...document.errors, ...document.warnings]) {
      errors.push(
        `${workflowPath} contains a YAML issue (${issue.code ?? "unknown"})`,
      );
    }
    return;
  }

  let workflow;
  try {
    workflow = document.toJS({ maxAliasCount: 0 });
  } catch {
    errors.push(`${workflowPath} cannot resolve to a plain value`);
    return;
  }

  try {
    assert.deepStrictEqual(workflow, expectedWorkflow);
  } catch {
    errors.push(`${workflowPath} does not match the approved CI policy`);
  }
}

function validateManifest(manifest, errors) {
  const requiredScripts = {
    "check:ci": "node ./scripts/check-ci.mjs",
    "security:secrets": 'secretlint --no-gitignore "**/*"',
  };

  for (const [name, expected] of Object.entries(requiredScripts)) {
    if (manifest.scripts?.[name] !== expected) {
      errors.push(
        `package.json script ${name} must equal ${JSON.stringify(expected)}`,
      );
    }
  }

  const requiredDependencies = {
    "@secretlint/secretlint-rule-preset-recommend": "13.0.5",
    secretlint: "13.0.5",
    yaml: "2.9.0",
  };

  for (const [name, expected] of Object.entries(requiredDependencies)) {
    if (manifest.devDependencies?.[name] !== expected) {
      errors.push(
        `package.json devDependency ${name} must be pinned to ${expected}`,
      );
    }
  }

  for (const scriptName of ["check", "format", "format:check"]) {
    const script = manifest.scripts?.[scriptName];
    if (typeof script !== "string") {
      errors.push(`package.json is missing script ${scriptName}`);
      continue;
    }

    if (!script.includes(".github") || !script.includes(secretlintConfigPath)) {
      errors.push(
        `package.json script ${scriptName} must cover .github and ${secretlintConfigPath}`,
      );
    }
  }

  if (!manifest.scripts?.check?.includes("node ./scripts/check-ci.mjs")) {
    errors.push("package.json script check must run the CI contract checker");
  }
}

function validateSecretlintConfig(config, errors) {
  try {
    assert.deepStrictEqual(config, expectedSecretlintConfig);
  } catch {
    errors.push(
      `${secretlintConfigPath} must exactly enable @secretlint/secretlint-rule-preset-recommend without disables or allowlists`,
    );
  }
}

function validateSecretlintIgnore(text, errors) {
  if (text !== expectedSecretlintIgnore) {
    errors.push(
      `${secretlintIgnorePath} must match the approved generated-artifact ignore list`,
    );
  }
}

async function validateCi() {
  const errors = [];
  const [
    workflowText,
    manifestText,
    secretlintConfigText,
    secretlintIgnoreText,
  ] = await Promise.all([
    readText(workflowPath, errors),
    readText("package.json", errors),
    readText(secretlintConfigPath, errors),
    readText(secretlintIgnorePath, errors),
  ]);

  if (workflowText !== undefined) {
    validateWorkflow(workflowText, errors);
  }

  if (manifestText !== undefined) {
    try {
      validateManifest(JSON.parse(manifestText), errors);
    } catch {
      errors.push("package.json is not valid JSON");
    }
  }

  if (secretlintConfigText !== undefined) {
    try {
      validateSecretlintConfig(JSON.parse(secretlintConfigText), errors);
    } catch {
      errors.push(`${secretlintConfigPath} is not valid JSON`);
    }
  }

  if (secretlintIgnoreText !== undefined) {
    validateSecretlintIgnore(secretlintIgnoreText, errors);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("CI contract check passed");
}

await validateCi();
