import { expect, test } from "vitest";

test("preview is disabled until an exact trusted admin origin is configured", async () => {
  const loaded = await import("./storefront-preview-config.js").catch(
    () => undefined,
  );
  expect(loaded).toBeDefined();
  if (!loaded) return;
  expect(loaded.resolveStorefrontPreviewConfig({ environment: {} })).toEqual({
    adminOrigin: null,
  });
  expect(
    loaded.resolveStorefrontPreviewConfig({
      environment: { FAN_SUPPORT_ADMIN_ORIGIN: "https://admin.example.test" },
    }),
  ).toEqual({ adminOrigin: "https://admin.example.test" });
});

test("preview origin precedence and local HTTP follow deployment boundaries", async () => {
  const loaded = await import("./storefront-preview-config.js").catch(
    () => undefined,
  );
  expect(loaded).toBeDefined();
  if (!loaded) return;
  const credentialOrigin = new URL("https://admin.example.test");
  credentialOrigin.username = "fixture-user";
  credentialOrigin.password = "fixture-password";
  for (const deployment of ["test", "development"])
    expect(
      loaded.resolveStorefrontPreviewConfig({
        environment: {
          FAN_SUPPORT_ADMIN_ORIGIN: "http://127.0.0.1:3100",
          FAN_SUPPORT_DEPLOYMENT_ENV: deployment,
        },
        defaults: { FAN_SUPPORT_ADMIN_ORIGIN: "https://other.example.test" },
      }),
    ).toEqual({ adminOrigin: "http://127.0.0.1:3100" });
  for (const origin of [
    "https://admin.example.test/path",
    "https://admin.example.test?secret=value",
    credentialOrigin.origin.replace(
      "://",
      `://${credentialOrigin.username}:${credentialOrigin.password}@`,
    ),
    "https://admin.example.test#fragment",
    " https://admin.example.test",
    "https://admin.example.test\\other",
    "http://other.example.test",
    "javascript:alert(1)",
  ])
    expect(() =>
      loaded.resolveStorefrontPreviewConfig({
        environment: {
          FAN_SUPPORT_ADMIN_ORIGIN: origin,
          FAN_SUPPORT_DEPLOYMENT_ENV: "test",
        },
      }),
    ).toThrow("FAN_SUPPORT_ADMIN_ORIGIN");
  for (const deployment of ["preview", "staging", "production", undefined])
    expect(() =>
      loaded.resolveStorefrontPreviewConfig({
        environment: {
          FAN_SUPPORT_ADMIN_ORIGIN: "http://localhost:3100",
          FAN_SUPPORT_DEPLOYMENT_ENV: deployment,
        },
      }),
    ).toThrow("FAN_SUPPORT_ADMIN_ORIGIN");
});
