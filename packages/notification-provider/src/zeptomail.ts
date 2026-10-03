import { createHash } from "node:crypto";
import {
  notificationEmailDispatchSchema,
  notificationPortResponseSchema,
  notificationZeptoMailProfileSchema,
  type NotificationEmailDispatch,
  type NotificationZeptoMailProfile,
  type SendNotificationResponse,
} from "@fan-support/contracts";

export type ZeptoMailSubmissionOptions = Readonly<{
  profile: NotificationZeptoMailProfile;
  /** Raw Send Mail token; provider authentication never becomes part of profile identity. */
  resolveCredential(): Promise<string>;
  fetcher?: typeof fetch;
}>;
type ErrorCode = Extract<
  SendNotificationResponse,
  { outcome: "FAILURE" }
>["error"]["code"];
const retryable = new Set<ErrorCode>([
  "RATE_LIMITED",
  "TEMPORARY_UNAVAILABLE",
  "TIMEOUT_OUTCOME_UNKNOWN",
  "MALFORMED_PROVIDER_RESPONSE",
]);
function failure(
  code: ErrorCode,
  retryAfterMs = 1000,
): SendNotificationResponse {
  return notificationPortResponseSchema.parse({
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery: retryable.has(code) ? "RETRY_SAME_COMMAND" : "NONE",
      ...(retryable.has(code) ? { retryAfterMs } : {}),
    },
  });
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function normalizedResponse(
  status: number,
  body: unknown,
): SendNotificationResponse {
  if (!object(body)) return failure("MALFORMED_PROVIDER_RESPONSE");
  if (status === 400) {
    let code: unknown;
    if (object(body["data"])) code = body["data"]["error_code"];
    else if (object(body["error"])) code = body["error"]["code"];
    if (typeof code === "string") {
      if (["TM_3201", "TM_3301", "TM_8001"].includes(code))
        return failure("TEMPLATE_CONTENT_INVALID");
      if (["TM_3501", "TM_3601", "TM_4001", "TM_5001"].includes(code))
        return failure("CONFIGURATION_ERROR");
    }
  }
  if (
    status === 200 &&
    Array.isArray(body["data"]) &&
    body["data"].length === 1
  ) {
    const entry: unknown = body["data"][0];
    const documentedSuccess =
      object(entry) &&
      (entry["code"] === "EM_104" ||
        (entry["code"] === "EM_101" && body["object"] === "email"));
    if (
      documentedSuccess &&
      body["error"] === undefined &&
      typeof body["request_id"] === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:/+=-]{0,999}$/u.test(body["request_id"])
    ) {
      return notificationPortResponseSchema.parse({
        schemaVersion: 1,
        operation: "SEND_NOTIFICATION",
        outcome: "SUCCESS",
        value: {
          status: "ACCEPTED",
          providerReference: `zeptomail/${body["request_id"]}`,
          acceptedAt: new Date().toISOString(),
        },
      });
    }
  }
  return failure("MALFORMED_PROVIDER_RESPONSE");
}
function rateLimitDelay(header: string | null): number {
  if (!header || !/^\d{1,12}$/u.test(header)) return 1000;
  return Math.min(86_400_000, Math.max(100, Number(header) * 1000));
}

/** One native submission only. A durable platform journal must wrap this before worker use.
 * client_reference is correlation, never a provider idempotency guarantee. ACCEPTED means
 * API acceptance, not inbox delivery; dispatchNotAfter bounds local admission only.
 */
export function createZeptoMailSubmission(
  options: ZeptoMailSubmissionOptions,
): Readonly<{
  transportKey: string;
  submitter: Readonly<{
    sendEmail(
      command: NotificationEmailDispatch,
    ): Promise<SendNotificationResponse>;
  }>;
}> {
  const parsed = notificationZeptoMailProfileSchema.safeParse(options.profile);
  if (
    !parsed.success ||
    typeof options.resolveCredential !== "function" ||
    (parsed.data.environment === "TEST" &&
      typeof options.fetcher !== "function")
  )
    throw new TypeError("Invalid ZeptoMail configuration");
  const profile = Object.freeze(parsed.data);
  const transportKey = createHash("sha256")
    .update(JSON.stringify(profile))
    .digest("hex");
  const submitter = {
    async sendEmail(
      input: NotificationEmailDispatch,
    ): Promise<SendNotificationResponse> {
      const email = notificationEmailDispatchSchema.safeParse(input);
      if (!email.success) return failure("INVALID_COMMAND");
      if ([...email.data.content.subject].length > 500)
        return failure("TEMPLATE_CONTENT_INVALID");
      if (Date.now() >= Date.parse(email.data.dispatchNotAfter))
        return failure("CONFIGURATION_ERROR");
      const body = JSON.stringify({
        ...(profile.bounceEmail ? { bounce_address: profile.bounceEmail } : {}),
        from: { address: profile.fromEmail, name: profile.fromName },
        to: [{ email_address: { address: email.data.recipient } }],
        reply_to: [{ address: profile.replyToEmail }],
        subject: email.data.content.subject,
        textbody: email.data.content.text,
        htmlbody: email.data.content.html,
        client_reference: email.data.notification.id,
        track_clicks: false,
        track_opens: false,
      });
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let dispatched = false;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          void reader?.cancel().catch(() => undefined);
          reject(new Error("ZeptoMail deadline"));
        }, profile.timeoutMs);
      });
      const exchange = async (): Promise<SendNotificationResponse> => {
        const credential = await options.resolveCredential();
        if (controller.signal.aborted) throw new Error("ZeptoMail deadline");
        if (
          typeof credential !== "string" ||
          credential.length < 16 ||
          credential.length > 4096 ||
          /[^\x21-\x7e]/u.test(credential)
        )
          return failure("CONFIGURATION_ERROR");
        if (Date.now() >= Date.parse(email.data.dispatchNotAfter))
          return failure("CONFIGURATION_ERROR");
        dispatched = true;
        const response = await (options.fetcher ?? fetch)(
          new URL("/v1.1/email", profile.apiOrigin),
          {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              authorization: `Zoho-enczapikey ${credential}`,
            },
            body,
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted || response.redirected)
          throw new Error("ZeptoMail response unavailable");
        if (
          response.status === 401 ||
          response.status === 403 ||
          response.status === 429
        ) {
          void response.body?.cancel().catch(() => undefined);
          return response.status === 429
            ? failure(
                "RATE_LIMITED",
                rateLimitDelay(response.headers.get("retry-after")),
              )
            : failure("AUTHENTICATION_FAILED");
        }
        if (![200, 400].includes(response.status)) {
          void response.body?.cancel().catch(() => undefined);
          return failure("TIMEOUT_OUTCOME_UNKNOWN");
        }
        if (
          !/^application\/json(?:;|$)/iu.test(
            response.headers.get("content-type") ?? "",
          ) ||
          !response.body
        ) {
          void response.body?.cancel().catch(() => undefined);
          return failure("MALFORMED_PROVIDER_RESPONSE");
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
              return failure("MALFORMED_PROVIDER_RESPONSE");
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
          reader = undefined;
        }
        if (controller.signal.aborted) throw new Error("ZeptoMail deadline");
        try {
          const result: unknown = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          );
          return normalizedResponse(response.status, result);
        } catch {
          return failure("MALFORMED_PROVIDER_RESPONSE");
        }
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
  return Object.freeze({ transportKey, submitter: Object.freeze(submitter) });
}
