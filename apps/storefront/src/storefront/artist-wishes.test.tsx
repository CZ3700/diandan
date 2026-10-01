import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { idolIdSchema } from "@fan-support/contracts";
import copy from "../../../../packages/i18n/src/storefront/en";
import { ArtistWishes } from "./artist-wishes";
vi.mock("server-only", () => ({}));
vi.mock("../server/public-gift-browse", () => ({
  readGiftBrowse: vi.fn().mockResolvedValue({
    outcome: "SUCCESS",
    items: [],
    pageInfo: { totalPages: 0 },
  }),
}));
it("shows only a concise artist-specific empty state when there are no wishes", async () => {
  const html = renderToStaticMarkup(
    await ArtistWishes({
      artist: {
        id: idolIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      },
      locale: "en",
      copy,
    }),
  );
  expect(html).toContain("This artist has not added any wish gifts yet.");
  expect(html).not.toContain(copy.wishOnlyOnce);
  expect(html).not.toContain("wish-gallery-heading");
  expect(html).not.toContain("gift-directory-grid");
});
