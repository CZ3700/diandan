import { createHash } from "node:crypto";
import {
  notificationEmailDispatchSchema,
  notificationGatewayProfileSchema,
  notificationGatewayReceiptSchema,
  notificationPortResponseSchema,
  sourceHashSchema,
  type NotificationGatewayProfile,
  type SendNotificationResponse,
} from "@fan-support/contracts";
import type { NotificationEmailTransport } from "@fan-support/notification-port";

export type NotificationGatewayOptions = Readonly<{
  profile: NotificationGatewayProfile;
  /** The credential itself is resolved only in the adapter; never included in profile identity. */
  resolveCredential(): Promise<string>;
  fetcher?: typeof fetch;
}>;
const failure = (
  code:
    | "INVALID_COMMAND"
    | "CONFIGURATION_ERROR"
    | "TEMPORARY_UNAVAILABLE"
    | "TIMEOUT_OUTCOME_UNKNOWN"
    | "MALFORMED_PROVIDER_RESPONSE",
): SendNotificationResponse =>
  notificationPortResponseSchema.parse({
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery: [
        "TEMPORARY_UNAVAILABLE",
        "TIMEOUT_OUTCOME_UNKNOWN",
        "MALFORMED_PROVIDER_RESPONSE",
      ].includes(code)
        ? "RETRY_SAME_COMMAND"
        : "NONE",
      ...([
        "TEMPORARY_UNAVAILABLE",
        "TIMEOUT_OUTCOME_UNKNOWN",
        "MALFORMED_PROVIDER_RESPONSE",
      ].includes(code)
        ? { retryAfterMs: 1000 }
        : {}),
    },
  });

/** Repository-owned HTTPS gateway protocol, not a claim of a universal mail-provider API. */
export function createNotificationGatewayTransport(
  options: NotificationGatewayOptions,
): Readonly<{ transportKey: string; transport: NotificationEmailTransport }> {
  const parsed = notificationGatewayProfileSchema.safeParse(options.profile);
  if (!parsed.success || typeof options.resolveCredential !== "function")
    throw new TypeError("Invalid notification gateway configuration");
  const profile = Object.freeze(parsed.data);
  const transportKey = sourceHashSchema.parse(
    createHash("sha256").update(JSON.stringify(profile)).digest("hex"),
  );
  const transport: NotificationEmailTransport = {
    async sendEmail(input) {
      const email = notificationEmailDispatchSchema.safeParse(input);
      if (!email.success) return failure("INVALID_COMMAND");
      const body = JSON.stringify({
        schemaVersion: 1,
        protocol: profile.protocol,
        profileHash: transportKey,
        environment: profile.environment,
        from: { email: profile.fromEmail, name: profile.fromName },
        replyTo: profile.replyToEmail,
        email: email.data,
      });
      const requestHash = createHash("sha256").update(body).digest("hex");
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let dispatched = false;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          void reader?.cancel().catch(() => undefined);
          reject(new Error("Notification deadline"));
        }, profile.timeoutMs);
      });
      const exchange = async (): Promise<SendNotificationResponse> => {
        const credential = await options.resolveCredential();
        if (controller.signal.aborted) throw new Error("Notification deadline");
        if (
          typeof credential !== "string" ||
          credential.length < 16 ||
          credential.length > 4096 ||
          /[^\x21-\x7e]/u.test(credential)
        )
          return failure("CONFIGURATION_ERROR");
        dispatched = true;
        const response = await (options.fetcher ?? fetch)(
          new URL("/v1/notification-commands", profile.apiOrigin),
          {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              authorization: `Bearer ${credential}`,
              "idempotency-key": email.data.notification.idempotencyKey,
            },
            body,
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (
          controller.signal.aborted ||
          response.status !== 200 ||
          response.redirected ||
          !/^application\/json(?:;|$)/iu.test(
            response.headers.get("content-type") ?? "",
          ) ||
          !response.body
        ) {
          void response.body?.cancel().catch(() => undefined);
          throw new Error("Notification response unavailable");
        }
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.byteLength;
            if (length > 65536) {
              void reader.cancel().catch(() => undefined);
              throw new Error("Notification response bound");
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
          reader = undefined;
        }
        if (controller.signal.aborted) throw new Error("Notification deadline");
        let value: unknown;
        try {
          value = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          );
        } catch {
          return failure("MALFORMED_PROVIDER_RESPONSE");
        }
        const receipt = notificationGatewayReceiptSchema.safeParse(value);
        if (
          !receipt.success ||
          receipt.data.profileHash !== transportKey ||
          receipt.data.requestHash !== requestHash ||
          receipt.data.notificationId.toLowerCase() !==
            email.data.notification.id.toLowerCase() ||
          receipt.data.idempotencyKey !== email.data.notification.idempotencyKey
        )
          return failure("MALFORMED_PROVIDER_RESPONSE");
        if (
          receipt.data.result.outcome === "SUCCESS" &&
          receipt.data.result.value.status === "ACCEPTED" &&
          Date.parse(receipt.data.result.value.acceptedAt) >=
            Date.parse(email.data.dispatchNotAfter)
        )
          return failure("MALFORMED_PROVIDER_RESPONSE");
        return receipt.data.result;
      };
      try {
        return await Promise.race([exchange(), deadline]);
      } catch {
        return failure(
          dispatched ? "TIMEOUT_OUTCOME_UNKNOWN" : "TEMPORARY_UNAVAILABLE",
        );
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        void reader?.cancel().catch(() => undefined);
      }
    },
  };
  return Object.freeze({ transportKey, transport: Object.freeze(transport) });
}
