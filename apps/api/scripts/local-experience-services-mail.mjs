import { createHash, createHmac, randomBytes } from "node:crypto";
import { URL } from "node:url";
import {
  notificationEmailDispatchSchema,
  notificationGatewayProfileSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { createNotificationGatewayTransport } from "../../../packages/notification-provider/dist/index.js";
import {
  createLocalExperienceFetch,
  escapeHtml,
  htmlPage,
  privateHeaders,
  readBody,
  secretBytes,
  secretEquals,
  startLocalTlsServer,
} from "./local-experience-services-common.mjs";
import { localServicePorts } from "./local-experience-config.mjs";
import { createLocalMailStore } from "./local-experience-services-mail-store.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
export async function createLocalExperienceMailTransport({ config }) {
  const profile = notificationGatewayProfileSchema.parse(
    config.services.mail.profile,
  );
  if (
    profile.environment !== "TEST" ||
    profile.apiOrigin !== config.origins.mail
  )
    throw new TypeError("Invalid local mail profile");
  const fetcher = await createLocalExperienceFetch({
    origins: [profile.apiOrigin],
    caCertificatePath: config.tls.caCertificatePath,
    ports: localServicePorts(config),
  });
  return {
    profile,
    fetcher,
    ...createNotificationGatewayTransport({
      profile,
      fetcher,
      resolveCredential: async () => config.services.mail.authorizationToken,
    }),
  };
}
function safeMailText(value, storefront) {
  return String(value)
    .split(/(https:\/\/[^\s<>]+)/gu)
    .map((part) => {
      try {
        const url = new URL(part);
        if (
          url.origin === storefront &&
          SUPPORTED_LOCALES.some(
            (locale) => url.pathname === `/${locale}/order-access`,
          ) &&
          url.hash.startsWith("#")
        )
          return `<a href="${escapeHtml(part)}">Open secure order link</a>`;
      } catch {
        /* Non-URL mail text stays escaped. */
      }
      return escapeHtml(part);
    })
    .join("");
}
/** Captures only: no SMTP, provider account or real outbound mail exists. */
export async function startLocalExperienceMail({ config, pool }) {
  const origin = config.origins.mail,
    settings = config.services.mail;
  const transport = await createLocalExperienceMailTransport({ config });
  const key = secretBytes(settings.captureEncryptionKey),
    viewer = secretBytes(settings.viewerToken);
  const session = createHmac("sha256", viewer)
    .update("local-mail-viewer-v1")
    .digest("base64url");
  const store = await createLocalMailStore({
    pool,
    key,
    profile: transport.profile,
    profileHash: transport.transportKey,
  });
  const authorized = (request) =>
    (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .some((part) => secretEquals(part, `__Host-local_mail=${session}`));
  const server = await startLocalTlsServer({
    origin,
    port: config.ports.mail,
    tls: config.tls,
    async handle(request, response) {
      const url = new URL(request.url, origin);
      if (
        request.method === "POST" &&
        url.pathname === "/v1/notification-commands" &&
        !url.search
      ) {
        if (
          !secretEquals(
            request.headers.authorization,
            `Bearer ${settings.authorizationToken}`,
          ) ||
          request.headers.cookie ||
          request.headers["content-type"] !== "application/json"
        ) {
          request.resume();
          response.writeHead(403).end();
          return;
        }
        const body = await readBody(request, 3_000_000),
          input = JSON.parse(body),
          parsed = notificationEmailDispatchSchema.safeParse(input.email),
          profile = transport.profile;
        if (
          !parsed.success ||
          input.schemaVersion !== 1 ||
          input.protocol !== profile.protocol ||
          input.environment !== "TEST" ||
          input.profileHash !== transport.transportKey ||
          input.from?.email !== profile.fromEmail ||
          input.from?.name !== profile.fromName ||
          input.replyTo !== profile.replyToEmail ||
          Object.keys(input).sort().join(",") !==
            "email,environment,from,profileHash,protocol,replyTo,schemaVersion" ||
          request.headers["idempotency-key"] !==
            parsed.data.notification.idempotencyKey
        ) {
          response.writeHead(400).end();
          return;
        }
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(await store.accept(parsed.data, sha(body))));
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/session" &&
        !url.search
      ) {
        const input = JSON.parse(await readBody(request));
        if (
          request.headers.origin !== origin ||
          Object.keys(input).join(",") !== "token" ||
          !secretEquals(input.token, settings.viewerToken)
        ) {
          response.writeHead(403).end();
          return;
        }
        response
          .writeHead(204, {
            "set-cookie": `__Host-local_mail=${session}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600`,
          })
          .end();
        return;
      }
      if (request.method !== "GET" || url.pathname !== "/" || url.search) {
        response.writeHead(404).end();
        return;
      }
      if (!authorized(request)) {
        const nonce = randomBytes(24).toString("base64url");
        response
          .writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": `${privateHeaders["content-security-policy"]}; script-src 'nonce-${nonce}'; connect-src 'self'`,
          })
          .end(
            htmlPage(
              "Local TEST mailbox",
              `<p id="status" role="status">Open this mailbox from the local experience launcher.</p><script nonce="${nonce}">const token=new URLSearchParams(location.hash.slice(1)).get('token');history.replaceState(null,'',location.pathname);if(token){fetch('/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token}),credentials:'same-origin'}).then(r=>{if(r.ok)location.reload();else document.getElementById('status').textContent='Mailbox access expired. Reopen it from the local launcher.';}).catch(()=>{document.getElementById('status').textContent='Mailbox unavailable. Reopen it from the local launcher.';});}</script>`,
            ),
          );
        return;
      }
      const messages = await store.list();
      response
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(
          htmlPage(
            "Local TEST mailbox",
            `<p>Captured locally. No email is sent. Messages expire from this view after the configured retention period.</p><p><a href="/">Refresh messages</a></p>${messages.length ? messages.map((mail) => `<article><h2>${escapeHtml(mail.content.subject)}</h2><p>${escapeHtml(mail.acceptedAt)}</p><pre>${safeMailText(mail.content.text, config.origins.storefront)}</pre></article>`).join("") : "<p>No captured messages yet.</p>"}`,
          ),
        );
    },
  });
  return {
    origin,
    ...transport,
    inboxUrl: `${origin}/#token=${settings.viewerToken}`,
    close: async () => {
      await server.close();
      key.fill(0);
      viewer.fill(0);
    },
  };
}
