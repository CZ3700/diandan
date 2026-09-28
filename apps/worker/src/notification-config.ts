import { z } from "zod";
import {
  keyVersionSchema,
  notificationGatewayProfileSchema,
  notificationZeptoMailProfileSchema,
  paymentRuntimeOriginSchema,
  supportedLocaleSchema,
} from "@fan-support/contracts";
import type { KmsKeyManagementAdapterConfig } from "@fan-support/key-management-kms";
const profileName = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
export const workerNotificationConfigurationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    siteName: z
      .string()
      .min(1)
      .max(120)
      .refine(
        (v) =>
          ![...v].some((character) => {
            const point = character.charCodeAt(0);
            return point < 32 || point === 127;
          }),
      ),
    publicStorefrontOrigin: paymentRuntimeOriginSchema,
    activeProfile: profileName,
    profiles: z
      .array(
        z.strictObject({
          name: profileName,
          credentialEnvironmentVariable: z
            .string()
            .regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
          profile: z.union([
            notificationGatewayProfileSchema,
            notificationZeptoMailProfileSchema,
          ]),
        }),
      )
      .min(1)
      .max(16),
    linkPepperVersion: keyVersionSchema,
    acceptedPepperVersions: z.array(keyVersionSchema).min(1).max(4),
    linkTtlSeconds: z.number().int().min(1).max(604800),
    leaseSeconds: z.number().int().min(30).max(600),
    retryDelaySeconds: z.number().int().min(1).max(86400),
    maxAttempts: z.number().int().min(1).max(6),
    incidentFallbackLocales: z.array(supportedLocaleSchema).max(6),
  })
  .superRefine((c, ctx) => {
    if (
      new Set(c.profiles.map((p) => p.name)).size !== c.profiles.length ||
      !c.profiles.some((p) => p.name === c.activeProfile) ||
      !c.acceptedPepperVersions.includes(c.linkPepperVersion) ||
      new Set(c.acceptedPepperVersions).size !==
        c.acceptedPepperVersions.length ||
      c.incidentFallbackLocales.includes("en") ||
      new Set(c.incidentFallbackLocales).size !==
        c.incidentFallbackLocales.length ||
      c.profiles.some(
        (p) => p.profile.timeoutMs + 1000 >= c.leaseSeconds * 1000,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid notification configuration references",
      });
  });
export type WorkerNotificationConfiguration = z.infer<
  typeof workerNotificationConfigurationSchema
>;
const map = z.record(keyVersionSchema, z.string().min(1).max(2048));
const kms = z.strictObject({
  schemaVersion: z.literal(1),
  region: z.string().min(1),
  activeEncryptionKeyVersion: keyVersionSchema,
  encryptionKeyIdsByVersion: map,
  activeBlindIndexKeyVersion: keyVersionSchema,
  blindIndexKeyIdsByVersion: map,
});
/** Same server-side key references as checkout and order access; credentials use the SDK chain. */
export function resolveNotificationKms(
  environment: Readonly<Record<string, string | undefined>>,
): KmsKeyManagementAdapterConfig {
  try {
    const read = (key: string) => {
      const value = environment[key];
      if (!value || value.length > 65536) throw new Error("Invalid key map");
      return JSON.parse(value) as unknown;
    };
    return kms.parse({
      schemaVersion: 1,
      region: environment["FAN_SUPPORT_CART_KMS_REGION"],
      activeEncryptionKeyVersion:
        environment["FAN_SUPPORT_CART_ENCRYPTION_KEY_VERSION"],
      encryptionKeyIdsByVersion: read(
        "FAN_SUPPORT_CART_ENCRYPTION_KEY_IDS_JSON",
      ),
      activeBlindIndexKeyVersion:
        environment["FAN_SUPPORT_CART_BLIND_INDEX_KEY_VERSION"],
      blindIndexKeyIdsByVersion: read(
        "FAN_SUPPORT_CART_BLIND_INDEX_KEY_IDS_JSON",
      ),
    });
  } catch {
    throw new TypeError("Invalid notification worker configuration");
  }
}
