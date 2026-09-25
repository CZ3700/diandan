import { expect, test } from "vitest";
import { resolveCartRuntimeConfig } from "./cart-runtime-config.js";

const region = "us-east-1";
const key =
  "arn:aws:kms:us-east-1:111122223333:key/11111111-1111-4111-8111-111111111111";
const env = {
  FAN_SUPPORT_CART_KMS_REGION: region,
  FAN_SUPPORT_CART_ENCRYPTION_KEY_VERSION: "encryption-v1",
  FAN_SUPPORT_CART_ENCRYPTION_KEY_IDS_JSON: JSON.stringify({
    "encryption-v1": key,
  }),
  FAN_SUPPORT_CART_BLIND_INDEX_KEY_VERSION: "blind-v2",
  FAN_SUPPORT_CART_BLIND_INDEX_KEY_IDS_JSON: JSON.stringify({
    "blind-v2": key,
    "blind-v1": key,
  }),
};
test("loads explicit immutable KMS references including retained key versions", () => {
  expect(resolveCartRuntimeConfig(env)).toEqual({
    schemaVersion: 1,
    region,
    activeEncryptionKeyVersion: "encryption-v1",
    encryptionKeyIdsByVersion: { "encryption-v1": key },
    activeBlindIndexKeyVersion: "blind-v2",
    blindIndexKeyIdsByVersion: { "blind-v2": key, "blind-v1": key },
  });
});
test("never defaults missing keys or accepts aliases, cross-region ARNs and unknown active versions", () => {
  expect(() => resolveCartRuntimeConfig({})).toThrow(
    "Invalid cart runtime configuration",
  );
  for (const replacement of [
    "{}",
    JSON.stringify({
      "blind-v2": "arn:aws:kms:us-east-1:111122223333:alias/current",
    }),
    JSON.stringify({ "blind-v2": key.replace(region, "eu-west-1") }),
    JSON.stringify({ "blind-v1": key }),
  ]) {
    expect(() =>
      resolveCartRuntimeConfig({
        ...env,
        FAN_SUPPORT_CART_BLIND_INDEX_KEY_IDS_JSON: replacement,
      }),
    ).toThrow("Invalid cart runtime configuration");
  }
});
test("rejected configuration values never appear in errors", () => {
  const secret = "PRIVATE_CONFIG_CANARY";
  try {
    resolveCartRuntimeConfig({
      ...env,
      FAN_SUPPORT_CART_BLIND_INDEX_KEY_IDS_JSON: secret,
    });
  } catch (error) {
    expect(String(error)).not.toContain(secret);
    return;
  }
  expect.fail("invalid configuration must reject");
});
