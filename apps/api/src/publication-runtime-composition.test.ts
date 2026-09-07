import { expect, test, vi } from "vitest";
import { createTestPublicationRuntimeComposition } from "./publication-runtime-composition.js";
const options = {
  environment: "TEST" as const,
  database: { host: "database.internal", database: "fixture", user: "fixture" },
  tokenPepper: "a".repeat(64),
  allowedOrigin: "http://localhost:3002",
  publicMediaBaseUrl: "https://media.example.invalid",
};
test("rejects invalid test publication configuration before persistence acquisition", () => {
  const createPersistence = vi.fn();
  for (const invalid of [
    { environment: "PRODUCTION" },
    { tokenPepper: "weak" },
    { allowedOrigin: "http://localhost:3002/path" },
    { allowedOrigin: "https://user:pass@example.invalid" },
    { publicMediaBaseUrl: "http://media.example.invalid" },
    {
      publicMediaBaseUrl: "https://media.example.invalid/private?token=canary",
    },
  ])
    expect(() =>
      createTestPublicationRuntimeComposition(
        { ...options, ...invalid } as never,
        { createPersistence },
      ),
    ).toThrow();
  expect(createPersistence).not.toHaveBeenCalled();
});
test("connects both real use cases and drains one shared test persistence once", async () => {
  const close = vi.fn(async () => undefined);
  const load = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  }));
  const createPersistence = vi.fn(() => ({
    storefrontHomepageTransactionManager: {
      runInStorefrontHomepageTransaction: async (
        work: (repositories: unknown) => unknown,
      ) => work({ storefrontHomepage: { load } }),
    },
    publicationRuntimeTransactionManager: {
      runInPublicationRuntimeTransaction: async () => {
        throw new Error("unused");
      },
    },
    publishedContentTransactionManager: {
      runInPublishedContentTransaction: async (
        work: (repositories: unknown) => unknown,
      ) => work({ publishedContent: { load } }),
    },
    close,
  }));
  const composition = createTestPublicationRuntimeComposition(options, {
    createPersistence: createPersistence as never,
  });
  expect(createPersistence).toHaveBeenCalledWith(
    options.database,
    expect.objectContaining({
      catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
    }),
  );
  expect(composition.publicationRuntimeRoute.allowedOrigin).toBe(
    options.allowedOrigin,
  );
  expect(composition).toHaveProperty("storefrontHomepageRoute");
  await expect(
    composition.storefrontHomepageRoute.useCases.execute({
      schemaVersion: 1,
      locale: "ja",
    }),
  ).resolves.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    composition.publicationRuntimeRoute.useCases.execute({}),
  ).resolves.toMatchObject({ code: "INVALID_COMMAND" });
  await expect(
    composition.publishedContentRoute.useCases.execute({
      schemaVersion: 1,
      locator: { kind: "HOMEPAGE" },
      locale: "ja",
    }),
  ).resolves.toMatchObject({ code: "NOT_FOUND" });
  expect(load).toHaveBeenCalledWith({
    schemaVersion: 1,
    locator: { kind: "HOMEPAGE" },
    locale: "ja",
  });
  await composition.publicationRuntimeLifecycle.start();
  await Promise.all([
    composition.publicationRuntimeLifecycle.stop(),
    composition.publicationRuntimeLifecycle.stop(),
  ]);
  expect(close).toHaveBeenCalledOnce();
});
