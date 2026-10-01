import { expect, test, vi } from "vitest";
import { createDefaultHomeLayout } from "@fan-support/contracts";
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
    storefrontSeoTransactionManager: {
      runInStorefrontSeoTransaction: async (
        work: (repositories: unknown) => unknown,
      ) => work({ storefrontSeo: { loadEntity: load } }),
    },
    storefrontCommerceTransactionManager: {
      runInStorefrontCommerceTransaction: async (
        work: (repositories: unknown) => unknown,
      ) => work({ storefrontCommerce: { loadGift: load } }),
    },
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
    composition.storefrontCommerceRoute.useCases.readGift({
      schemaVersion: 1,
      locale: "ja",
      handle: "gift",
      market: "TEST",
      currency: "USD",
    }),
  ).resolves.toMatchObject({ code: "NOT_FOUND" });
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
  await expect(
    composition.storefrontSeoRoute.useCases.execute({
      schemaVersion: 1,
      operation: "ENTITY",
      locator: { kind: "HOMEPAGE" },
    }),
  ).resolves.toMatchObject({ code: "NOT_FOUND" });
  await composition.publicationRuntimeLifecycle.start();
  await Promise.all([
    composition.publicationRuntimeLifecycle.stop(),
    composition.publicationRuntimeLifecycle.stop(),
  ]);
  expect(close).toHaveBeenCalledOnce();
});
test("serves the public presentation reads every storefront page makes from the same test persistence", async () => {
  const close = vi.fn(async () => undefined);
  const layout = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "HOME_LAYOUT",
    source: "DEFAULT",
    layout: createDefaultHomeLayout(),
    version: 0,
    publicationId: null,
  }));
  const theme = vi.fn(async () => ({}));
  const brand = vi.fn(async () => ({}));
  const navigation = vi.fn(async () => ({}));
  const informationPage = vi.fn(async () => ({}));
  const createPersistence = vi.fn(() => ({
    homeLayoutTransactionManager: {
      runInHomeLayoutTransaction: async (
        work: (repositories: unknown) => unknown,
      ) => work({ homeLayout: { readPublished: layout } }),
    },
    storefrontThemeTransactionManager: {
      runInStorefrontThemeTransaction: async (
        work: (repositories: unknown) => unknown,
      ) => work({ storefrontTheme: { readPublished: theme } }),
    },
    storefrontBrandTransactionManager: {
      runInStorefrontBrandTransaction: async (
        work: (repositories: unknown) => unknown,
      ) => work({ storefrontBrand: { readPublished: brand } }),
    },
    storefrontNavigationTransactionManager: {
      runInStorefrontNavigationTransaction: async (
        work: (repositories: unknown) => unknown,
      ) => work({ storefrontNavigation: { readPublished: navigation } }),
    },
    informationPageTransactionManager: {
      runInInformationPageTransaction: async (
        work: (repositories: unknown) => unknown,
      ) => work({ informationPages: { readPublished: informationPage } }),
    },
    close,
  }));
  const composition = createTestPublicationRuntimeComposition(options, {
    createPersistence: createPersistence as never,
  });
  // Without these the storefront renders its unavailable state on every homepage.
  await expect(
    composition.publicHomeLayoutRoute.useCases.execute(),
  ).resolves.toMatchObject({ outcome: "SUCCESS", source: "DEFAULT" });
  await composition.publicStorefrontThemeRoute.useCases.execute();
  await composition.publicStorefrontBrandRoute.useCases.execute();
  expect(brand).toHaveBeenCalledOnce();
  await composition.publicStorefrontNavigationRoute.useCases.execute();
  await composition.publicInformationPagesRoute.useCases.read({
    schemaVersion: 1,
    pageKey: "ABOUT",
    locale: "ja",
  });
  expect(layout).toHaveBeenCalledOnce();
  expect(theme).toHaveBeenCalledOnce();
  expect(navigation).toHaveBeenCalledOnce();
  expect(informationPage).toHaveBeenCalledOnce();
  expect(createPersistence).toHaveBeenCalledOnce();
  await composition.publicationRuntimeLifecycle.stop();
  expect(close).toHaveBeenCalledOnce();
});
