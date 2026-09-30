import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireLocalWorkspaceLock } from "../../../scripts/local-experience-lock.mjs";
import {
  assertPrebuiltWebCurrent,
  buildLocalWeb,
  localExperienceRoot,
  webBuildStampPath,
} from "./local-experience-web-build.mjs";

const HEAD = "a".repeat(40);
const NEXT = "b".repeat(40);

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fan-local-web-build-"));
  await mkdir(path.join(root, "node_modules"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function compile(root, id) {
  for (const app of ["admin", "storefront"]) {
    await mkdir(path.join(root, "apps", app, ".next"), { recursive: true });
    await writeFile(path.join(root, "apps", app, ".next", "BUILD_ID"), id);
  }
}

test("a successful build stamps the exact revision and both compiled applications", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    assertPrebuiltWebCurrent(root, HEAD),
    /pnpm local:build-web/u,
  );
  const builds = [];
  const code = await buildLocalWeb({
    workspaceRoot: root,
    revisionOf: async () => HEAD,
    runBuild: async (workspaceRoot) => {
      builds.push(workspaceRoot);
      await compile(root, "build-1");
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(builds, [root]);
  const stamp = JSON.parse(await readFile(webBuildStampPath(root), "utf8"));
  assert.equal(stamp.schemaVersion, 1);
  assert.equal(stamp.revision, HEAD);
  assert.deepEqual(stamp.buildIds, { admin: "build-1", storefront: "build-1" });
  await assertPrebuiltWebCurrent(root, HEAD);
  // A newer checkout, or a compile outside this command, makes the stamp stale.
  await assert.rejects(
    assertPrebuiltWebCurrent(root, NEXT),
    /pnpm local:build-web/u,
  );
  await writeFile(
    path.join(root, "apps", "admin", ".next", "BUILD_ID"),
    "other",
  );
  await assert.rejects(
    assertPrebuiltWebCurrent(root, HEAD),
    /pnpm local:build-web/u,
  );
});

test("a failed build returns its exit code and leaves no stamp, not even the previous one", async (t) => {
  const root = await fixture(t);
  await buildLocalWeb({
    workspaceRoot: root,
    revisionOf: async () => HEAD,
    runBuild: async () => (await compile(root, "build-1"), 0),
  });
  const code = await buildLocalWeb({
    workspaceRoot: root,
    revisionOf: async () => HEAD,
    runBuild: async () => 2,
  });
  assert.equal(code, 2);
  await assert.rejects(readFile(webBuildStampPath(root)), { code: "ENOENT" });
  await assert.rejects(assertPrebuiltWebCurrent(root, HEAD));
});

test("a checkout that moves during the build is never stamped", async (t) => {
  const root = await fixture(t);
  let calls = 0;
  await assert.rejects(
    buildLocalWeb({
      workspaceRoot: root,
      revisionOf: async () => (calls++ === 0 ? HEAD : NEXT),
      runBuild: async () => (await compile(root, "build-1"), 0),
    }),
    /changed during the build/u,
  );
  await assert.rejects(readFile(webBuildStampPath(root)), { code: "ENOENT" });
});

test("the build refuses while an instance owns the checkout and does not run", async (t) => {
  const root = await fixture(t);
  const owner = {
    instance: "stg",
    instanceId: "00000000-0000-4000-8000-000000000001",
    runId: "00000000-0000-4000-8000-000000000002",
    pid: process.pid,
  };
  const release = await acquireLocalWorkspaceLock(
    await localExperienceRoot(root),
    owner,
  );
  let ran = false;
  try {
    await assert.rejects(
      buildLocalWeb({
        workspaceRoot: root,
        revisionOf: async () => HEAD,
        runBuild: async () => ((ran = true), 0),
      }),
      /Stop the running local instance/u,
    );
    assert.equal(ran, false);
  } finally {
    await release();
  }
  // Once the instance has released the checkout, the build proceeds.
  assert.equal(
    await buildLocalWeb({
      workspaceRoot: root,
      revisionOf: async () => HEAD,
      runBuild: async () => (await compile(root, "build-2"), 0),
    }),
    0,
  );
});
