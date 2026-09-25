import { z } from "zod";
import {
  resolveConfigLayers,
  type RuntimeConfigSources,
} from "./config-layers.js";

const schema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.enum(["disabled", "local", "field"]),
  samplePermille: z.number().int().min(0).max(1000),
});
export type RumConfig = z.infer<typeof schema>;
export function resolveRumConfig(sources: RuntimeConfigSources): RumConfig {
  try {
    const values = resolveConfigLayers(sources, [
      "FAN_SUPPORT_RUM_MODE",
      "FAN_SUPPORT_RUM_SAMPLE_PERMILLE",
      "FAN_SUPPORT_DEPLOYMENT_ENV",
    ]);
    const rawRate = values.FAN_SUPPORT_RUM_SAMPLE_PERMILLE ?? "1000";
    if (
      typeof rawRate !== "string" ||
      !/^(?:0|[1-9][0-9]{0,3})$/u.test(rawRate)
    )
      throw new Error();
    const config = schema.parse({
      schemaVersion: 1,
      mode: values.FAN_SUPPORT_RUM_MODE ?? "disabled",
      samplePermille: Number(rawRate),
    });
    const tier = values.FAN_SUPPORT_DEPLOYMENT_ENV;
    if (
      (config.mode === "field" && tier !== "production") ||
      (config.mode === "local" &&
        !["development", "test", "preview", "staging"].includes(String(tier)))
    )
      throw new Error();
    return Object.freeze(config);
  } catch {
    throw new Error("Invalid RUM configuration");
  }
}
