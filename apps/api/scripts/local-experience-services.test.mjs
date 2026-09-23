import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("local service transport refuses every destination outside its exact owned origins", async () => {
  const module = await import("./local-experience-services-common.mjs").catch(
    () => ({}),
  );
  assert.equal(
    typeof module.localServiceOrigin,
    "function",
    "local service origin guard exists",
  );
  assert.equal(
    module.localServiceOrigin("https://oidc.example.invalid:9443"),
    "https://oidc.example.invalid:9443",
  );
  for (const value of [
    "https://example.com",
    "http://oidc.example.invalid:9443",
    "https://oidc.example.invalid:9443/path",
    "https://user@oidc.example.invalid:9443",
    "https://localhost:9443",
  ])
    assert.throws(() => module.localServiceOrigin(value), /local service/iu);
});

test("OIDC signing identity survives restart and existing invalid keys are never overwritten", async () => {
  const module = await import("./local-experience-services-oidc.mjs").catch(
    () => ({}),
  );
  assert.equal(
    typeof module.readLocalOidcKey,
    "function",
    "durable OIDC signing key exists",
  );
  const directory = await mkdtemp(join(tmpdir(), "local-oidc-key-test-"));
  try {
    const path = join(directory, "oidc.pem");
    const first = await module.readLocalOidcKey(path);
    const second = await module.readLocalOidcKey(path);
    assert.deepEqual(first.jwk, second.jwk);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await writeFile(path, "invalid key", { mode: 0o600 });
    await assert.rejects(module.readLocalOidcKey(path));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("mail capture is authenticated encryption and rejects another notification identity", async () => {
  const module =
    await import("./local-experience-services-mail-store.mjs").catch(
      () => ({}),
    );
  assert.equal(
    typeof module.encryptMailCapture,
    "function",
    "encrypted local mailbox exists",
  );
  const key = randomBytes(32),
    value = {
      recipient: "test@example.test",
      content: { text: "private local test content" },
    };
  const encrypted = module.encryptMailCapture(key, "notification-one", value);
  assert(!JSON.stringify(encrypted).includes(value.recipient));
  assert(!JSON.stringify(encrypted).includes(value.content.text));
  assert.deepEqual(
    module.decryptMailCapture(key, "notification-one", encrypted),
    value,
  );
  assert.throws(() =>
    module.decryptMailCapture(key, "notification-two", encrypted),
  );
  assert.throws(() =>
    module.decryptMailCapture(randomBytes(32), "notification-one", encrypted),
  );
});
