import { expect, it } from "vitest";
import { resolveConfigLayers } from "./config-layers.js";

it("accepts declared server payment metadata while retaining environment precedence", () => {
  const key = "FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON";
  const sources = {
    configFile: { [key]: "file" },
    environment: {
      [key]: "environment",
      FAN_SUPPORT_PAYMENT_PROVIDER_BINDINGS_JSON: "[]",
      FAN_SUPPORT_PAYMENT_ACTION_ORIGINS_JSON: "[]",
    },
  };
  expect(resolveConfigLayers(sources, [key])).toEqual({ [key]: "environment" });
});
