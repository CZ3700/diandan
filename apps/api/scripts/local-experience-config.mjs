import { URL } from "node:url";
import { z } from "zod";
import {
  paymentRuntimeProviderBindingSchema,
  notificationGatewayProfileSchema,
} from "@fan-support/contracts";
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const port = z.number().int().min(1024).max(65535);
const file = z.string().startsWith("/");
export const LOCAL_SERVICE_KEYS = Object.freeze([
  "storefront",
  "admin",
  "oidc",
  "psp",
  "mail",
  "media",
]);
export const localServiceLabel = (key) => (key === "psp" ? "payments" : key);
/** A lowercase DNS name with at least two labels; never a loopback or reserved TEST name. */
export const publicBaseDomainSchema = z
  .string()
  .max(200)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u)
  .refine(
    (value) =>
      !/(?:^|\.)(?:localhost|invalid|test|example|local)$/u.test(value),
  );
const origins = z.strictObject(
  Object.fromEntries(
    LOCAL_SERVICE_KEYS.map((key) => [
      key,
      z.url().refine((v) => {
        const u = new URL(v);
        return u.protocol === "https:" && u.origin === v;
      }),
    ]),
  ),
);
const exposure = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("PUBLIC"),
    baseDomain: publicBaseDomainSchema,
  }),
]);
/** Loopback origins carry their listening port; public origins are the service label under the base domain on 443. */
export function localServiceOriginFor(key, { exposure, port }) {
  return exposure?.mode === "PUBLIC"
    ? `https://${localServiceLabel(key)}.${exposure.baseDomain}`
    : `https://${localServiceLabel(key)}.example.invalid:${port}`;
}
/** Browsers and the media processor reach object storage here; server SDK calls stay on loopback. */
export function localObjectStoragePresignEndpoint(config) {
  return config.exposure?.mode === "PUBLIC"
    ? `https://s3.${config.exposure.baseDomain}`
    : `https://localhost:${config.ports.s3}`;
}
/**
 * A public instance runs each development server on its own loopback address and 443, so its
 * --hostname:--port is exactly the public origin (Next builds request URLs from them). The edge
 * binds only 127.0.0.1 and the host's private address, leaving these to the web servers.
 */
export const LOCAL_PUBLIC_WEB_ADDRESSES = Object.freeze({
  storefront: "127.0.0.2",
  admin: "127.0.0.3",
});
/** Where an owned service listens: loopback instances use 127.0.0.1 and their assigned port. */
export function localServiceTarget(config, key) {
  return config.exposure?.mode === "PUBLIC" && key in LOCAL_PUBLIC_WEB_ADDRESSES
    ? { address: LOCAL_PUBLIC_WEB_ADDRESSES[key], port: 443 }
    : { address: "127.0.0.1", port: config.ports[key] };
}
/** Owned origins mapped to their listening address, for direct internal calls. */
export function localServiceTargets(config) {
  return Object.fromEntries(
    LOCAL_SERVICE_KEYS.map((key) => [
      config.origins[key],
      localServiceTarget(config, key),
    ]),
  );
}
/**
 * Hostname -> loopback address for the owned processes of a public instance: web servers resolve
 * to their own address, every other public host to the local edge. Empty for loopback instances.
 */
export function localDnsHosts(config) {
  if (config.exposure?.mode !== "PUBLIC") return [];
  return [
    ...LOCAL_SERVICE_KEYS.map((key) => [
      new URL(config.origins[key]).hostname,
      LOCAL_PUBLIC_WEB_ADDRESSES[key] ?? "127.0.0.1",
    ]),
    [new URL(localObjectStoragePresignEndpoint(config)).hostname, "127.0.0.1"],
  ].map(([host, address]) => `${host}=${address}`);
}
export const localExperienceConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    environment: z.literal("LOCAL_TEST"),
    instance: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u),
    instanceId: z.uuid(),
    workspaceRoot: file,
    ports: z.strictObject(
      Object.fromEntries(
        [
          "storefront",
          "admin",
          "api",
          "worker",
          "oidc",
          "psp",
          "mail",
          "media",
          "s3",
          "s3Backend",
          "postgres",
          "control",
          "storefrontBackend",
          "adminBackend",
        ].map((key) => [key, port]),
      ),
    ),
    origins,
    exposure: exposure.optional(),
    secrets: z.strictObject(
      Object.fromEntries(
        [
          "controlToken",
          "tokenPepper",
          "subjectPepper",
          "accessKey",
          "kmsMasterKey",
          "kmsMacKey",
          "webhookSecret",
        ].map((key) => [key, secret]),
      ),
    ),
    database: z.strictObject({
      user: z.literal("fan_support_local"),
      database: z.literal("fan_support_local"),
      password: secret,
    }),
    s3: z.strictObject({
      accessKeyId: secret,
      secretAccessKey: secret,
      sourceBucket: z.string(),
      derivativeBucket: z.string(),
    }),
    tls: z.strictObject({
      caCertificatePath: file,
      certificatePath: file,
      privateKeyPath: file,
    }),
    services: z.strictObject({
      oidc: z.strictObject({
        clientId: z.string(),
        clientSecret: secret,
        signingPrivateKeyPath: file,
        actors: z
          .array(
            z.strictObject({
              key: z.enum(["manager", "reviewer"]),
              label: z.string(),
              subject: z.uuid(),
              id: z.uuid(),
            }),
          )
          .length(2),
        acr: z.string(),
        amr: z.array(z.string()),
      }),
      psp: z.strictObject({
        databaseName: z.string().regex(/^p404_psp_[a-f0-9]{32}$/u),
        authorizationToken: secret,
        binding: paymentRuntimeProviderBindingSchema,
        webhookEndpointId: z.uuid(),
      }),
      mail: z.strictObject({
        authorizationToken: secret,
        captureEncryptionKey: secret,
        viewerToken: secret,
        profile: notificationGatewayProfileSchema,
      }),
    }),
  })
  .superRefine((v, ctx) => {
    if (new Set(Object.values(v.ports)).size !== Object.keys(v.ports).length)
      ctx.addIssue({ code: "custom", message: "Duplicate configured port" });
    for (const [key, value] of Object.entries(v.origins))
      if (
        value !==
        localServiceOriginFor(key, { exposure: v.exposure, port: v.ports[key] })
      )
        ctx.addIssue({ code: "custom", message: "Origin exposure mismatch" });
  });
