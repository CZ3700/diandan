import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { loadStorefrontRuntimeConfig, notFound } = vi.hoisted(() => ({
  loadStorefrontRuntimeConfig: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("../../../server/runtime-config", () => ({
  loadStorefrontRuntimeConfig,
}));

import DesignFoundationLayout, { metadata } from "./layout";

beforeEach(() => {
  loadStorefrontRuntimeConfig.mockReset();
  notFound.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test.each(["staging", "production", undefined])(
  "returns not found before runtime loading in %j",
  (deploymentEnvironment) => {
    if (deploymentEnvironment === undefined) {
      vi.stubEnv("FAN_SUPPORT_DEPLOYMENT_ENV", undefined);
    } else {
      vi.stubEnv("FAN_SUPPORT_DEPLOYMENT_ENV", deploymentEnvironment);
    }
    const boundary = new Error("NEXT_NOT_FOUND");
    notFound.mockImplementationOnce(() => {
      throw boundary;
    });

    expect(() =>
      DesignFoundationLayout({ children: "private preview" }),
    ).toThrow(boundary);
    expect(loadStorefrontRuntimeConfig).not.toHaveBeenCalled();
  },
);

test.each(["development", "test", "preview"])(
  "validates runtime config and renders only in %s",
  (deploymentEnvironment) => {
    vi.stubEnv("FAN_SUPPORT_DEPLOYMENT_ENV", deploymentEnvironment);

    const rendered = DesignFoundationLayout({ children: "private preview" });

    expect(loadStorefrontRuntimeConfig).toHaveBeenCalledOnce();
    expect(rendered).toBe("private preview");
  },
);

test("declares an explicit noindex boundary", () => {
  expect(metadata.robots).toEqual({ follow: false, index: false });
});
