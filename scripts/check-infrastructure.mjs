import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const applications = ["admin", "api", "storefront", "worker"];
const manifestKeys = [
  "backupRegion",
  "cloudEvidence",
  "environment",
  "images",
  "region",
  "releaseCommit",
  "schemaVersion",
];
const sameKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort());
const onlyKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));

export function buildOfflineCommands(directory, ...extra) {
  if (extra.length > 0)
    throw new Error("Additional command arguments are forbidden.");
  return [
    { cwd: directory, args: ["fmt", "-check", "-recursive", "-no-color"] },
    {
      cwd: directory,
      args: [
        "init",
        "-backend=false",
        "-input=false",
        "-lockfile=readonly",
        "-no-color",
      ],
    },
    { cwd: directory, args: ["validate", "-no-color"] },
    {
      cwd: directory,
      args: ["test", "-filter=tests/offline.tftest.json", "-no-color"],
    },
  ];
}

export function validateOfflineTest(testFile, aliases) {
  const fail = () => {
    throw new Error(
      "Unsafe offline test: only explicitly mocked providers and non-refreshing plan runs are allowed.",
    );
  };
  if (
    !onlyKeys(testFile, ["mock_provider", "variables", "run"]) ||
    !testFile.mock_provider ||
    !testFile.run
  )
    fail();
  const actual = [];
  for (const [provider, values] of Object.entries(testFile.mock_provider)) {
    for (const config of Array.isArray(values) ? values : [values]) {
      if (!onlyKeys(config, ["alias", "mock_data", "mock_resource"])) fail();
      actual.push(config.alias ? `${provider}.${config.alias}` : provider);
    }
  }
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...aliases].sort()))
    fail();
  if (Object.keys(testFile.run).length === 0) fail();
  for (const run of Object.values(testFile.run)) {
    if (
      !onlyKeys(run, [
        "command",
        "plan_options",
        "assert",
        "variables",
        "expect_failures",
      ]) ||
      run.command !== "plan" ||
      !sameKeys(run.plan_options, ["refresh"]) ||
      run.plan_options.refresh !== false
    )
      fail();
    if (
      !(Array.isArray(run.assert) && run.assert.length > 0) &&
      !(Array.isArray(run.expect_failures) && run.expect_failures.length > 0)
    )
      fail();
  }
}

export function validateDeploymentManifest(value) {
  if (
    !sameKeys(value, manifestKeys) ||
    value.schemaVersion !== 1 ||
    !["staging", "production"].includes(value.environment) ||
    value.region !== "us-east-1" ||
    value.backupRegion !== "us-west-2" ||
    value.cloudEvidence !== false ||
    !/^[a-f0-9]{40}$/.test(value.releaseCommit) ||
    !sameKeys(value.images, applications) ||
    !Object.entries(value.images).every(
      ([app, image]) =>
        typeof image === "string" &&
        new RegExp(
          `^[0-9]{12}\\.dkr\\.ecr\\.us-east-1\\.amazonaws\\.com/[a-z0-9-]+/${app}@sha256:[a-f0-9]{64}$`,
        ).test(image),
    )
  )
    throw new Error(
      "Invalid deployment manifest: exact versioned fields and four ECR sha256 identities required; no secret values or cloud claims.",
    );
}

export function isolatedEnvironment(directory, source = process.env) {
  return {
    PATH: source.PATH ?? "/usr/bin:/bin",
    HOME: directory,
    TMPDIR: directory,
    CHECKPOINT_DISABLE: "1",
    TF_IN_AUTOMATION: "1",
    TF_INPUT: "0",
    TF_CLI_CONFIG_FILE: join(directory, "offline.tfrc"),
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_CONFIG_FILE: join(directory, "empty-aws-config"),
    AWS_SHARED_CREDENTIALS_FILE: join(directory, "empty-aws-config"),
  };
}

function inputFiles(directory, prefix = "") {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const relative = join(prefix, name);
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink())
        throw new Error(
          `Symlinks forbidden in infrastructure inputs: ${relative}`,
        );
      if (name === ".terraform") return [];
      if (stat.isDirectory()) return inputFiles(path, relative);
      return [relative];
    });
}

export function auditInputs(root) {
  const directory = join(root, "infra/opentofu");
  const files = inputFiles(directory);
  for (const file of files) {
    if (
      /\.(?:tf|tofu)(?:test)?\.(?:json|hcl)$/.test(file) &&
      ![
        "bootstrap/tests/offline.tftest.json",
        "registry/tests/offline.tftest.json",
        "stack/tests/offline.tftest.json",
      ].includes(file)
    )
      throw new Error(`Unexpected executable IaC input: ${file}`);
    if (!file.endsWith(".tf")) continue;
    const source = readFileSync(join(directory, file), "utf8");
    if (
      /\bprovisioner\s+|\bdata\s+"(?!aws_)|\bresource\s+"(?!aws_)|\b(file|filebase64|fileexists|fileset|templatefile|pathexpand)\s*\(/.test(
        source,
      )
    )
      throw new Error(
        `Non-AWS provider, executable provisioner or external file access forbidden: ${file}`,
      );
    for (const provider of source.matchAll(
      /provider\s+"([^"]+)"\s*\{([\s\S]*?)^\}/gm,
    )) {
      const alias = provider[2].match(/\balias\s*=\s*"([^"]+)"/)?.[1];
      if (
        provider[1] !== "aws" ||
        (alias && alias !== "backup") ||
        /\b(access_key|secret_key|token|profile|shared_credentials_files|shared_config_files|assume_role)\s*(=|\{)/.test(
          provider[2],
        )
      )
        throw new Error(`Unsafe offline provider configuration in ${file}`);
    }
    const sourceAssignments = [...source.matchAll(/\bsource\s*=\s*/g)];
    const literalSources = [...source.matchAll(/\bsource\s*=\s*"([^"]+)"/g)];
    if (sourceAssignments.length !== literalSources.length)
      throw new Error(`Unapproved dynamic provider/module source in ${file}`);
    for (const match of literalSources) {
      if (
        match[1] !== "hashicorp/aws" &&
        !/^\.\.\/modules\/[a-z]+$/.test(match[1])
      )
        throw new Error(`Unapproved provider/module source in ${file}`);
    }
  }
  validateOfflineTest(
    JSON.parse(
      readFileSync(join(directory, "stack/tests/offline.tftest.json")),
    ),
    ["aws", "aws.backup"],
  );
  validateOfflineTest(
    JSON.parse(
      readFileSync(join(directory, "bootstrap/tests/offline.tftest.json")),
    ),
    ["aws"],
  );
  validateOfflineTest(
    JSON.parse(
      readFileSync(join(directory, "registry/tests/offline.tftest.json")),
    ),
    ["aws"],
  );
  validateDeploymentManifest(
    JSON.parse(
      readFileSync(join(directory, "deployment-manifest.example.json")),
    ),
  );
  return files.filter(
    (file) =>
      file.endsWith(".tf") ||
      [
        "bootstrap/tests/offline.tftest.json",
        "registry/tests/offline.tftest.json",
        "stack/tests/offline.tftest.json",
        "deployment-manifest.example.json",
        "deployment-manifest.schema.json",
        "toolchain.json",
      ].includes(file) ||
      file.endsWith(".terraform.lock.hcl"),
  );
}

export function checkInfrastructure({ root, tofu, evidenceDirectory }) {
  const files = auditInputs(root);
  const sourceDirectory = join(root, "infra/opentofu");
  const hashes = Object.fromEntries(
    files.map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(join(sourceDirectory, file)))
        .digest("hex"),
    ]),
  );
  const report = {
    schemaVersion: 1,
    scope: "offline-infrastructure",
    cloudEvidence: false,
    commands: [],
    inputSha256: hashes,
  };
  if (!tofu)
    return {
      ...report,
      status: "STATIC_ONLY",
      reason:
        "Pass --tofu /absolute/path/to/tofu to run real fmt/init/validate/mock plans.",
    };
  if (!existsSync(tofu)) throw new Error("OpenTofu executable not found.");
  const scratch = mkdtempSync(join(tmpdir(), "fan-support-iac-"));
  try {
    const providerCache = join(scratch, "provider-cache");
    mkdirSync(providerCache);
    // The lockfile still verifies cached binaries; this only avoids re-downloading
    // the same signed provider when a prior local initialization is available.
    const platform = `${process.platform === "win32" ? "windows" : process.platform}_${process.arch === "x64" ? "amd64" : process.arch}`;
    const providerRelative = join(
      "registry.opentofu.org",
      "hashicorp",
      "aws",
      "6.66.0",
      platform,
    );
    const installedProvider = join(
      sourceDirectory,
      "stack",
      ".terraform",
      "providers",
      providerRelative,
    );
    if (existsSync(installedProvider)) {
      const cachedProvider = join(providerCache, providerRelative);
      mkdirSync(dirname(cachedProvider), { recursive: true });
      cpSync(installedProvider, cachedProvider, {
        recursive: true,
        dereference: true,
      });
    }
    writeFileSync(
      join(scratch, "offline.tfrc"),
      `disable_checkpoint = true\nplugin_cache_dir = ${JSON.stringify(providerCache)}\n`,
    );
    writeFileSync(join(scratch, "empty-aws-config"), "");
    const env = isolatedEnvironment(scratch);
    const run = (cwd, args) => {
      const result = spawnSync(tofu, args, {
        cwd,
        env,
        encoding: "utf8",
        timeout: 240_000,
        maxBuffer: 20 * 1024 * 1024,
        shell: false,
      });
      report.commands.push({
        args,
        workingDirectory: cwd.endsWith("bootstrap")
          ? "bootstrap"
          : cwd.endsWith("registry")
            ? "registry"
            : cwd.endsWith("stack")
              ? "stack"
              : "toolchain",
        exitCode: result.status,
      });
      if (evidenceDirectory)
        writeFileSync(
          join(
            evidenceDirectory,
            `${report.commands.length}-${report.commands.at(-1).workingDirectory}-${args[0]}.log`,
          ),
          `${result.stdout ?? ""}${result.stderr ?? ""}`,
        );
      if (result.error || result.status !== 0)
        throw new Error(
          `Offline ${args[0]} failed (exit ${result.status}); see evidence log.`,
          { cause: result.error },
        );
      return result.stdout;
    };
    const version = JSON.parse(run(scratch, ["version", "-json"]));
    if (version.terraform_version !== "1.12.6")
      throw new Error("OpenTofu 1.12.6 is required by the pinned toolchain.");
    for (const file of files) {
      const target = join(scratch, "infra", file);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(sourceDirectory, file), target, { dereference: false });
    }
    run(join(scratch, "infra"), ["fmt", "-check", "-recursive", "-no-color"]);
    for (const unit of ["bootstrap", "registry", "stack"]) {
      for (const command of buildOfflineCommands(join(scratch, "infra", unit)))
        run(command.cwd, command.args);
    }
    report.status = "PASS";
    return report;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let reportPath;
  try {
    const args = process.argv.slice(2);
    if (
      args.length !== 0 &&
      !(args.length === 2 && args[0] === "--tofu" && args[1].startsWith("/"))
    )
      throw new Error(
        "Usage: node scripts/check-infrastructure.mjs [--tofu /absolute/path/to/tofu]",
      );
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const evidenceDirectory = join(
      root,
      "output/checks/p5-08-local-deployment/iac",
    );
    mkdirSync(evidenceDirectory, { recursive: true });
    reportPath = join(
      evidenceDirectory,
      args.length ? "offline-results.json" : "static-results.json",
    );
    writeFileSync(
      reportPath,
      `${JSON.stringify({ schemaVersion: 1, status: "RUNNING", cloudEvidence: false })}\n`,
    );
    const report = checkInfrastructure({
      root,
      tofu: args[1],
      evidenceDirectory,
    });
    writeFileSync(
      join(
        evidenceDirectory,
        args.length ? "offline-results.json" : "static-results.json",
      ),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      `Infrastructure ${report.status}; cloudEvidence=false; ${Object.keys(report.inputSha256).length} hashed inputs.`,
    );
  } catch (error) {
    if (reportPath)
      writeFileSync(
        reportPath,
        `${JSON.stringify({ schemaVersion: 1, status: "FAIL", cloudEvidence: false, error: error.message })}\n`,
      );
    console.error(error.message);
    process.exitCode = 1;
  }
}
