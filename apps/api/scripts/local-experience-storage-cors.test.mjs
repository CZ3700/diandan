import assert from "node:assert/strict";
import test from "node:test";
import * as storage from "./local-experience-storage.mjs";
const config = {
  origins: { admin: "https://admin.example.invalid:61000" },
  s3: { sourceBucket: "owned-source", derivativeBucket: "owned-derivatives" },
};
test("the source bucket accepts signed upload and original preview only from this admin origin", () => {
  assert.equal(typeof storage.localStorageCorsConfiguration, "function");
  assert.deepEqual(
    storage.localStorageCorsConfiguration(config, config.s3.sourceBucket),
    {
      CORSRules: [
        {
          AllowedOrigins: [config.origins.admin],
          AllowedMethods: ["PUT", "GET", "HEAD"],
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 300,
        },
      ],
    },
  );
});
test("the derivative bucket remains read-only and a second instance uses its own exact origin", () => {
  assert.equal(typeof storage.localStorageCorsConfiguration, "function");
  const other = {
    ...config,
    origins: { admin: "https://admin.example.invalid:62000" },
  };
  const rule = storage.localStorageCorsConfiguration(
    other,
    config.s3.derivativeBucket,
  ).CORSRules[0];
  assert.deepEqual(rule.AllowedOrigins, [other.origins.admin]);
  assert.deepEqual(rule.AllowedMethods, ["GET", "HEAD"]);
  assert.equal(Object.hasOwn(rule, "AllowCredentials"), false);
});
