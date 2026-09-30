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
it("retains the artist gallery after the last browsable wish is gone", async () => {
  const html = renderToStaticMarkup(
    await ArtistWishes({
      artist: {
        id: idolIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      },
      locale: "en",
      copy,
    }),
  );
  expect(html).toContain(
    "/en/wish-gallery?idol=00000000-0000-4000-8000-000000000001",
  );
  expect(html).toContain(copy.giftEmpty);
  expect(html).not.toContain("gift-directory-grid");
});
