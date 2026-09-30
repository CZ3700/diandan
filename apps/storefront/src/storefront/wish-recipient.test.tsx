import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { wishGiftSummarySchema } from "@fan-support/contracts";
import copy from "../../../../packages/i18n/src/storefront/en";
import { GiftDetailRecipient } from "./gift-detail-recipient-section";

vi.mock("server-only", () => ({}));
const wish = wishGiftSummarySchema.parse({
  schemaVersion: 1,
  wishId: "10000000-0000-4000-8000-000000000001",
  artistId: "20000000-0000-4000-8000-000000000001",
  artistName: "River",
  artistHandle: "river",
  status: "AVAILABLE",
});
describe("bound wish recipient", () => {
  it("shows the canonical artist without allowing a conflicting query recipient", () => {
    const html = renderToStaticMarkup(
      <GiftDetailRecipient
        artists={new Promise(() => {})}
        locale="en"
        copy={copy}
        contextQuery="idol=30000000-0000-4000-8000-000000000001"
        path="/gifts/moonlight"
        wish={wish}
      />,
    );
    expect(html).toContain("A wish for River");
    expect(html).toContain(`/en/idols/river`);
    expect(html).not.toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("30000000-0000-4000-8000-000000000001");
  });
  it.each(["RESERVED", "SUPPORTED", "UNAVAILABLE"] as const)(
    "preserves the artist for %s wishes",
    (status) => {
      const html = renderToStaticMarkup(
        <GiftDetailRecipient
          artists={new Promise(() => {})}
          locale="en"
          copy={copy}
          contextQuery=""
          path="/gifts/moonlight"
          wish={{ ...wish, status }}
        />,
      );
      expect(html).toContain("River");
      expect(html).toContain(
        status === "SUPPORTED"
          ? copy.wishSupported
          : status === "RESERVED"
            ? copy.wishPaymentPending
            : copy.wishUnavailable,
      );
      expect(html).not.toContain("aria-haspopup");
    },
  );
});
