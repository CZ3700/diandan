import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

test("runtime passes only canonical service environment and retains the persistent secret identity", async () => {
  const module = await import("./local-experience-runtime-config.mjs").catch(
    () => null,
  );
  assert.ok(module, "local runtime configuration is available");
  const token = randomBytes(32).toString("base64url");
  assert.equal(
    module.localSecretHex(token),
    Buffer.from(token, "base64url").toString("hex"),
  );
  assert.throws(() => module.localSecretHex("short"), /secret/u);
  assert.throws(
    () =>
      module.localExperienceEnvironment({ config: { environment: "LIVE" } }),
    /LOCAL_TEST/u,
  );
  const config = {
    environment: "LOCAL_TEST",
    origins: {
      storefront: "https://storefront.example.invalid:3101",
      media: "https://media.example.invalid:3102",
    },
  };
  const database = {
    host: "127.0.0.1",
    port: 5439,
    user: "test",
    password: "space @ :",
    database: "test",
  };
  const s3 = {
    endpoint: "https://localhost:3900",
    sourceBucket: "source-test",
    derivativeBucket: "derivative-test",
    accessKeyId: token,
    secretAccessKey: token,
  };
  const environment = module.localExperienceEnvironment({
    config,
    database,
    s3,
  });
  assert.equal(
    new URL(environment.FAN_SUPPORT_DATABASE_URL).hostname,
    "127.0.0.1",
  );
  assert.equal(
    decodeURIComponent(new URL(environment.FAN_SUPPORT_DATABASE_URL).password),
    database.password,
  );
  assert.equal(environment.FAN_SUPPORT_SITE_ORIGIN, config.origins.storefront);
  assert.equal(
    environment.FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN,
    config.origins.media,
  );
  // The edge, BFF and API share loopback; only those hops may name the fan's address.
  assert.equal(
    environment.FAN_SUPPORT_TRUSTED_PROXY_CIDRS,
    "127.0.0.0/8,::1/128",
  );
  assert.throws(
    () =>
      module.localExperienceEnvironment({
        config,
        database: { ...database, host: "remote.example.com" },
        s3,
      }),
    /loopback/u,
  );
});
