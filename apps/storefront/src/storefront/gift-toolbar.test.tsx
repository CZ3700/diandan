import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { GiftNavigationPending } from "./gift-navigation-context";
import { GiftNavigationFrame } from "./gift-navigation-frame";
import { GiftToolbar } from "./gift-toolbar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const kinds = [
  { id: "ALL", label: "All", href: "/en/gifts", current: false },
  {
    id: "VIRTUAL",
    label: "Virtual",
    href: "/en/gifts?kind=VIRTUAL",
    current: true,
  },
  {
    id: "PHYSICAL",
    label: "Physical",
    href: "/en/gifts?kind=PHYSICAL",
    current: false,
  },
];
const sort = {
  heading: "Sort by",
  label: "Price",
  options: [
    {
      id: "PRICE_ASC",
      label: "Price: low to high",
      icon: "sort-ascending",
      href: "/en/gifts?sort=RECOMMENDED",
      current: true,
    },
    {
      id: "PRICE_DESC",
      label: "Price: high to low",
      icon: "sort-descending",
      href: "/en/gifts?sort=PRICE_DESC",
      current: false,
    },
  ],
} as const;
const render = (pending?: string) =>
  renderToStaticMarkup(
    <GiftNavigationPending value={pending}>
      <GiftToolbar
        kindsLabel="Gift type"
        kinds={kinds}
        count="3 gifts"
        sort={sort}
      />
    </GiftNavigationPending>,
  );
const current = (html: string, attribute: string) =>
  [...html.matchAll(/<a\b[^>]*>/gu)]
    .map(([anchor]) => anchor)
    .filter((anchor) => anchor.includes(attribute))
    .filter((anchor) => anchor.includes('aria-current="true"'))
    .map(
      (anchor) => new RegExp(`${attribute}="([^"]+)"`, "u").exec(anchor)?.[1],
    );

test("the toolbar marks the address's kind and price order, and every choice is a followable link", () => {
  const html = render();
  expect(current(html, "data-gift-kind-option")).toEqual(["VIRTUAL"]);
  expect(current(html, "data-gift-sort-option")).toEqual(["PRICE_ASC"]);
  expect(html).toContain(
    '<nav class="gift-toolbar__kinds" aria-label="Gift type">',
  );
  expect(html).toContain('role="group" aria-label="Sort by"');
  expect(html).toContain(
    'href="/en/gifts?kind=PHYSICAL" data-gift-nav="kind:PHYSICAL"',
  );
  // The active order links back to the recommended one; the other names its own order.
  expect(html).toContain(
    'href="/en/gifts?sort=RECOMMENDED" data-gift-nav="sort:RECOMMENDED"',
  );
  expect(html).toContain(
    'href="/en/gifts?sort=PRICE_DESC" data-gift-nav="sort:PRICE_DESC"',
  );
  // Icon-only links carry their name.
  expect(html).toContain(
    'aria-label="Price: high to low" title="Price: high to low"',
  );
  expect(html).toContain(
    '<p class="gift-directory-count" aria-live="polite">3 gifts</p>',
  );
  expect(html).not.toContain("<button");
});

test.each([
  ["kind:PHYSICAL", ["PHYSICAL"], ["PRICE_ASC"]],
  ["kind:ALL", ["ALL"], ["PRICE_ASC"]],
  ["sort:PRICE_DESC", ["VIRTUAL"], ["PRICE_DESC"]],
  // Clicking the active order clears it at once.
  ["sort:RECOMMENDED", ["VIRTUAL"], []],
  // A page change keeps both.
  ["page", ["VIRTUAL"], ["PRICE_ASC"]],
])(
  "while %s is loading, the toolbar already shows it as chosen",
  (pending, kind, order) => {
    const html = render(pending);
    expect(current(html, "data-gift-kind-option")).toEqual(kind);
    expect(current(html, "data-gift-sort-option")).toEqual(order);
  },
);

test("a list without prices offers no price order", () => {
  const html = renderToStaticMarkup(
    <GiftToolbar kindsLabel="Gift type" kinds={kinds} count="3 gifts" />,
  );
  expect(html).not.toContain("data-gift-sort");
  expect(html).toContain("data-gift-kind-option");
});

test("the navigation frame renders its gifts untouched and is idle until a link is followed", () => {
  const next = "/en/gifts?page=2";
  const html = renderToStaticMarkup(
    <GiftNavigationFrame>
      <a href={next} data-gift-nav="page">
        Next
      </a>
    </GiftNavigationFrame>,
  );
  expect(html).toBe(
    '<div class="gift-navigation" data-gift-navigation="true" tabindex="-1"><a href="/en/gifts?page=2" data-gift-nav="page">Next</a></div>',
  );
});
