import test from "node:test";
import assert from "node:assert/strict";
import { resolveStorefrontConfig } from "@fan-support/config/server";
import { localStorefrontIdentity } from "./local-experience-web-config.mjs";

test("a fresh local storefront has an explicit valid TEST identity", () => {
  const environment = localStorefrontIdentity({});
  const config = resolveStorefrontConfig({ environment });
  assert.equal(config.name, "LOCAL TEST STUDIO");
});

test("an explicit local display name is validated without changing formal site configuration", () => {
  const environment = localStorefrontIdentity({
    FAN_SUPPORT_LOCAL_STOREFRONT_NAME: "My local preview",
  });
  assert.equal(
    resolveStorefrontConfig({ environment }).name,
    "My local preview",
  );
  assert.throws(
    () =>
      localStorefrontIdentity({
        FAN_SUPPORT_LOCAL_STOREFRONT_NAME: "bad\nname",
      }),
    /Invalid storefront/u,
  );
});
