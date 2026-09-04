import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import * as motionClient from "./motion-client.js";
import type { IdolSwitchItem } from "./motion-client.js";

const idols = [
  {
    description: "A fictional midnight-blue editorial portrait.",
    id: "mira",
    media: {
      alt: "Fictional performer Mira Vale",
      fallbackLabel: "Portrait unavailable",
      focalPoint: { x: 0.5, y: 0.28 },
      height: 1_402,
      src: "/mira.png",
      state: "ready",
      width: 1_122,
    },
    name: "Mira Vale",
  },
  {
    description: "A fictional ivory-and-cobalt editorial portrait.",
    id: "noa",
    media: {
      alt: "Fictional performer Noa Aster",
      fallbackLabel: "Portrait unavailable",
      focalPoint: { x: 0.48, y: 0.3 },
      height: 1_402,
      src: "/noa.png",
      state: "ready",
      width: 1_122,
    },
    name: "Noa Aster",
  },
] as const satisfies readonly IdolSwitchItem[];

describe("motion client entry", () => {
  test("exports only the two reviewed interactive motion components", () => {
    expect(Object.keys(motionClient).sort()).toEqual([
      "AddToCartConfirmation",
      "IdolSwitcher",
    ]);
  });

  test("renders an immediately usable native radio group with explicit selected state", () => {
    const markup = renderToStaticMarkup(
      <motionClient.IdolSwitcher
        initialId="mira"
        items={idols}
        label="Choose an idol"
        selectedLabel="Selected"
      />,
    );

    expect(markup).toContain('data-fs-motion="idol-switcher"');
    expect(markup).toContain("<fieldset");
    expect(markup).toContain("<legend");
    expect(markup).toContain('type="radio"');
    expect(markup).toContain('checked=""');
    expect(markup).toContain("aria-controls=");
    expect(markup).toContain("Mira Vale");
    expect(markup).toContain("Selected");
    expect(markup).toContain('data-motion-mode="instant"');
    expect(markup).not.toContain("aria-live");
  });

  test("renders each controlled add-to-cart state without deciding commerce truth", () => {
    const onAdd = vi.fn();
    const common = {
      announcement: "Midnight keepsake added to cart",
      confirmedLabel: "Added to cart",
      errorLabel: "Try adding again",
      label: "Add gift to cart",
      onAdd,
      pendingLabel: "Adding gift",
    } as const;

    const idle = renderToStaticMarkup(
      <motionClient.AddToCartConfirmation {...common} status="idle" />,
    );
    const pending = renderToStaticMarkup(
      <motionClient.AddToCartConfirmation {...common} status="pending" />,
    );
    const confirmed = renderToStaticMarkup(
      <motionClient.AddToCartConfirmation {...common} status="confirmed" />,
    );
    const error = renderToStaticMarkup(
      <motionClient.AddToCartConfirmation
        {...common}
        announcement="The gift could not be added"
        status="error"
      />,
    );

    expect(idle).toContain('data-confirmation-state="idle"');
    expect(idle).toContain('aria-label="Add gift to cart"');
    expect(pending).toContain('data-confirmation-state="pending"');
    expect(pending).toContain('aria-busy="true"');
    expect(pending).toContain('aria-disabled="true"');
    expect(pending).toContain('aria-label="Adding gift"');
    expect(pending).not.toContain(" disabled");
    expect(confirmed).toContain('data-confirmation-state="confirmed"');
    expect(confirmed).toContain('aria-label="Added to cart"');
    expect(confirmed).toContain("Midnight keepsake added to cart");
    expect(error).toContain('data-confirmation-state="error"');
    expect(error).toContain('role="alert"');
    expect(error).toContain("The gift could not be added");
  });

  test("rejects blank action and announcement copy", () => {
    const base = {
      announcement: "Gift added",
      confirmedLabel: "Added",
      errorLabel: "Try again",
      label: "Add",
      onAdd: vi.fn(),
      pendingLabel: "Adding",
      status: "idle" as const,
    };

    expect(() =>
      renderToStaticMarkup(
        <motionClient.AddToCartConfirmation {...base} label=" " />,
      ),
    ).toThrow(/label/u);
    expect(() =>
      renderToStaticMarkup(
        <motionClient.AddToCartConfirmation {...base} announcement=" " />,
      ),
    ).toThrow(/announcement/u);
  });
});
