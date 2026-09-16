import { Buffer } from "node:buffer";
import {
  keyManagementPortResponseSchema,
  orderAccessCredentialSchema,
  orderAccessRawTokenSchema,
  type NotificationDeliveryPlan,
} from "@fan-support/contracts";
import type { KeyManagementPort } from "@fan-support/key-management-port";

/** A domain-separated PRF permits crash-safe regeneration without storing a bearer credential. */
export async function deriveNotificationLink(
  keys: KeyManagementPort,
  plan: NotificationDeliveryPlan,
) {
  async function mac(value: string) {
    const parsed = keyManagementPortResponseSchema.safeParse(
      await keys.computeBlindIndex({
        schemaVersion: 1,
        operation: "COMPUTE_BLIND_INDEX",
        purpose: "ORDER_ACCESS_TOKEN",
        keyVersion: plan.linkPepperVersion,
        valueBase64: Buffer.from(value, "utf8").toString("base64url"),
      }),
    );
    if (
      !parsed.success ||
      parsed.data.outcome !== "SUCCESS" ||
      parsed.data.operation !== "COMPUTE_BLIND_INDEX" ||
      parsed.data.value.keyVersion !== plan.linkPepperVersion
    )
      throw new Error("Notification credential unavailable");
    return orderAccessRawTokenSchema.parse(parsed.data.value.digestBase64);
  }
  try {
    const token = await mac(
      `NOTIFICATION_LINK_DERIVE_V1\u0000${plan.notification.id}\u0000${plan.linkNonce}`,
    );
    const digest = await mac(`ORDER_LINK_V1\u0000${token}`);
    return {
      token,
      credential: orderAccessCredentialSchema.parse({
        schemaVersion: 1 as const,
        tokenDigest: Buffer.from(digest, "base64url").toString("hex"),
        pepperVersion: plan.linkPepperVersion,
      }),
    };
  } catch {
    throw new Error("Notification credential unavailable");
  }
}
