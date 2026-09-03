import { appendFile, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  createFakeIdentityProvider,
  createFakeNotificationProvider,
} from "./fakes.js";
import { deterministicPortFixtures } from "./fixtures.js";
import {
  loadProviderFixtureBundle,
  parseProviderFixtureDocument,
  ProviderFixtureIntegrityError,
} from "./provider-fixtures.js";

const fixtureDirectory = fileURLToPath(
  new URL("../../../provider-fixtures/", import.meta.url),
);

async function withFixtureCopy(
  exercise: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "fan-support-provider-fixtures-"),
  );
  try {
    await cp(fixtureDirectory, directory, { recursive: true });
    await exercise(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("versioned provider fixture integrity", () => {
  test("loads the allowlisted synthetic provider fixtures", async () => {
    const bundle = await loadProviderFixtureBundle(fixtureDirectory);

    expect(Object.keys(bundle.fixtures)).toEqual([
      "identity-oidc.v1.json",
      "media-s3.v1.json",
      "notification.v1.json",
      "payment-fake.v1.json",
    ]);
    expect(JSON.stringify(bundle)).not.toMatch(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|fanMessage|displayName|shippingAddress|apiToken|cardNumber|cvv|\bpan\b/iu,
    );
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.fixtures)).toBe(true);
    expect(Object.isFrozen(bundle.fixtures["identity-oidc.v1.json"])).toBe(
      true,
    );
    expect(
      Object.isFrozen(bundle.fixtures["identity-oidc.v1.json"]?.["principal"]),
    ).toBe(true);
  });

  test("rejects unknown fixture fields through the strict per-provider schema", () => {
    expect(() =>
      parseProviderFixtureDocument("notification.v1.json", {
        schemaVersion: 1,
        synthetic: true,
        provider: "fake-notification",
        scenario: "accepted-email-delivery",
        request: {
          channel: "EMAIL",
          templateKey: "order.payment.confirmed",
          templateVersion: "fixture-v1",
        },
        expected: {
          status: "ACCEPTED",
          providerReference:
            "fake-notification/10000000-0000-4000-8000-000000000007",
          acceptedAt: "2026-09-03T00:00:00.000Z",
        },
        rawProviderResponse: { requestId: "must-not-cross-boundary" },
      }),
    ).toThrow(ProviderFixtureIntegrityError);
  });

  test("bounds every fixture string instead of accepting arbitrary provider payloads", () => {
    expect(() =>
      parseProviderFixtureDocument("notification.v1.json", {
        schemaVersion: 1,
        synthetic: true,
        provider: "fake-notification",
        scenario: "accepted-email-delivery",
        request: {
          channel: "EMAIL",
          templateKey: `order.${"x".repeat(129)}`,
          templateVersion: "fixture-v1",
        },
        expected: {
          status: "ACCEPTED",
          providerReference:
            "fake-notification/10000000-0000-4000-8000-000000000007",
          acceptedAt: "2026-09-03T00:00:00.000Z",
        },
      }),
    ).toThrow(ProviderFixtureIntegrityError);
  });

  test("binds identity and notification fixtures to deterministic commands and fake outputs", async () => {
    const bundle = await loadProviderFixtureBundle(fixtureDirectory);
    const identityFixture = bundle.fixtures["identity-oidc.v1.json"];
    const notificationFixture = bundle.fixtures["notification.v1.json"];
    const identityCommands = deterministicPortFixtures.identity;
    const notificationCommand =
      deterministicPortFixtures.notification.sendNotification;

    expect(identityFixture.issuer).toBe(
      identityCommands.createAuthorizationRequest.issuer,
    );
    expect(identityFixture.authorizationEndpoint).toBe(
      identityCommands.authorizationEndpoint,
    );
    expect(identityFixture.expected).toEqual({
      stateBound: true,
      nonceBound: true,
      issuerBound: true,
      clientIdBound: true,
      redirectUriBound: true,
      receivedAtBound: true,
    });
    const identityProvider = createFakeIdentityProvider();
    await expect(
      identityProvider.createAuthorizationRequest(
        identityCommands.createAuthorizationRequest,
      ),
    ).resolves.toMatchObject({ outcome: "SUCCESS" });
    await expect(
      identityProvider.exchangeAuthorizationCode(
        identityCommands.exchangeAuthorizationCode,
      ),
    ).resolves.toMatchObject({
      outcome: "SUCCESS",
      value: {
        principal: {
          issuer: identityFixture.issuer,
          subject: identityFixture.principal.subject,
          authenticatedAt: identityFixture.principal.authenticatedAt,
          mfa: identityFixture.principal.mfa,
        },
      },
    });

    expect(notificationFixture.request).toEqual({
      channel: notificationCommand.channel,
      templateKey: notificationCommand.notification.locale.templateKey,
      templateVersion: notificationCommand.notification.locale.templateVersion,
    });
    await expect(
      createFakeNotificationProvider().sendNotification(notificationCommand),
    ).resolves.toMatchObject({
      outcome: "SUCCESS",
      value: notificationFixture.expected,
    });
  });

  test("binds media and payment fixtures to deterministic commands", async () => {
    const bundle = await loadProviderFixtureBundle(fixtureDirectory);
    const mediaFixture = bundle.fixtures["media-s3.v1.json"];
    const paymentFixture = bundle.fixtures["payment-fake.v1.json"];

    expect(mediaFixture.request).toEqual({
      storageClass: deterministicPortFixtures.media.inspectObject.storageClass,
      objectKey: deterministicPortFixtures.media.inspectObject.objectKey,
    });
    expect(mediaFixture.expected).toEqual({
      checksumSha256:
        deterministicPortFixtures.media.createUploadGrant.checksumSha256,
      byteSize: deterministicPortFixtures.media.createUploadGrant.byteSize,
      mimeType: deterministicPortFixtures.media.createUploadGrant.mimeType,
      revisionToken: "68b329da9893e34099c7d8ad5cb9c940",
    });
    expect(paymentFixture.request).toEqual({
      paymentMethod:
        deterministicPortFixtures.payment.createPayment.paymentMethod,
      amountMinor: deterministicPortFixtures.payment.createPayment.amountMinor,
      currency: deterministicPortFixtures.payment.createPayment.currency,
      requestedLocale:
        deterministicPortFixtures.payment.createPayment.requestedLocale,
    });
  });

  test("fails closed when a fixture changes without a reviewed hash update", async () => {
    await withFixtureCopy(async (directory) => {
      await appendFile(
        path.join(directory, "payment-fake.v1.json"),
        " ",
        "utf8",
      );

      await expect(loadProviderFixtureBundle(directory)).rejects.toBeInstanceOf(
        ProviderFixtureIntegrityError,
      );
    });
  });

  test("fails closed when an unreviewed fixture is present beside the manifest", async () => {
    await withFixtureCopy(async (directory) => {
      await writeFile(
        path.join(directory, "unreviewed.v1.json"),
        JSON.stringify({
          schemaVersion: 1,
          synthetic: true,
          displayName: "must-not-be-ignored",
        }),
        "utf8",
      );

      await expect(loadProviderFixtureBundle(directory)).rejects.toBeInstanceOf(
        ProviderFixtureIntegrityError,
      );
    });
  });

  test("fails closed when the manifest bytes drift", async () => {
    await withFixtureCopy(async (directory) => {
      await appendFile(path.join(directory, "manifest.json"), " ", "utf8");

      await expect(loadProviderFixtureBundle(directory)).rejects.toMatchObject({
        code: "PROVIDER_FIXTURE_INTEGRITY_FAILED",
      });
    });
  });
});
