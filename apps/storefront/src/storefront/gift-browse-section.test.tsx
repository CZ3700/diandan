import { Children, type ReactElement, type ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";

vi.mock("server-only", () => ({}));
vi.mock("../server/public-gift-browse", () => ({ readGiftBrowse: vi.fn() }));

type Node = ReactElement<{ className?: string; children?: ReactNode }>;
const heading = (section: Node) =>
  Children.toArray(
    (Children.toArray(section.props.children)[0] as Node).props.children,
  )[0] as Node;

// On the homepage the four-kinds section right above already carries the same eyebrow.
test("the homepage gift section can drop its repeated eyebrow", async () => {
  const { GiftBrowseSection } = await import("./gift-browse-section");
  const copy = await loadStorefrontCopy("en");
  const props = { locale: "en" as const, copy, values: {} };
  const eyebrows = (section: Node) =>
    Children.toArray(heading(section).props.children).filter(
      (child) => (child as Node).props.className === "storefront-eyebrow",
    );
  expect(eyebrows(GiftBrowseSection(props) as Node)).toHaveLength(1);
  expect(
    eyebrows(GiftBrowseSection({ ...props, eyebrow: false }) as Node),
  ).toHaveLength(0);
});
