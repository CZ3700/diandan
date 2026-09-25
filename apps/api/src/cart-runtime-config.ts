import { z } from "zod";
import { keyVersionSchema } from "@fan-support/contracts";
import type { KmsKeyManagementAdapterConfig } from "@fan-support/key-management-kms";

const arnSchema = z
  .string()
  .regex(
    /^arn:aws(?:-[a-z0-9-]+)?:kms:[a-z0-9-]+:[0-9]{12}:key\/[A-Za-z0-9-]{1,128}$/u,
  );
const keysSchema = z.record(keyVersionSchema, arnSchema);
const configSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    region: z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d+$/u),
    activeEncryptionKeyVersion: keyVersionSchema,
    encryptionKeyIdsByVersion: keysSchema,
    activeBlindIndexKeyVersion: keyVersionSchema,
    blindIndexKeyIdsByVersion: keysSchema,
  })
  .superRefine((config, context) => {
    for (const [keys, active, max] of [
      [config.encryptionKeyIdsByVersion, config.activeEncryptionKeyVersion, 32],
      [config.blindIndexKeyIdsByVersion, config.activeBlindIndexKeyVersion, 4],
    ] as const) {
      if (
        Object.keys(keys).length < 1 ||
        Object.keys(keys).length > max ||
        !Object.hasOwn(keys, active) ||
        Object.values(keys).some((key) => key.split(":")[3] !== config.region)
      ) {
        context.addIssue({ code: "custom", message: "Invalid key references" });
      }
    }
  })
  .readonly();

/** Server-only KMS references. AWS authentication remains with the SDK credential chain. */
export function resolveCartRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
): KmsKeyManagementAdapterConfig {
  try {
    const readMap = (value: string | undefined): unknown => {
      if (!value || value.length > 65536) throw new Error("Invalid key map");
      return JSON.parse(value) as unknown;
    };
    return configSchema.parse({
      schemaVersion: 1,
      region: environment["FAN_SUPPORT_CART_KMS_REGION"],
      activeEncryptionKeyVersion:
        environment["FAN_SUPPORT_CART_ENCRYPTION_KEY_VERSION"],
      encryptionKeyIdsByVersion: readMap(
        environment["FAN_SUPPORT_CART_ENCRYPTION_KEY_IDS_JSON"],
      ),
      activeBlindIndexKeyVersion:
        environment["FAN_SUPPORT_CART_BLIND_INDEX_KEY_VERSION"],
      blindIndexKeyIdsByVersion: readMap(
        environment["FAN_SUPPORT_CART_BLIND_INDEX_KEY_IDS_JSON"],
      ),
    });
  } catch {
    throw new TypeError("Invalid cart runtime configuration");
  }
}
