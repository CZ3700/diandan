import { createHash, X509Certificate } from "node:crypto";
import { createServer } from "node:net";
import { request } from "node:https";
import { Readable } from "node:stream";
import { URL } from "node:url";
import { createTestTlsMaterial } from "../../../packages/identity-oidc/src/test-support/https-idp.mjs";
import { startLocalProxy } from "./local-experience-tls.mjs";
import { withoutLocalPaymentCredentials } from "./local-experience-payment-profile.mjs";

/** These fixed hosts identify this owned fixture, never deployment defaults. */
export function assertOwnedOrigin(value, service) {
  const url = new URL(value);
  if (
    !["admin", "api", "oidc"].includes(service) ||
    url.protocol !== "https:" ||
    url.hostname !== `${service}.example.invalid` ||
    url.origin !== value ||
    !url.port
  )
    throw new Error("Expected an exact owned HTTPS fixture origin");
  return value;
}
export async function reserveOwnedOrigin(service) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return assertOwnedOrigin(
    `https://${service}.example.invalid:${port}`,
    service,
  );
}
export function productionAdminEnvironment(input, inherited = process.env) {
  for (const [key, service] of [
    ["adminOrigin", "admin"],
    ["apiOrigin", "api"],
    ["issuer", "oidc"],
  ])
    assertOwnedOrigin(input[key], service);
  if (
    !/^[a-f0-9]{64}$/u.test(input.accessKey) ||
    !input.caPath?.startsWith("/")
  )
    throw new Error("Invalid fixture credential or trust path");
  const env = Object.fromEntries(
    Object.entries(withoutLocalPaymentCredentials(inherited)).filter(
      ([key]) =>
        !key.startsWith("FAN_SUPPORT_") &&
        !key.startsWith("STRIPE_") &&
        ![
          "NODE_TLS_REJECT_UNAUTHORIZED",
          "NODE_OPTIONS",
          "NODE_EXTRA_CA_CERTS",
        ].includes(key),
    ),
  );
  return {
    ...env,
    NODE_ENV: "production",
    FAN_SUPPORT_DEPLOYMENT_ENV: "staging",
    FAN_SUPPORT_SITE_ORIGIN: input.adminOrigin,
    FAN_SUPPORT_INTERNAL_API_ORIGIN: input.apiOrigin,
    FAN_SUPPORT_ADMIN_MODE: "OIDC",
    FAN_SUPPORT_ADMIN_ACCESS_KEY: input.accessKey,
    FAN_SUPPORT_ADMIN_OIDC_ISSUER: input.issuer,
    NODE_EXTRA_CA_CERTS: input.caPath,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
export function certificatePin(cert) {
  return createHash("sha256")
    .update(
      new X509Certificate(cert).publicKey.export({
        type: "spki",
        format: "der",
      }),
    )
    .digest("base64");
}
export function ownedHttpsFetch({ origin, ca }) {
  const expected = new URL(origin);
  assertOwnedOrigin(origin, expected.hostname.split(".")[0]);
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin !== origin || url.username || url.password)
      throw new Error("Fixture transport origin mismatch");
    return new Promise((resolve, reject) => {
      const outgoing = request(
        url,
        {
          hostname: "127.0.0.1",
          servername: expected.hostname,
          ca,
          method: init.method ?? "GET",
          headers: {
            ...Object.fromEntries(
              new globalThis.Headers(init.headers).entries(),
            ),
            host: expected.host,
          },
          signal: init.signal ?? globalThis.AbortSignal.timeout(15000),
        },
        (incoming) => {
          const headers = new globalThis.Headers();
          for (const [key, value] of Object.entries(incoming.headers))
            if (value !== undefined)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          resolve(
            new globalThis.Response(Readable.toWeb(incoming), {
              status: incoming.statusCode,
              headers,
            }),
          );
        },
      );
      outgoing.once("error", reject);
      outgoing.end(init.body);
    });
  };
}
export async function startOwnedTlsProxy({ origin, target }) {
  const url = new URL(origin);
  assertOwnedOrigin(origin, url.hostname.split(".")[0]);
  const tls = createTestTlsMaterial(url.hostname);
  let stop;
  try {
    await startLocalProxy({
      config: {
        tls: { certificatePath: tls.certPath, privateKeyPath: tls.keyPath },
      },
      port: Number(url.port),
      origin,
      target,
      name: "formal-oidc-fixture",
      own: (_name, close) => {
        stop = close;
      },
    });
    return {
      ca: tls.cert,
      caPath: tls.certPath,
      pin: certificatePin(tls.cert),
      fetch: ownedHttpsFetch({ origin, ca: tls.cert }),
      stop: async () => {
        try {
          await stop();
        } finally {
          tls.cleanup();
        }
      },
    };
  } catch (error) {
    tls.cleanup();
    throw error;
  }
}
