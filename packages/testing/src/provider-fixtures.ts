import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

import { z } from "zod";

import {
  containsC0OrDelControlCharacter,
  verifiedWebhookEventCandidateSchema,
} from "@fan-support/contracts";

export const PROVIDER_FIXTURE_MANIFEST_SHA256 =
  "cce824819becdb39ee5b22f43a45145b125b2ee4d76bf99dca319396caad25f2" as const;

const MAX_MANIFEST_BYTES = 4 * 1_024;
const MAX_FIXTURE_BYTES = 8 * 1_024;
const FIXTURE_PATHS = [
  "identity-oidc.v1.json",
  "media-s3.v1.json",
  "notification.v1.json",
  "payment-fake.v1.json",
  "payment-webhook-fake.v1.json",
] as const;
const EXPECTED_DIRECTORY_FILES = [...FIXTURE_PATHS, "manifest.json"].sort();

const syntheticFixtureSchema = {
  schemaVersion: z.literal(1),
  synthetic: z.literal(true),
} as const;

const httpsInvalidOriginSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.hostname.endsWith(".invalid") &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "" &&
        (url.pathname === "" || url.pathname === "/")
      );
    } catch {
      return false;
    }
  });

const syntheticSubjectSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^(?:fixture|synthetic)-[a-z0-9][a-z0-9._:-]*$/u);

const mediaObjectKeySchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^fixtures\/media\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u)
  .refine(
    (value) =>
      !value.includes("//") &&
      !value.endsWith("/") &&
      value.split("/").every((segment) => segment !== "." && segment !== ".."),
  );

const identityFixtureSchema = z.strictObject({
  ...syntheticFixtureSchema,
  provider: z.literal("fixture-oidc"),
  scenario: z.literal("verified-admin-principal"),
  issuer: httpsInvalidOriginSchema,
  authorizationEndpoint: z
    .url({ protocol: /^https$/u })
    .refine((value) => new URL(value).pathname === "/authorize"),
  principal: z.strictObject({
    subject: syntheticSubjectSchema,
    authenticatedAt: z
      .string()
      .max(35)
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
    mfa: z.literal(true),
  }),
  expected: z.strictObject({
    stateBound: z.literal(true),
    nonceBound: z.literal(true),
    issuerBound: z.literal(true),
    clientIdBound: z.literal(true),
    redirectUriBound: z.literal(true),
    receivedAtBound: z.literal(true),
  }),
});

const mediaFixtureSchema = z.strictObject({
  ...syntheticFixtureSchema,
  provider: z.literal("s3-compatible"),
  scenario: z.literal("inspect-source-object"),
  request: z.strictObject({
    storageClass: z.literal("SOURCE"),
    objectKey: mediaObjectKeySchema,
  }),
  expected: z.strictObject({
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    byteSize: z
      .number()
      .int()
      .min(1)
      .max(10 * 1_024 * 1_024),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    revisionToken: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9._:-]+$/u),
  }),
});

const notificationFixtureSchema = z.strictObject({
  ...syntheticFixtureSchema,
  provider: z.literal("fake-notification"),
  scenario: z.literal("accepted-email-delivery"),
  request: z.strictObject({
    channel: z.literal("EMAIL"),
    templateKey: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/u),
    templateVersion: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  }),
  expected: z.strictObject({
    status: z.literal("ACCEPTED"),
    providerReference: z
      .string()
      .max(128)
      .regex(
        /^fake-notification\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    acceptedAt: z
      .string()
      .max(35)
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
  }),
});

const paymentFixtureSchema = z.strictObject({
  ...syntheticFixtureSchema,
  provider: z.literal("fake-payment"),
  scenario: z.literal("create-requires-action"),
  request: z.strictObject({
    paymentMethod: z.literal("fake_card"),
    amountMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    currency: z.literal("USD"),
    requestedLocale: z.literal("en"),
  }),
  expected: z.strictObject({
    status: z.literal("REQUIRES_ACTION"),
    externalReference: z
      .string()
      .max(128)
      .regex(
        /^fake-payment\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    providerLocale: z.literal("en"),
    fallbackUsed: z.literal(false),
    action: z.strictObject({
      schemaVersion: z.literal(1),
      type: z.literal("REDIRECT"),
      url: z
        .string()
        .min(1)
        .max(2_048)
        .refine((value) => {
          try {
            const url = new URL(value);
            return (
              url.protocol === "https:" &&
              url.hostname.endsWith(".invalid") &&
              url.username === "" &&
              url.password === "" &&
              url.search === "" &&
              url.hash === ""
            );
          } catch {
            return false;
          }
        }),
    }),
  }),
});

const paymentWebhookDeliverySchema = z.strictObject({
  rawBody: z
    .string()
    .min(2)
    .max(4_096)
    .refine((value) => !containsC0OrDelControlCharacter(value)),
  expected: verifiedWebhookEventCandidateSchema,
});

const paymentWebhookFixtureSchema = z
  .strictObject({
    ...syntheticFixtureSchema,
    provider: z.literal("fake-payment-webhook"),
    scenario: z.literal("duplicate-and-out-of-order-delivery"),
    signature: z.strictObject({
      algorithm: z.literal("HMAC_SHA256"),
      timestampHeader: z.literal("x-fake-webhook-timestamp"),
      signatureHeader: z.literal("x-fake-webhook-signature"),
    }),
    repeatCount: z.literal(10),
    deliveries: z.tuple([
      paymentWebhookDeliverySchema,
      paymentWebhookDeliverySchema,
    ]),
  })
  .superRefine((fixture, context) => {
    const [later, earlier] = fixture.deliveries;
    if (
      Date.parse(later.expected.occurredAt) <=
      Date.parse(earlier.expected.occurredAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["deliveries"],
        message:
          "fixture delivery order must be later event before earlier event",
      });
    }
    for (const [index, delivery] of fixture.deliveries.entries()) {
      try {
        const payload = JSON.parse(delivery.rawBody) as unknown;
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("event_id" in payload) ||
          payload.event_id !== delivery.expected.providerEventId
        ) {
          throw new TypeError("event identity mismatch");
        }
      } catch {
        context.addIssue({
          code: "custom",
          path: ["deliveries", index, "rawBody"],
          message: "raw webhook fixture must match its expected event identity",
        });
      }
    }
  });

const providerFixtureSchemas = {
  "identity-oidc.v1.json": identityFixtureSchema,
  "media-s3.v1.json": mediaFixtureSchema,
  "notification.v1.json": notificationFixtureSchema,
  "payment-fake.v1.json": paymentFixtureSchema,
  "payment-webhook-fake.v1.json": paymentWebhookFixtureSchema,
} as const;

export type IdentityProviderFixture = z.infer<typeof identityFixtureSchema>;
export type MediaProviderFixture = z.infer<typeof mediaFixtureSchema>;
export type NotificationProviderFixture = z.infer<
  typeof notificationFixtureSchema
>;
export type PaymentProviderFixture = z.infer<typeof paymentFixtureSchema>;
export type PaymentWebhookProviderFixture = z.infer<
  typeof paymentWebhookFixtureSchema
>;
export type ProviderFixturePath = (typeof FIXTURE_PATHS)[number];
export type ProviderFixtureDocument =
  | IdentityProviderFixture
  | MediaProviderFixture
  | NotificationProviderFixture
  | PaymentProviderFixture
  | PaymentWebhookProviderFixture;

export type ProviderFixtureDocuments = Readonly<{
  "identity-oidc.v1.json": IdentityProviderFixture;
  "media-s3.v1.json": MediaProviderFixture;
  "notification.v1.json": NotificationProviderFixture;
  "payment-fake.v1.json": PaymentProviderFixture;
  "payment-webhook-fake.v1.json": PaymentWebhookProviderFixture;
}>;

export type ProviderFixtureBundle = Readonly<{
  schemaVersion: 1;
  fixtures: ProviderFixtureDocuments;
}>;

export class ProviderFixtureIntegrityError extends Error {
  override readonly name = "ProviderFixtureIntegrityError";
  readonly code = "PROVIDER_FIXTURE_INTEGRITY_FAILED" as const;

  constructor() {
    super("PROVIDER_FIXTURE_INTEGRITY_FAILED");
  }
}

const manifestEntrySchema = z.strictObject({
  path: z.enum(FIXTURE_PATHS),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  files: z.array(manifestEntrySchema).length(FIXTURE_PATHS.length),
});

type ManifestEntry = z.infer<typeof manifestEntrySchema>;

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen);
  }
  return Object.freeze(value);
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function failIntegrity(): never {
  throw new ProviderFixtureIntegrityError();
}

function rootUrl(directory: string | URL): URL {
  if (directory instanceof URL) {
    return new URL(
      directory.href.endsWith("/") ? directory.href : `${directory.href}/`,
    );
  }
  return pathToFileURL(`${path.resolve(directory)}${path.sep}`);
}

function isProviderFixturePath(value: string): value is ProviderFixturePath {
  return FIXTURE_PATHS.some((fixturePath) => fixturePath === value);
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return failIntegrity();
  }
}

async function readBoundedRegularFile(
  fileUrl: URL,
  maxBytes: number,
): Promise<Uint8Array> {
  const fileStats = await lstat(fileUrl);
  if (!fileStats.isFile() || fileStats.size > maxBytes) {
    return failIntegrity();
  }
  const bytes = await readFile(fileUrl);
  if (bytes.byteLength > maxBytes) {
    return failIntegrity();
  }
  return bytes;
}

function parseManifest(value: unknown): readonly ManifestEntry[] {
  const parsed = manifestSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.files.some(
      (entry, index) => entry.path !== FIXTURE_PATHS[index],
    )
  ) {
    return failIntegrity();
  }
  return parsed.data.files;
}

export function parseProviderFixtureDocument<Path extends ProviderFixturePath>(
  fixturePath: Path,
  value: unknown,
): ProviderFixtureDocuments[Path];
export function parseProviderFixtureDocument(
  fixturePath: string,
  value: unknown,
): ProviderFixtureDocument;
export function parseProviderFixtureDocument(
  fixturePath: string,
  value: unknown,
): ProviderFixtureDocument {
  if (!isProviderFixturePath(fixturePath)) {
    return failIntegrity();
  }
  const parsed = providerFixtureSchemas[fixturePath].safeParse(value);
  if (!parsed.success) {
    return failIntegrity();
  }
  return parsed.data;
}

async function loadVerifiedProviderFixtureBundle(
  directory: string | URL,
): Promise<ProviderFixtureBundle> {
  const directoryUrl = rootUrl(directory);
  const directoryFiles = (await readdir(directoryUrl)).sort();
  if (
    directoryFiles.length !== EXPECTED_DIRECTORY_FILES.length ||
    directoryFiles.some(
      (fileName, index) => fileName !== EXPECTED_DIRECTORY_FILES[index],
    )
  ) {
    return failIntegrity();
  }

  const manifestBytes = await readBoundedRegularFile(
    new URL("manifest.json", directoryUrl),
    MAX_MANIFEST_BYTES,
  );
  if (sha256(manifestBytes) !== PROVIDER_FIXTURE_MANIFEST_SHA256) {
    return failIntegrity();
  }
  const entries = parseManifest(parseJson(manifestBytes));
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));

  const loadFixture = async <Path extends ProviderFixturePath>(
    fixturePath: Path,
  ): Promise<ProviderFixtureDocuments[Path]> => {
    const entry = entriesByPath.get(fixturePath);
    if (entry === undefined) {
      return failIntegrity();
    }
    const bytes = await readBoundedRegularFile(
      new URL(fixturePath, directoryUrl),
      MAX_FIXTURE_BYTES,
    );
    if (sha256(bytes) !== entry.sha256) {
      return failIntegrity();
    }
    return deepFreeze(
      parseProviderFixtureDocument(fixturePath, parseJson(bytes)),
    );
  };

  return deepFreeze({
    schemaVersion: 1,
    fixtures: {
      "identity-oidc.v1.json": await loadFixture("identity-oidc.v1.json"),
      "media-s3.v1.json": await loadFixture("media-s3.v1.json"),
      "notification.v1.json": await loadFixture("notification.v1.json"),
      "payment-fake.v1.json": await loadFixture("payment-fake.v1.json"),
      "payment-webhook-fake.v1.json": await loadFixture(
        "payment-webhook-fake.v1.json",
      ),
    },
  });
}

export async function loadProviderFixtureBundle(
  directory: string | URL,
): Promise<ProviderFixtureBundle> {
  try {
    return await loadVerifiedProviderFixtureBundle(directory);
  } catch (error) {
    if (error instanceof ProviderFixtureIntegrityError) {
      throw error;
    }
    return failIntegrity();
  }
}

export function loadReviewedProviderFixtureBundle(): Promise<ProviderFixtureBundle> {
  return loadProviderFixtureBundle(
    new URL("../../../provider-fixtures/", import.meta.url),
  );
}
