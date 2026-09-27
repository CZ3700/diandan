import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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
    "https://oidc.example.com:8443",
    "https://unknown.stg.example.com",
    "http://oidc.stg.example.com",
  ])
    assert.throws(() => module.localServiceOrigin(value), /local service/iu);
  // A publicly exposed instance serves each owned service label under its base domain on 443.
  assert.equal(
    module.localServiceOrigin("https://payments.stg.example.com"),
    "https://payments.stg.example.com",
  );
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

for (const tagBytes of [4, 8, 12, 15]) {
  test(`mail capture rejects a truncated ${tagBytes}-byte authentication tag`, async () => {
    const { encryptMailCapture, decryptMailCapture } =
      await import("./local-experience-services-mail-store.mjs");
    const key = randomBytes(32);
    const encrypted = encryptMailCapture(key, "notification-one", {
      text: "synthetic test content",
    });
    const truncated = {
      ...encrypted,
      tag: Buffer.from(encrypted.tag, "base64url")
        .subarray(0, tagBytes)
        .toString("base64url"),
    };
    assert.throws(() => decryptMailCapture(key, "notification-one", truncated));
  });
}

test("mail capture keeps its 16-byte tag format and rejects tampered authenticated fields", async () => {
  const { encryptMailCapture, decryptMailCapture } =
    await import("./local-experience-services-mail-store.mjs");
  const key = randomBytes(32);
  const value = { text: "synthetic test content" };
  const encrypted = encryptMailCapture(key, "notification-one", value);
  assert.deepEqual(Object.keys(encrypted).sort(), [
    "ciphertext",
    "iv",
    "schemaVersion",
    "tag",
  ]);
  assert.equal(encrypted.schemaVersion, 1);
  assert.equal(Buffer.from(encrypted.tag, "base64url").length, 16);
  assert.deepEqual(
    decryptMailCapture(key, "notification-one", encrypted),
    value,
  );
  for (const field of ["iv", "tag", "ciphertext"]) {
    const tampered = Buffer.from(encrypted[field], "base64url");
    tampered[0] ^= 1;
    assert.throws(() =>
      decryptMailCapture(key, "notification-one", {
        ...encrypted,
        [field]: tampered.toString("base64url"),
      }),
    );
  }
});
