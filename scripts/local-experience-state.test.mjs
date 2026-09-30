import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  stat,
  symlink,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadLocalState,
  resetLocalState,
  setLocalAdminSignIn,
  setLocalWebMode,
} from "./local-experience-state.mjs";
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fan-local-state-"));
  await mkdir(path.join(root, "node_modules"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test("restart preserves instance identity, keys and endpoints byte for byte", async (t) => {
  const root = await fixture(t);
  const first = await loadLocalState(root, "test");
  const before = await readFile(path.join(first.stateDirectory, "config.json"));
  const next = await loadLocalState(root, "test");
  assert.deepEqual(next.config, first.config);
  assert.deepEqual(
    await readFile(path.join(next.stateDirectory, "config.json")),
    before,
  );
  assert.equal((await stat(first.stateDirectory)).mode & 0o777, 0o700);
  assert.equal(
    (await stat(path.join(first.stateDirectory, "config.json"))).mode & 0o777,
    0o600,
  );
  assert.equal(
    new Set(Object.values(first.config.ports)).size,
    Object.values(first.config.ports).length,
  );
  assert.notEqual(
    first.config.secrets.tokenPepper,
    first.config.secrets.subjectPepper,
  );
});
test("invalid instance and symlink storage fail closed without touching another directory", async (t) => {
  const root = await fixture(t);
  await assert.rejects(loadLocalState(root, "../outside"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "fan-local-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(path.join(root, "node_modules/.cache"), { recursive: true });
  await symlink(
    outside,
    path.join(root, "node_modules/.cache/fan-support-local-experience"),
  );
  await assert.rejects(loadLocalState(root, "test"), /symlink|canonical/i);
});
test("corrupt state is never silently regenerated and reset requires exact identity", async (t) => {
  const root = await fixture(t);
  const state = await loadLocalState(root, "test");
  await assert.rejects(
    resetLocalState(root, "test", "incorrect"),
    /confirmation/i,
  );
  await writeFile(path.join(state.stateDirectory, "config.json"), "{}");
  await assert.rejects(loadLocalState(root, "test"), /state|configuration/i);
});

test("existing configuration cannot redirect private files outside its instance", async (t) => {
  const root = await fixture(t);
  const state = await loadLocalState(root, "test");
  state.config.tls.privateKeyPath = path.join(root, "outside.key");
  await writeFile(
    path.join(state.stateDirectory, "config.json"),
    JSON.stringify(state.config),
  );
  await assert.rejects(loadLocalState(root, "test"), /configuration|path/);
});

test("a symlinked configuration is refused before reading it", async (t) => {
  const root = await fixture(t);
  const state = await loadLocalState(root, "test");
  const file = path.join(state.stateDirectory, "config.json"),
    other = path.join(root, "borrowed.json");
  await writeFile(other, JSON.stringify(state.config));
  await rm(file);
  await symlink(other, file);
  await assert.rejects(loadLocalState(root, "test"), /symlink/);
});
test("a public instance fixes its base domain and serves every origin on 443", async (t) => {
  const root = await fixture(t);
  const publicBaseDomain = "stg.example.com";
  const first = await loadLocalState(root, "public", { publicBaseDomain });
  assert.deepEqual(first.config.exposure, {
    mode: "PUBLIC",
    baseDomain: publicBaseDomain,
  });
  assert.equal(
    first.config.origins.storefront,
    "https://storefront.stg.example.com",
  );
  assert.equal(first.config.origins.psp, "https://payments.stg.example.com");
  assert.deepEqual(first.config.services.psp.binding.allowedActionOrigins, [
    first.config.origins.psp,
  ]);
  assert.equal(
    first.config.services.mail.profile.apiOrigin,
    first.config.origins.mail,
  );
  // Restarts may omit or repeat the domain; another domain needs a new instance.
  assert.deepEqual((await loadLocalState(root, "public")).config, first.config);
  assert.deepEqual(
    (await loadLocalState(root, "public", { publicBaseDomain })).config,
    first.config,
  );
  await assert.rejects(
    loadLocalState(root, "public", { publicBaseDomain: "other.example.com" }),
    /different exposure/u,
  );
  await loadLocalState(root, "loopback");
  await assert.rejects(
    loadLocalState(root, "loopback", { publicBaseDomain }),
    /different exposure/u,
  );
  for (const invalid of ["localhost", "a.example.invalid", "Stg.Example.com"])
    await assert.rejects(
      loadLocalState(root, "never", { publicBaseDomain: invalid }),
      /Invalid public base domain/u,
    );
});

test("Stripe sandbox is an explicit immutable choice for a new isolated instance", async (t) => {
  const root = await fixture(t);
  const first = await loadLocalState(root, "test-stripe", {
    paymentProvider: "stripe-test",
  });
  assert.equal(first.config.paymentProvider, "stripe-test");
  assert.equal(first.config.services.psp.binding.providerCode, "stripe");
  assert.equal(first.config.services.psp.binding.environment, "TEST");
  assert.deepEqual(first.config.services.psp.binding.allowedActionOrigins, [
    "https://checkout.stripe.com",
  ]);
  assert.deepEqual(
    (await loadLocalState(root, "test-stripe")).config,
    first.config,
  );
  await assert.rejects(
    loadLocalState(root, "test-stripe", { paymentProvider: "fake" }),
    /payment provider/u,
  );
  await loadLocalState(root, "test-fake");
  await assert.rejects(
    loadLocalState(root, "test-fake", { paymentProvider: "stripe-test" }),
    /payment provider/u,
  );
  for (const instance of ["default", "production"])
    await assert.rejects(
      loadLocalState(root, instance, { paymentProvider: "stripe-test" }),
      /isolated/u,
    );
  await assert.rejects(
    loadLocalState(root, "test-public", {
      paymentProvider: "stripe-test",
      publicBaseDomain: "stg.example.com",
    }),
    /isolated/u,
  );
  await assert.rejects(
    loadLocalState(root, "test-live", { paymentProvider: "stripe-live" }),
    /payment provider/u,
  );
});

test("admin sign-in switches only an existing instance and keeps everything else", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    setLocalAdminSignIn(root, "missing", "LOCAL_ACCOUNT"),
    /Unknown local instance/u,
  );
  const first = await loadLocalState(root, "test");
  assert.equal(first.config.adminSignIn, undefined);
  await assert.rejects(
    setLocalAdminSignIn(root, "test", "OIDC"),
    /LOCAL_OIDC or LOCAL_ACCOUNT/u,
  );
  const switched = await setLocalAdminSignIn(root, "test", "LOCAL_ACCOUNT");
  assert.equal(switched.adminSignIn, "LOCAL_ACCOUNT");
  const reloaded = await loadLocalState(root, "test");
  assert.deepEqual(reloaded.config, {
    ...first.config,
    adminSignIn: "LOCAL_ACCOUNT",
  });
  assert.equal(
    (await setLocalAdminSignIn(root, "test", "LOCAL_OIDC")).adminSignIn,
    "LOCAL_OIDC",
  );
});

test("compiled web mode needs built-in accounts, switches back and keeps everything else", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    setLocalWebMode(root, "missing", "PREBUILT"),
    /Unknown local instance/u,
  );
  const first = await loadLocalState(root, "test");
  assert.equal(first.config.webMode, undefined);
  await assert.rejects(
    setLocalWebMode(root, "test", "production"),
    /PREBUILT or DEVELOPMENT/u,
  );
  // The compiled admin runs in the test tier only with built-in accounts.
  await assert.rejects(setLocalWebMode(root, "test", "PREBUILT"));
  assert.equal((await loadLocalState(root, "test")).config.webMode, undefined);
  await setLocalAdminSignIn(root, "test", "LOCAL_ACCOUNT");
  const compiled = await setLocalWebMode(root, "test", "PREBUILT");
  assert.equal(compiled.webMode, "PREBUILT");
  assert.deepEqual((await loadLocalState(root, "test")).config, {
    ...first.config,
    adminSignIn: "LOCAL_ACCOUNT",
    webMode: "PREBUILT",
  });
  await assert.rejects(setLocalAdminSignIn(root, "test", "LOCAL_OIDC"));
  // DEVELOPMENT removes the field, so older code can read the configuration again.
  const development = await setLocalWebMode(root, "test", "DEVELOPMENT");
  assert.equal("webMode" in development, false);
  const text = await readFile(
    path.join(first.stateDirectory, "config.json"),
    "utf8",
  );
  assert.doesNotMatch(text, /webMode/u);
  assert.deepEqual((await loadLocalState(root, "test")).config, {
    ...first.config,
    adminSignIn: "LOCAL_ACCOUNT",
  });
});
