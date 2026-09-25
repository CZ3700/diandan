import {
  currencySchema,
  minorAmountSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  CartLine,
  GiftTile,
  Hero,
  IdolContext,
  IdolPortrait,
  OrderTimeline,
  type CartLineProps,
  type CompositeMedia,
  type HeroProps,
} from "./composites.js";

const locale = "en" satisfies SupportedLocale;
const currency = currencySchema.parse("USD");
const amountMinor = minorAmountSchema.parse(12_900);

const portrait = {
  alt: "Portrait of fictional performer Mira Vale",
  fallbackLabel: "Mira Vale portrait is unavailable",
  focalPoint: { x: 0.5, y: 0.32 },
  height: 1_500,
  src: "/ui-composites/fictional-performer-hero-mobile.png",
  state: "ready",
  width: 1_200,
} satisfies CompositeMedia;

const giftMedia = {
  alt: "Navy keepsake box with ivory ribbon and dried flowers",
  fallbackLabel: "Keepsake gift image is unavailable",
  focalPoint: { x: 0.5, y: 0.5 },
  height: 1_536,
  src: "/ui-composites/fictional-keepsake-gift.png",
  state: "ready",
  width: 1_536,
} satisfies CompositeMedia;

const heroProps = {
  action: { href: "#gifts", label: "Choose a support gift" },
  description: "Send a thoughtful gift prepared with care.",
  eyebrow: "For Mira Vale",
  heading: "Make the moment feel close",
  media: {
    alt: "Fictional performer Mira Vale beside blue and ivory flowers",
    desktop: {
      focalPoint: { x: 0.72, y: 0.42 },
      height: 918,
      src: "/ui-composites/fictional-performer-hero-desktop.png",
      width: 1_680,
    },
    fallbackLabel: "Mira Vale hero image is unavailable",
    mobile: {
      focalPoint: { x: 0.5, y: 0.28 },
      height: 1_408,
      src: "/ui-composites/fictional-performer-hero-mobile.png",
      width: 1_122,
    },
    state: "ready",
  },
  state: "ready",
  textTone: "light",
} satisfies HeroProps;

describe("Hero", () => {
  test("renders responsive art direction, one heading and a real navigation action", () => {
    const markup = renderToStaticMarkup(<Hero {...heroProps} />);

    expect(markup).toContain('data-fs-composite="hero"');
    expect(markup).toContain('data-render-state="ready"');
    expect(markup).toContain('data-text-tone="light"');
    expect(markup).toContain("<picture>");
    expect(markup).toContain('media="(max-width: 47.999rem)"');
    expect(markup).toContain("fictional-performer-hero-mobile.png");
    expect(markup).toContain("fictional-performer-hero-desktop.png");
    expect(markup).toContain("<h1");
    expect(markup).toContain("Make the moment feel close");
    expect(markup).toMatch(/<a[^>]+href="#gifts"/u);
  });

  test("preserves the responsive frame when an explicit media failure is shown", () => {
    const markup = renderToStaticMarkup(
      <Hero {...heroProps} media={{ ...heroProps.media, state: "error" }} />,
    );

    expect(markup).toContain('data-media-state="error"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain("Mira Vale hero image is unavailable");
    expect(markup).not.toContain("<picture>");
  });
});

describe("IdolPortrait", () => {
  test("makes an accepting idol selectable and exposes selection in text and semantics", () => {
    const markup = renderToStaticMarkup(
      <IdolPortrait
        availability={{ kind: "accepting", label: "Accepting gifts" }}
        href="#mira"
        media={portrait}
        name="Mira Vale"
        selectedLabel="Selected idol"
        selection="selected"
        state="ready"
      />,
    );

    expect(markup).toContain('data-fs-composite="idol-portrait"');
    expect(markup).toContain('data-selection="selected"');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain("Selected idol");
    expect(markup).toContain("Accepting gifts");
  });

  test("does not disguise a paused idol as an action", () => {
    const markup = renderToStaticMarkup(
      <IdolPortrait
        availability={{ kind: "unavailable", label: "Gifts paused" }}
        media={{ ...portrait, state: "error" }}
        name="Mira Vale"
        selection="unselected"
        state="ready"
      />,
    );

    expect(markup).toContain('data-availability="unavailable"');
    expect(markup).toContain("Gifts paused");
    expect(markup).toContain('data-media-state="error"');
    expect(markup).not.toContain("<a");
  });
});

describe("GiftTile", () => {
  test("keeps price, availability and detail navigation explicit", () => {
    const markup = renderToStaticMarkup(
      <GiftTile
        availability={{ kind: "low-stock", label: "Only a few remain" }}
        href="#keepsake"
        media={giftMedia}
        price={{ amountMinor, currency, locale }}
        state="ready"
        subtitle="Prepared and delivered by our team"
        title="Midnight keepsake"
      />,
    );

    expect(markup).toContain('data-fs-composite="gift-tile"');
    expect(markup).toContain('data-availability="low-stock"');
    expect(markup).toContain('data-currency="USD"');
    expect(markup).toContain('value="12900"');
    expect(markup).toContain("Only a few remain");
    expect(markup).toMatch(/<a[^>]+href="#keepsake"/u);
  });

  test("shows unavailable and image-error states without removing details", () => {
    const markup = renderToStaticMarkup(
      <GiftTile
        availability={{ kind: "unavailable", label: "Currently unavailable" }}
        href="#keepsake"
        media={{ ...giftMedia, state: "error" }}
        price={{ amountMinor, currency, locale }}
        state="ready"
        title="Midnight keepsake"
      />,
    );

    expect(markup).toContain('data-availability="unavailable"');
    expect(markup).toContain('data-media-state="error"');
    expect(markup).toContain("Currently unavailable");
    expect(markup).toMatch(/<a[^>]+href="#keepsake"/u);
  });
});

describe("IdolContext", () => {
  test("names the selected recipient independently from the gift and price context", () => {
    const markup = renderToStaticMarkup(
      <IdolContext
        action={{ href: "#idols", label: "Change idol" }}
        availability={{ kind: "accepting", label: "Accepting gifts" }}
        contextLabel="Gift for"
        media={portrait}
        name="Mira Vale"
        state="ready"
      />,
    );

    expect(markup).toContain('data-fs-composite="idol-context"');
    expect(markup).toContain('aria-label="Gift for Mira Vale"');
    expect(markup).toContain("Gift for");
    expect(markup).toContain("Mira Vale");
    expect(markup).toMatch(/<a[^>]+href="#idols"/u);
  });
});

describe("CartLine", () => {
  test("renders public cart projection facts without accepting private plaintext", () => {
    const markup = renderToStaticMarkup(
      <CartLine
        editAction={{ href: "#note", label: "Edit private note" }}
        gift={{
          href: "#keepsake",
          media: giftMedia,
          title: "Midnight keepsake",
          variantLabel: "Standard",
        }}
        idol={{ contextLabel: "For", media: portrait, name: "Mira Vale" }}
        lineTotal={{ amountMinor, currency, locale }}
        message={{ kind: "present", label: "Private note added" }}
        quantity={{ label: "Quantity", value: 2 }}
        state="ready"
      />,
    );

    expect(markup).toContain('data-fs-composite="cart-line"');
    expect(markup).toContain('data-private-message="present"');
    expect(markup).toContain("Private note added");
    expect(markup).toContain("Quantity");
    expect(markup).toContain('value="2"');
    expect(markup).toContain("For");
    expect(markup).toContain("Mira Vale");
    expect(markup).toContain(portrait.alt);
    expect(markup).toContain('data-currency="USD"');
    expect(markup).toMatch(/<a[^>]+href="#note"/u);
    expect(markup).not.toContain("Remove gift");
  });

  test("preserves an explicit updating state without inventing client callbacks", () => {
    const markup = renderToStaticMarkup(
      <CartLine label="Updating gift quantity" state="loading" />,
    );

    expect(markup).toContain('data-render-state="loading"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Updating gift quantity");
  });

  test("does not spread injected private plaintext into rendered output", () => {
    const props = {
      editAction: { href: "#note", label: "Edit private note" },
      fanMessage: "PRIVATE_FIXTURE_MESSAGE_SENTINEL",
      gift: { media: giftMedia, title: "Midnight keepsake" },
      idol: { contextLabel: "For", media: portrait, name: "Mira Vale" },
      lineTotal: { amountMinor, currency, locale },
      message: { kind: "present", label: "Private note added" },
      quantity: { label: "Quantity", value: 1 },
      state: "ready",
    } as unknown as CartLineProps;

    const markup = renderToStaticMarkup(<CartLine {...props} />);

    expect(markup).not.toContain("PRIVATE_FIXTURE_MESSAGE_SENTINEL");
  });
});

describe("OrderTimeline", () => {
  test("renders an ordered, text-labelled fulfillment progression", () => {
    const markup = renderToStaticMarkup(
      <OrderTimeline
        label="Order progress"
        state="ready"
        steps={[
          {
            key: "paid",
            label: "Payment confirmed",
            moment: {
              dateTime: "2026-09-04T12:00:00Z",
              label: "September 4, 2026",
            },
            state: "completed",
            stateLabel: "Completed",
          },
          {
            key: "preparing",
            label: "Preparing your gift",
            state: "current",
            stateLabel: "In progress",
          },
          {
            key: "delivered",
            label: "Delivered to the idol",
            state: "upcoming",
            stateLabel: "Next",
          },
        ]}
      />,
    );

    expect(markup).toContain('data-fs-composite="order-timeline"');
    expect(markup).toContain("<ol");
    expect(markup.match(/<li/gmu)).toHaveLength(3);
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain("Completed");
    expect(markup).toContain("In progress");
    expect(markup).toContain("Next");
    expect(markup).toContain(
      '<time dateTime="2026-09-04T12:00:00Z">September 4, 2026</time>',
    );
  });

  test("rejects duplicate keys", () => {
    const duplicateSteps = [
      {
        key: "same",
        label: "One",
        state: "current" as const,
        stateLabel: "Current",
      },
      {
        key: "same",
        label: "Two",
        state: "current" as const,
        stateLabel: "Current",
      },
    ] as const;

    expect(() =>
      renderToStaticMarkup(
        <OrderTimeline
          label="Order progress"
          state="ready"
          steps={duplicateSteps}
        />,
      ),
    ).toThrow(/unique keys/u);
  });

  test("rejects multiple current steps even when their keys are unique", () => {
    expect(() =>
      renderToStaticMarkup(
        <OrderTimeline
          label="Order progress"
          state="ready"
          steps={[
            {
              key: "paid",
              label: "Payment confirmed",
              state: "current",
              stateLabel: "Current",
            },
            {
              key: "preparing",
              label: "Preparing your gift",
              state: "current",
              stateLabel: "Current",
            },
          ]}
        />,
      ),
    ).toThrow(/one current step/u);
  });
});

describe("shared composite states", () => {
  const cases: ReadonlyArray<
    readonly [string, (state: "loading" | "empty" | "error") => ReactElement]
  > = [
    [
      "hero",
      (state) =>
        state === "loading" ? (
          <Hero label="Loading hero" state="loading" />
        ) : (
          <Hero
            action={{ href: "#retry", label: "Try again" }}
            description="Please return shortly."
            state={state}
            title={state === "empty" ? "No featured idol" : "Hero unavailable"}
          />
        ),
    ],
    [
      "idol-portrait",
      (state) =>
        state === "loading" ? (
          <IdolPortrait label="Loading idol" state="loading" />
        ) : (
          <IdolPortrait
            description="Choose another idol."
            state={state}
            title="Idol unavailable"
          />
        ),
    ],
    [
      "gift-tile",
      (state) =>
        state === "loading" ? (
          <GiftTile label="Loading gift" state="loading" />
        ) : (
          <GiftTile
            description="Browse another gift."
            state={state}
            title="Gift unavailable"
          />
        ),
    ],
    [
      "idol-context",
      (state) =>
        state === "loading" ? (
          <IdolContext label="Loading recipient" state="loading" />
        ) : (
          <IdolContext
            description="Select an idol first."
            state={state}
            title="Recipient required"
          />
        ),
    ],
    [
      "cart-line",
      (state) =>
        state === "loading" ? (
          <CartLine label="Loading cart line" state="loading" />
        ) : (
          <CartLine
            description="Refresh the cart."
            state={state}
            title="Cart line unavailable"
          />
        ),
    ],
    [
      "order-timeline",
      (state) =>
        state === "loading" ? (
          <OrderTimeline label="Loading order progress" state="loading" />
        ) : (
          <OrderTimeline
            description="Check the order later."
            state={state}
            title="No order updates"
          />
        ),
    ],
  ];

  test.each(cases)(
    "%s exposes loading, empty and error states",
    (name, render) => {
      for (const state of ["loading", "empty", "error"] as const) {
        const markup = renderToStaticMarkup(render(state));
        expect(markup).toContain(`data-fs-composite="${name}"`);
        expect(markup).toContain(`data-render-state="${state}"`);
        expect(markup).toContain(
          state === "loading" ? "aria-busy" : "fs-composite-state",
        );
      }
    },
  );
});

const unsafeHero: HeroProps = {
  ...heroProps,
  // @ts-expect-error Composite actions are serializable hrefs, never callbacks.
  onClick: () => undefined,
};
void unsafeHero;

const unsafeCartLine: CartLineProps = {
  label: "Loading",
  state: "loading",
  // @ts-expect-error Private message plaintext is outside the public cart component contract.
  fanMessage: "This must stay encrypted",
};
void unsafeCartLine;
