import { z } from "zod";
import {
  contentAuthoringContentSchema,
  paymentRuntimeConfigurationSchema,
} from "@fan-support/contracts";
import { canonicalPublicationValue } from "@fan-support/content";

const endpoint = z.strictObject({
  endpointId: z.uuid(),
  providerAccountId: z.uuid(),
  verificationKeyReferenceHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const localBusinessSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    testOnly: z.literal(true),
    managerId: z.uuid(),
    stage: z.enum(["IDENTITIES_READY", "PAYMENTS_READY", "READY"]),
    paymentConfiguration: paymentRuntimeConfigurationSchema,
    endpoint: endpoint.optional(),
    // Historical seed evidence is serializable metadata and never drives a runtime decision.
    published: z.json().optional(),
    policyPlans: z
      .partialRecord(
        z.enum(["terms", "privacy", "refund", "delivery"]),
        z.strictObject({
          content: contentAuthoringContentSchema,
          revisionId: z.uuid().optional(),
        }),
      )
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.stage !== "IDENTITIES_READY" && !value.endpoint)
      context.addIssue({
        code: "custom",
        message: "Ready bootstrap requires its original webhook endpoint",
      });
  });

export function parseLocalBusiness(value, config) {
  const parsed = localBusinessSchema.parse(value);
  if (
    parsed.managerId !==
      config.services.oidc.actors.find((actor) => actor.key === "manager")
        ?.id ||
    parsed.paymentConfiguration.publicStorefrontOrigin !==
      config.origins.storefront ||
    (parsed.endpoint &&
      (parsed.endpoint.endpointId !== config.services.psp.webhookEndpointId ||
        parsed.endpoint.providerAccountId !==
          config.services.psp.binding.providerAccountId))
  )
    throw new TypeError(
      "Stored local bootstrap identity does not match this instance",
    );
  return parsed;
}

export function matchingLocalPolicy(actual, planned) {
  const normalize = (value) => ({
    ...value,
    structure: {
      ...value.structure,
      effectiveAt: new Date(value.structure.effectiveAt).toISOString(),
    },
    translations: [...value.translations].sort((left, right) =>
      left.locale.localeCompare(right.locale),
    ),
  });
  return (
    actual.kind === "POLICY" &&
    planned.kind === "POLICY" &&
    canonicalPublicationValue(normalize(actual)) ===
      canonicalPublicationValue(normalize(planned))
  );
}
