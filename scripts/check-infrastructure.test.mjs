import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOfflineCommands,
  validateOfflineTest,
  validateDeploymentManifest,
  isolatedEnvironment,
} from "./check-infrastructure.mjs";
const fixture = () => ({
  schemaVersion: 1,
  environment: "staging",
  region: "us-east-1",
  backupRegion: "us-west-2",
  releaseCommit: "a".repeat(40),
  images: Object.fromEntries(
    ["storefront", "admin", "api", "worker"].map((app) => [
      app,
      `000000000000.dkr.ecr.us-east-1.amazonaws.com/fixture/${app}@sha256:${"a".repeat(64)}`,
    ]),
  ),
  cloudEvidence: false,
});
test("offline command sequence cannot apply, refresh or activate a backend", () => {
  const commands = buildOfflineCommands("/scratch");
  assert.deepEqual(
    commands.map((c) => c.args[0]),
    ["fmt", "init", "validate", "test"],
  );
  assert.ok(commands[1].args.includes("-backend=false"));
  assert.ok(commands[1].args.includes("-lockfile=readonly"));
  assert.ok(commands[3].args.includes("-filter=tests/offline.tftest.json"));
  assert.throws(() => buildOfflineCommands("/scratch", ["apply"]), /argument/);
});
test("mock plan tests reject implicit apply, live providers, unmapped aliases and unknown blocks", () => {
  const good = {
    mock_provider: { aws: [{}, { alias: "backup" }] },
    run: {
      topology: {
        command: "plan",
        plan_options: { refresh: false },
        assert: [{ condition: "${true}", error_message: "fixture" }],
      },
    },
  };
  assert.doesNotThrow(() => validateOfflineTest(good, ["aws", "aws.backup"]));
  for (const bad of [
    { ...good, provider: { aws: {} } },
    { ...good, mock_provider: { aws: {} } },
    { ...good, run: { topology: { ...good.run.topology, command: "apply" } } },
    { ...good, run: { topology: { assert: [] } } },
    {
      ...good,
      run: {
        topology: { ...good.run.topology, plan_options: { refresh: true } },
      },
    },
    {
      ...good,
      run: {
        topology: { ...good.run.topology, providers: { aws: "aws.live" } },
      },
    },
  ])
    assert.throws(
      () => validateOfflineTest(bad, ["aws", "aws.backup"]),
      /offline/,
    );
});
test("manifest accepts four immutable digests and rejects tags, extra apps, unknown evidence and invalid region", () => {
  assert.doesNotThrow(() => validateDeploymentManifest(fixture()));
  const tag = fixture();
  tag.images.api = "repo:latest";
  const missing = fixture();
  delete missing.images.worker;
  const extra = fixture();
  extra.images.redis = extra.images.worker;
  const live = fixture();
  live.cloudEvidence = true;
  const secret = fixture();
  secret.password = "must-not-be-stored";
  const region = fixture();
  region.region = "somewhere-else";
  for (const value of [tag, missing, extra, live, secret, region])
    assert.throws(() => validateDeploymentManifest(value), /manifest/);
});
test("child process environment excludes credentials, CLI injection and user config", () => {
  const env = isolatedEnvironment("/scratch", {
    PATH: "/bin",
    HOME: "/real",
    AWS_PROFILE: "production",
    AWS_ACCESS_KEY_ID: "redacted",
    TF_CLI_ARGS: "-target=unsafe",
    TF_VAR_secret: "redacted",
    HTTP_PROXY: "http://example.invalid",
  });
  assert.equal(env.HOME, "/scratch");
  assert.equal(env.AWS_EC2_METADATA_DISABLED, "true");
  for (const key of [
    "AWS_PROFILE",
    "AWS_ACCESS_KEY_ID",
    "TF_CLI_ARGS",
    "TF_VAR_secret",
    "HTTP_PROXY",
  ])
    assert.equal(env[key], undefined);
});

test("unmocked provider aliases and executable providers fail before any tool runs", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { auditInputs } = await import("./check-infrastructure.mjs");
  const root = mkdtempSync(join(tmpdir(), "iac-checker-test-"));
  const directory = join(root, "infra/opentofu");
  mkdirSync(directory, { recursive: true });
  try {
    for (const source of [
      'provider "aws" {\n alias = "live"\n}',
      'provider "aws" {\n access_key = "forbidden"\n}',
      'data "external" "unsafe" {}',
      'resource "null_resource" "unsafe" {}',
      'resource "aws_s3_bucket" "unsafe" { provisioner "local-exec" {} }',
      'module "unsafe" { source = "https://example.invalid/module" }',
      'module "unsafe" { source = var.remote_module }',
    ]) {
      writeFileSync(join(directory, "unsafe.tf"), source);
      assert.throws(
        () => auditInputs(root),
        /Unsafe offline|forbidden|Unapproved/,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
