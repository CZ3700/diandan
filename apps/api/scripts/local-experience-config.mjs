import { URL } from "node:url";
import { z } from "zod";
import {
  paymentRuntimeProviderBindingSchema,
  notificationGatewayProfileSchema,
} from "@fan-support/contracts";
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const port = z.number().int().min(1024).max(65535);
const file = z.string().startsWith("/");
const origins = z.strictObject(
  Object.fromEntries(
    ["storefront", "admin", "oidc", "psp", "mail", "media"].map((key) => [
      key,
      z.url().refine((v) => {
        const u = new URL(v);
        return (
          u.protocol === "https:" &&
          u.hostname ===
            `${key === "psp" ? "payments" : key}.example.invalid` &&
          u.origin === v
        );
      }),
    ]),
  ),
);
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
      if (Number(new URL(value).port) !== v.ports[key])
        ctx.addIssue({ code: "custom", message: "Origin port mismatch" });
  });
