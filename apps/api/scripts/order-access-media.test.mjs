import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStorefrontMediaGateway } from "./storefront-media-fixtures.mjs";

const runtime = await import("./order-access-media.mjs").catch(() => undefined);

test("replacement media origin owns distinct certificate files and verifies actual TLS", async () => {
  assert.equal(typeof runtime?.createOrderAccessMediaGateway, "function");
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "order-access-media-"),
  );
  let original, replacement;
  try {
    const ca = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        path.join(directory, "ca.key"),
        "-out",
        path.join(directory, "ca.crt"),
        "-subj",
        "/CN=Order Access TEST CA",
        "-days",
        "1",
      ],
      { stdio: "ignore" },
    );
    assert.equal(ca.status, 0);
    const options = {
      configPath: path.join(directory, "context.json"),
      s3: {
        endpoint: "http://127.0.0.1:1",
        accessKeyId: "test-only",
        secretAccessKey: "test-only",
        derivativeBucket: "test-only",
      },
    };
    original = await createStorefrontMediaGateway(options);
    replacement = await runtime.createOrderAccessMediaGateway(options);
    assert.notEqual(original.origin, replacement.origin);
    assert.equal((await original.probe("/not-published")).status, 404);
    assert.equal((await replacement.probe("/not-published")).status, 404);
    await replacement.close();
    replacement = undefined;
    assert.equal(
      (await readdir(directory)).some((name) =>
        name.startsWith("order-access-"),
      ),
      false,
    );
  } finally {
    await replacement?.close();
    await original?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
