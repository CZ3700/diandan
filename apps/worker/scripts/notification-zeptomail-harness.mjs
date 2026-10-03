/* global Buffer, URL, structuredClone */
/** Owned native ZeptoMail protocol fixture. Accepts every POST; platform PG owns deduplication.
 * Commands/bodies remain in RAM for actual email-link browser checks and are cleared on close.
 */
import { randomBytes } from "node:crypto";
import {
  notificationEmailDispatchSchema,
  notificationZeptoMailProfileSchema,
} from "@fan-support/contracts";
import { createZeptoMailSubmission } from "../../../packages/notification-provider/dist/index.js";
import { tlsHarness } from "../../../packages/notification-provider/src/harness.tls.ts";

export async function createZeptoMailNotificationHarness({ context }) {
  if (
    !context?.database ||
    !["127.0.0.1", "localhost"].includes(context.database.host)
  ) {
    throw new Error("ZeptoMail TEST fixture requires a local database context");
  }
  const credential = randomBytes(32).toString("base64url");
  let accepted = 0;
  let requests = 0;
  let dropNext = false;
  let command;
  let body;
  let closed = false;
  let profile;
  const server = await tlsHarness((request, response) => {
    void (async () => {
      requests++;
      if (
        request.method !== "POST" ||
        request.url !== "/v1.1/email" ||
        request.headers.authorization !== `Zoho-enczapikey ${credential}`
      ) {
        response.writeHead(401);
        response.end();
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 3_000_000) {
          response.writeHead(413);
          response.end();
          return;
        }
        chunks.push(chunk);
      }
      if (closed) {
        response.writeHead(503);
        response.end();
        return;
      }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        input.from?.address !== profile.fromEmail ||
        input.from?.name !== profile.fromName ||
        input.to?.length !== 1 ||
        typeof input.to[0]?.email_address?.address !== "string" ||
        input.reply_to?.length !== 1 ||
        input.reply_to[0]?.address !== profile.replyToEmail ||
        input.track_clicks !== false ||
        input.track_opens !== false ||
        typeof input.client_reference !== "string" ||
        typeof input.subject !== "string" ||
        typeof input.textbody !== "string" ||
        typeof input.htmlbody !== "string" ||
        Object.keys(input).some(
          (key) =>
            ![
              "from",
              "to",
              "reply_to",
              "subject",
              "textbody",
              "htmlbody",
              "client_reference",
              "track_clicks",
              "track_opens",
            ].includes(key),
        )
      ) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ data: { error_code: "TM_3201" }, message: "error" }),
        );
        return;
      }
      body = input;
      accepted++;
      if (dropNext) {
        dropNext = false;
        request.socket.destroy();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: [{ code: "EM_104", message: "OK" }],
          message: "OK",
          request_id: `owned-tls-${accepted}`,
        }),
      );
    })().catch(() => {
      if (!response.headersSent) response.writeHead(400);
      response.end();
    });
  });
  async function close() {
    if (closed) return;
    closed = true;
    command = undefined;
    body = undefined;
    await server.close();
    command = undefined;
    body = undefined;
  }
  try {
    profile = Object.freeze(
      notificationZeptoMailProfileSchema.parse({
        schemaVersion: 1,
        protocol: "zeptomail-v1",
        environment: "TEST",
        apiOrigin: server.origin,
        fromEmail: "orders@example.test",
        fromName: "TEST Studio",
        replyToEmail: "support@example.test",
        timeoutMs: 2000,
        idempotencyRetentionSeconds: 3600,
      }),
    );
    const trusted = server.fetcher();
    const instance = createZeptoMailSubmission({
      profile,
      resolveCredential: async () => credential,
      fetcher: (input, init) => {
        if (new URL(String(input)).origin !== server.origin)
          throw new Error("ZeptoMail TEST TLS target mismatch");
        return trusted(input, init);
      },
    });
    const harness = {
      profile,
      transportKey: instance.transportKey,
      submitter: {
        async sendEmail(input) {
          if (closed) throw new Error("ZeptoMail TEST fixture is closed");
          command = notificationEmailDispatchSchema.parse(input);
          return instance.submitter.sendEmail(command);
        },
      },
      acceptedCount: () => accepted,
      requestCount: () => requests,
      async inspect() {
        return {
          schemaVersion: 1,
          actualTls: true,
          actualEmail: false,
          requestCount: requests,
          acceptedCount: accepted,
          singleRecipient: body?.to.length === 1,
          trackingDisabled:
            body?.track_clicks === false && body?.track_opens === false,
        };
      },
      lastCommand: () =>
        command === undefined ? undefined : structuredClone(command),
      lastBody: () => (body === undefined ? undefined : structuredClone(body)),
      dropNextResponse() {
        dropNext = true;
      },
      close,
      scope:
        "Owned strict TLS native ZeptoMail receiver; accepts every POST, no external email; deduplication must be proven by the platform PostgreSQL journal.",
    };
    context.own?.("native ZeptoMail TEST TLS receiver", close);
    return Object.freeze(harness);
  } catch (error) {
    await close();
    throw error;
  }
}
