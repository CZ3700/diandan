import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const workflowPath = ".github/workflows/ci.yml";
const workflowDirectory = ".github/workflows";
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
    regression: {
      name: "Regression (${{ matrix.suite }})",
      "runs-on": "ubuntu-24.04",
      "timeout-minutes": 120,
      strategy: {
        "fail-fast": false,
        matrix: {
          suite: ["quality", "catalog", "commerce", "operations", "journey"],
        },
      },
      env: {
        POSTGRES_TEST_BIN: "/usr/lib/postgresql/18/bin",
      },
      steps: [
        checkoutStep,
        setupStep,
        installStep,
        {
          name: "Install browser runtimes",
          run: "pnpm exec playwright install --with-deps chrome chromium",
        },
        {
          name: "Install isolated PostgreSQL runtime",
          run: "sudo apt-get update\nsudo apt-get install -y postgresql-common ca-certificates curl xvfb xauth\nsudo install -d /usr/share/postgresql-common/pgdg\nsudo curl --fail --silent --show-error -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc\necho 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main' | sudo tee /etc/apt/sources.list.d/fan-support-pgdg.list\nsudo apt-get update\nsudo apt-get install -y postgresql-18\n/usr/lib/postgresql/18/bin/postgres --version\n",
        },
        {
          name: "Run isolated regression suite",
          run: 'xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" pnpm verify:regression --suite ${{ matrix.suite }} --output output/checks/p6-01-regression/ci',
        },
        {
          name: "Preserve regression evidence",
          if: "always()",
          uses: "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
          with: {
            name: "regression-${{ matrix.suite }}",
            path: "output/checks/p6-01-regression/ci",
            "if-no-files-found": "error",
            "retention-days": 14,
          },
        },
      ],
    },
    quality: {
      name: "Quality",
      "runs-on": "ubuntu-24.04",
      needs: "regression",
      if: "always()",
      "timeout-minutes": 5,
      steps: [
        {
          name: "Require every regression suite",
          env: {
            REGRESSION_RESULT: "${{ needs.regression.result }}",
          },
          run: 'test "$REGRESSION_RESULT" = success',
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
          run: "pnpm security:dependencies",
        },
        {
          name: "Check security regressions",
          run: "pnpm security:regressions",
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

async function validateWorkflowDirectory(errors) {
  let entries;
  try {
    entries = await readdir(path.join(workspaceRoot, workflowDirectory), {
      withFileTypes: true,
    });
  } catch {
    errors.push(`cannot read ${workflowDirectory}`);
    return;
  }

  if (
    entries.length !== 1 ||
    entries[0]?.name !== "ci.yml" ||
    !entries[0].isFile()
  ) {
    errors.push(
      `${workflowDirectory} must contain only the regular file ci.yml`,
    );
  }
}

function validateManifest(manifest, errors) {
  const requiredScripts = {
    "check:ci": "node ./scripts/check-ci.mjs",
    "security:dependencies":
      "node --test ./scripts/security-dependencies.test.mjs && corepack pnpm audit --registry=https://registry.npmjs.org --audit-level=high",
    "security:regressions":
      "corepack pnpm exec turbo run build --filter=@fan-support/observability... --filter=@fan-support/payment-stripe... --output-logs=errors-only && node --test ./scripts/security-rate-limit.test.mjs ./apps/api/scripts/local-experience-services.test.mjs ./scripts/render-rum-dashboard.test.mjs",
    "security:secrets": "node ./scripts/scan-secrets.mjs",
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
  await validateWorkflowDirectory(errors);

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
