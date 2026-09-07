import { z } from "zod";
import {
  resolveConfigLayers,
  type RuntimeConfigSources,
} from "./config-layers.js";
const schema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value)),
});
export function resolveStorefrontConfig(
  sources: RuntimeConfigSources,
): Readonly<z.infer<typeof schema>> {
  const values = resolveConfigLayers(sources, ["FAN_SUPPORT_STOREFRONT_NAME"]);
  const result = schema.safeParse({
    schemaVersion: 1,
    name: values.FAN_SUPPORT_STOREFRONT_NAME,
  });
  if (!result.success) throw new Error("Invalid storefront configuration");
  return Object.freeze(result.data);
}
