import { currencySchema, minorAmountSchema } from "@fan-support/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { InteractiveCartLine } from "./composites-client.js";
import type { CompositeMedia } from "./composite-types.js";

const media = {
  alt: "Fictional performer Mira Vale",
  fallbackLabel: "Portrait unavailable",
  focalPoint: { x: 0.5, y: 0.3 },
  height: 1_402,
  src: "/portrait.png",
  state: "ready",
  width: 1_122,
} satisfies CompositeMedia;

test("renders real quantity and remove controls around the safe CartLine projection", () => {
  const markup = renderToStaticMarkup(
    <InteractiveCartLine
      editAction={{ href: "#note", label: "Edit private note" }}
      gift={{ media, title: "Midnight keepsake" }}
      idol={{ contextLabel: "For", media, name: "Mira Vale" }}
      lineTotal={{
        amountMinor: minorAmountSchema.parse(12_900),
        currency: currencySchema.parse("USD"),
        locale: "en",
      }}
      message={{ kind: "present", label: "Private note added" }}
      onQuantityChange={vi.fn()}
      onRemove={vi.fn()}
      quantity={{
        decreaseLabel: "Decrease quantity",
        id: "line-1-quantity",
        increaseLabel: "Increase quantity",
        label: "Quantity",
        max: 5,
        min: 1,
        value: 2,
      }}
      removeLabel="Remove gift"
    />,
  );

  expect(markup).toContain('role="spinbutton"');
  expect(markup).toContain('aria-label="Decrease quantity"');
  expect(markup).toContain('aria-label="Increase quantity"');
  expect(markup).toContain('data-cart-line-action="remove"');
  expect(markup).toMatch(/<button[^>]+type="button"[^>]*>/u);
  expect(markup).not.toMatch(/<a[^>]*>Remove gift<\/a>/u);
});

test("rejects a Quantity lower bound that can make CartLine invalid", () => {
  expect(() =>
    renderToStaticMarkup(
      <InteractiveCartLine
        gift={{ media, title: "Midnight keepsake" }}
        idol={{ contextLabel: "For", media, name: "Mira Vale" }}
        lineTotal={{
          amountMinor: minorAmountSchema.parse(12_900),
          currency: currencySchema.parse("USD"),
          locale: "en",
        }}
        message={{ kind: "none", label: "No private note" }}
        onQuantityChange={vi.fn()}
        onRemove={vi.fn()}
        quantity={{
          decreaseLabel: "Decrease quantity",
          id: "line-invalid-quantity",
          increaseLabel: "Increase quantity",
          label: "Quantity",
          max: 5,
          min: 0,
          value: 1,
        }}
        removeLabel="Remove gift"
      />,
    ),
  ).toThrow(/positive minimum/u);
});
