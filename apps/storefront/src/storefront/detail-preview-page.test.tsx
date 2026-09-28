import { beforeEach, expect, test, vi } from "vitest";
const reads = vi.hoisted(() => ({
  home: vi.fn(),
  layout: vi.fn(),
  directory: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../server/runtime-config", () => ({
  loadStorefrontPreviewConfig: () => ({
    adminOrigin: "https://admin.example.invalid",
  }),
  loadStorefrontPresentationConfig: () => ({ name: "Studio" }),
}));
vi.mock("./storefront-page-reads", () => ({
  readStorefrontHomepage: reads.home,
  readStorefrontDirectory: reads.directory,
  readCommerceContext: vi.fn(),
  readStorefrontIdol: vi.fn(),
}));
vi.mock("../server/public-home-layout", () => ({
  readPublicHomeLayout: reads.layout,
}));
vi.mock("../server/storefront-copy", () => ({
  loadStorefrontCopy: vi.fn(async () => ({})),
}));
import { createHomeLayoutPreviewPage } from "./home-layout-preview-page";
const channel = "dd760f38-6585-4d2f-84eb-fa157a50a4c9";
beforeEach(() => vi.clearAllMocks());
for (const page of ["artist", "gift"] as const) {
  test(`${page} theme preview uses an inert detail shell independent of homepage reads`, async () => {
    const result = await createHomeLayoutPreviewPage("en")({
      searchParams: Promise.resolve({ channel, mode: "theme", page }),
      params: Promise.resolve({}),
    });
    expect(result.props.preview).toBe(true);
    expect(result.props.active).toBe(page === "artist" ? "artists" : "gifts");
    expect(reads.home).not.toHaveBeenCalled();
    expect(reads.layout).not.toHaveBeenCalled();
    expect(reads.directory).not.toHaveBeenCalled();
  });
}
for (const extra of [
  { page: "checkout" },
  { page: "gift", cart: "private" },
  { page: ["artist", "gift"] },
  { page: "gift", handle: "unapproved" },
]) {
  test(`rejects invalid or private preview targets ${JSON.stringify(extra)}`, async () => {
    await expect(
      createHomeLayoutPreviewPage("en")({
        searchParams: Promise.resolve({ channel, mode: "theme", ...extra }),
        params: Promise.resolve({}),
      }),
    ).rejects.toThrow();
    expect(reads.home).not.toHaveBeenCalled();
  });
}
test("layout-only preview cannot request a detail target", async () => {
  await expect(
    createHomeLayoutPreviewPage("en")({
      searchParams: Promise.resolve({ channel, page: "gift" }),
      params: Promise.resolve({}),
    }),
  ).rejects.toThrow();
});
