import { hasRemoteMatch } from "next/dist/shared/lib/match-remote-pattern.js";
import { expect, test } from "vitest";

import { createStorefrontImageConfig } from "./image-config.js";

const origin = "https://media.example.invalid:7444";
const env = {
  FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: origin,
  FAN_SUPPORT_DEPLOYMENT_ENV: "production",
};

test("only exact configured origin and processed derivative formats may be optimized", () => {
  const config = createStorefrontImageConfig(env);
  const matches = (url: string) =>
    hasRemoteMatch([], config.remotePatterns ?? [], new URL(url));
  for (const extension of ["avif", "webp", "jpg"]) {
    expect(matches(`${origin}/processed/v1/master/variant.${extension}`)).toBe(
      true,
    );
  }
  for (const url of [
    `${origin}/processed/v1/master.png`,
    `${origin}/processed/v1/master/variant.svg`,
    `${origin}/processed/v1/master/variant.webp?token=private`,
    `${origin}/source/original.jpg`,
    "https://media.example.invalid/processed/v1/master/variant.webp",
    "https://other.example.invalid:7444/processed/v1/master/variant.webp",
    "https://child.media.example.invalid:7444/processed/v1/master/variant.webp",
    "http://media.example.invalid:7444/processed/v1/master/variant.webp",
  ])
    expect(matches(url), url).toBe(false);
  expect(config.localPatterns).toEqual([]);
  expect(config.maximumRedirects).toBe(0);
  expect(config.minimumCacheTTL).toBe(60);
  expect(config.dangerouslyAllowSVG).toBe(false);
  expect(config.dangerouslyAllowLocalIP).toBe(false);
  expect(config.qualities).toEqual([75]);
  expect(config.formats).toEqual(["image/avif", "image/webp"]);
});

test.each(["development", "test"])(
  "only explicit %s may fetch a loopback gateway",
  (tier) => {
    expect(
      createStorefrontImageConfig({ ...env, FAN_SUPPORT_DEPLOYMENT_ENV: tier })
        .dangerouslyAllowLocalIP,
    ).toBe(true);
  },
);

test.each([undefined, "preview", "staging", "production"])(
  "%s never enables private address fetching",
  (tier) => {
    expect(
      createStorefrontImageConfig({ ...env, FAN_SUPPORT_DEPLOYMENT_ENV: tier })
        .dangerouslyAllowLocalIP,
    ).toBe(false);
  },
);

test.each([
  "https://*.example.invalid",
  "https://**.example.invalid",
  "https://user:password@media.example.invalid",
  "http://media.example.invalid",
  "https://media.example.invalid/path",
  "https://media.example.invalid?",
  "https://media.example.invalid#",
  "https://media.example.invalid/",
  "https://media.example.invalid\\",
  "https://localhost:7444",
  "https://127.0.0.1:7444",
  "https://10.0.0.1:7444",
  "https://[::1]:7444",
  " https://media.example.invalid",
])(
  "an invalid production origin fails closed without reflecting its value: %s",
  (value) => {
    expect(() =>
      createStorefrontImageConfig({
        ...env,
        FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: value,
      }),
    ).toThrow("Invalid storefront image origin");
  },
);

test("an absent origin disables all remote optimization; unknown tiers cannot grant local access", () => {
  expect(createStorefrontImageConfig({}).remotePatterns).toEqual([]);
  expect(() =>
    createStorefrontImageConfig({ ...env, FAN_SUPPORT_DEPLOYMENT_ENV: "TEST" }),
  ).toThrow("Invalid storefront image deployment environment");
});
