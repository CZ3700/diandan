import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { URL } from "node:url";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const module = await import("./regression-workspace.mjs").catch(() => ({}));
const execute = promisify(execFile);
const cleanGitEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

test("source enumeration ignores Git environment pointing at another repository", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "regression-source-git-"),
  );
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  try {
    const source = path.join(directory, "source"),
      other = path.join(directory, "other");
    for (const [cwd, name] of [
      [source, "package.json"],
      [other, "unrelated.txt"],
    ]) {
      await mkdir(cwd);
      await execute("git", ["init", "--quiet"], { cwd, env: clean });
      await writeFile(path.join(cwd, name), "{}");
      await execute("git", ["add", "--all"], { cwd, env: clean });
    }
    const probe = `const {readRegressionInventory}=await import(${JSON.stringify(new URL("./regression-workspace.mjs", import.meta.url).href)}); console.log(JSON.stringify(await readRegressionInventory(process.cwd())));`;
    const result = await execute(
      process.execPath,
      ["--input-type=module", "-e", probe],
      {
        cwd: source,
        env: {
          ...clean,
          GIT_DIR: path.join(other, ".git"),
          GIT_WORK_TREE: other,
          GIT_INDEX_FILE: path.join(other, ".git/index"),
        },
      },
    );
    assert.deepEqual(JSON.parse(result.stdout), ["package.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("source inventory honors unstaged deletions but refuses files lost after enumeration", async () => {
  assert.equal(typeof module.readRegressionInventory, "function");
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "regression-deletions-"),
  );
  const source = path.join(directory, "source");
  try {
    await mkdir(path.join(source, "apps/site"), { recursive: true });
    for (const name of ["deleted.ts", "remaining.ts"])
      await writeFile(path.join(source, "apps/site", name), "export {};");
    await execute("git", ["init", "--quiet"], {
      cwd: source,
      env: cleanGitEnvironment,
    });
    await execute("git", ["add", "--all"], {
      cwd: source,
      env: cleanGitEnvironment,
    });
    await rm(path.join(source, "apps/site/deleted.ts"));
    await writeFile(path.join(source, "apps/site/new.ts"), "export {};");
    const inventory = await module.readRegressionInventory(source);
    const report = await module.createRegressionWorkspace({
      source,
      destination: path.join(directory, "snapshot"),
      inventory,
    });
    assert.deepEqual(
      report.files.map(({ path }) => path),
      ["apps/site/new.ts", "apps/site/remaining.ts"],
    );
    await rm(path.join(source, "apps/site/remaining.ts"));
    await assert.rejects(
      module.createRegressionWorkspace({
        source,
        destination: path.join(directory, "race"),
        inventory,
      }),
      { code: "ENOENT" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("isolated source snapshots include owned new source, exclude private state and preserve original bytes", async () => {
  assert.equal(typeof module.createRegressionWorkspace, "function");
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "regression-snapshot-"),
  );
  try {
    const source = path.join(directory, "source"),
      destination = path.join(directory, "destination");
    await mkdir(path.join(source, "apps/site"), { recursive: true });
    for (const [name, value] of Object.entries({
      "package.json": "{}",
      ".dockerignore": "node_modules\n.env\n",
      "apps/site/new.ts": "export const value = 1;",
      ".env": "private",
      "unrelated.txt": "user",
    }))
      await writeFile(path.join(source, name), value);
    const inventory = [
      "package.json",
      ".dockerignore",
      "apps/site/new.ts",
      ".env",
      "unrelated.txt",
      "output/old.json",
      "research/reference.png",
      "node_modules/.cache/private.json",
    ];
    const report = await module.createRegressionWorkspace({
      source,
      destination,
      inventory,
    });
    assert.deepEqual(
      report.files.map(({ path }) => path),
      [".dockerignore", "apps/site/new.ts", "package.json"],
    );
    assert.equal(
      await readFile(path.join(destination, "apps/site/new.ts"), "utf8"),
      "export const value = 1;",
    );
    assert.equal(await readFile(path.join(source, ".env"), "utf8"), "private");
    assert.match(report.sourceHash, /^[a-f0-9]{64}$/u);
    await assert.rejects(
      module.createRegressionWorkspace({ source, destination, inventory }),
    );
    await writeFile(path.join(source, "apps/site/new.ts"), "changed");
    await assert.rejects(
      module.verifyRegressionSource(source, report),
      /changed/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("source snapshot rejects traversal and symbolic links", async () => {
  assert.equal(typeof module.createRegressionWorkspace, "function");
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "regression-snapshot-"),
  );
  try {
    const source = path.join(directory, "source");
    await mkdir(path.join(source, "apps/site"), { recursive: true });
    await writeFile(path.join(directory, "private"), "sensitive");
    await symlink(
      path.join(directory, "private"),
      path.join(source, "apps/site/linked.ts"),
    );
    for (const [i, input] of [
      "apps/../../private",
      "apps/site/linked.ts",
      "/absolute.ts",
    ].entries())
      await assert.rejects(
        module.createRegressionWorkspace({
          source,
          destination: path.join(directory, `case-${i}`),
          inventory: [input],
        }),
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("snapshot workspaces must not sit inside node_modules, which breaks TypeScript package names", () => {
  assert.equal(typeof module.regressionWorkspacePath, "function");
  const result = module.regressionWorkspacePath(
    "/workspace/project",
    "owned-run",
  );
  assert.equal(result.split(path.sep).includes("node_modules"), false);
  assert.equal(
    path.relative("/workspace/project", result).startsWith(".."),
    true,
  );
});
