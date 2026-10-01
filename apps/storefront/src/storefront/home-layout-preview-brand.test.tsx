import { Children, isValidElement, type ReactNode } from "react";
import { expect, test, vi } from "vitest";
import copy from "../../../../packages/i18n/src/storefront/en";
import { BrandPreview } from "./brand-preview";
import { ThemePreview } from "./theme-preview";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("../server/runtime-config", () => ({
  loadStorefrontPreviewConfig: () => ({
    adminOrigin: "https://admin.example.invalid",
  }),
  loadStorefrontPresentationConfig: () => ({ name: "Studio" }),
}));
vi.mock("../server/storefront-copy", () => ({
  loadStorefrontCopy: async () => copy,
}));
vi.mock("../server/public-home-layout", () => ({
  readPublicHomeLayout: async () => ({ outcome: "FAILURE" }),
}));
vi.mock("./storefront-page-reads", () => ({
  readStorefrontHomepage: async () => ({ outcome: "FAILURE" }),
  readStorefrontDirectory: async () => ({ outcome: "FAILURE" }),
}));
function includes(node: ReactNode, type: unknown): boolean {
  return Children.toArray(node).some(
    (child) =>
      isValidElement<{ children?: ReactNode }>(child) &&
      (child.type === type || includes(child.props.children, type)),
  );
}
test("brand mode mounts independent brand and theme receivers inside the inert shared preview", async () => {
  const { createHomeLayoutPreviewPage } =
    await import("./home-layout-preview-page");
  const tree = await createHomeLayoutPreviewPage("en")({
    params: Promise.resolve({}),
    searchParams: Promise.resolve({
      mode: "brand",
      channel: "8c7cc797-c5fa-4a11-b0eb-6d282b9c4019",
    }),
  });
  expect(tree.props.preview).toBe(true);
  expect(includes(tree, BrandPreview)).toBe(true);
  expect(includes(tree, ThemePreview)).toBe(true);
});
test("brand preview refuses arbitrary pages, navigation views and unrecognized parameters", async () => {
  const { createHomeLayoutPreviewPage } =
    await import("./home-layout-preview-page");
  for (const extra of [
    { page: "gift" },
    { view: "menu" },
    { brand: "https://foreign.invalid/logo.png" },
  ]) {
    await expect(
      createHomeLayoutPreviewPage("en")({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({
          mode: "brand",
          channel: "8c7cc797-c5fa-4a11-b0eb-6d282b9c4019",
          ...extra,
        }),
      }),
    ).rejects.toThrow("NOT_FOUND");
  }
});
