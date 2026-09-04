import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { SupportedLocale } from "@fan-support/contracts";

async function loadInteractions() {
  const loaded = await import("./interactions.js");

  expect(
    loaded,
    "the dedicated client interaction entry must exist",
  ).toBeDefined();
  return loaded;
}

describe("interaction entry", () => {
  test("exports only the approved interactive primitives", async () => {
    const interactions = await loadInteractions();

    expect(Object.keys(interactions).sort()).toEqual([
      "Dialog",
      "Drawer",
      "LanguageControl",
      "LiveRegion",
      "Menu",
      "RegionControl",
      "ToastProvider",
      "useToast",
    ]);
    for (const name of Object.keys(interactions)) {
      expect(interactions[name as keyof typeof interactions]).toBeTypeOf(
        "function",
      );
    }
  });
});

describe("LiveRegion", () => {
  test.each([
    ["polite", "status", "polite"],
    ["assertive", "alert", "assertive"],
  ] as const)(
    "renders an atomic %s announcement without a focus target",
    async (politeness, role, ariaLive) => {
      const { LiveRegion } = await loadInteractions();
      const markup = renderToStaticMarkup(
        <LiveRegion message="Selection updated" politeness={politeness} />,
      );

      expect(markup).toContain(`role="${role}"`);
      expect(markup).toContain(`aria-live="${ariaLive}"`);
      expect(markup).toContain('aria-atomic="true"');
      expect(markup).toContain("Selection updated");
      expect(markup).not.toContain("tabindex");
    },
  );
});

describe("overlay contracts", () => {
  test("requires accessible trigger, title, description, and close copy", async () => {
    const { Dialog } = await loadInteractions();
    const base = {
      closeLabel: "Close",
      description: "A focused decision",
      title: "Review",
      triggerLabel: "Open dialog",
    } as const;

    expect(() =>
      renderToStaticMarkup(<Dialog {...base} triggerLabel={null} />),
    ).toThrow(/trigger label/u);
    expect(() =>
      renderToStaticMarkup(<Dialog {...base} closeLabel=" " />),
    ).toThrow(/close label/u);
  });
});

describe("selection controls", () => {
  test("renders the canonical native language name without deriving region", async () => {
    const { LanguageControl } = await loadInteractions();
    const onValueChange = vi.fn<(locale: SupportedLocale) => void>();
    const markup = renderToStaticMarkup(
      <LanguageControl
        label="Language"
        onValueChange={onValueChange}
        value="zh-CN"
      />,
    );

    expect(markup).toContain("Language");
    expect(markup).toContain("简体中文");
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("▾");
    expect(markup).not.toContain("flag");
    expect(markup).not.toContain("currency");
  });

  test("renders caller-owned region copy without deriving locale or currency", async () => {
    const { RegionControl } = await loadInteractions();
    const markup = renderToStaticMarkup(
      <RegionControl
        label="Region"
        onValueChange={vi.fn()}
        options={[
          {
            detail: "Market: Americas · Currency: USD",
            label: "United States",
            value: "US",
          },
          {
            detail: "Market: Canada · Currency: CAD",
            label: "Canada",
            value: "CA",
          },
        ]}
        value="US"
      />,
    );

    expect(markup).toContain("Region");
    expect(markup).toContain("United States");
    expect(markup).toContain("Market: Americas · Currency: USD");
    expect(markup).not.toContain("English");
  });

  test("rejects duplicate, empty, or missing selected options", async () => {
    const { RegionControl } = await loadInteractions();
    const base = {
      label: "Region",
      onValueChange: vi.fn(),
    } as const;

    expect(() =>
      renderToStaticMarkup(<RegionControl {...base} options={[]} value="US" />),
    ).toThrow(/at least one option/u);
    expect(() =>
      renderToStaticMarkup(
        <RegionControl
          {...base}
          label=" "
          options={[{ label: "United States", value: "US" }]}
          value="US"
        />,
      ),
    ).toThrow(/label/u);
    expect(() =>
      renderToStaticMarkup(
        <RegionControl
          {...base}
          options={[
            { label: "United States", value: "US" },
            { label: "Duplicate", value: "US" },
          ]}
          value="US"
        />,
      ),
    ).toThrow(/unique/u);
    expect(() =>
      renderToStaticMarkup(
        <RegionControl
          {...base}
          options={[{ label: "United States", value: "US" }]}
          value="CA"
        />,
      ),
    ).toThrow(/selected value/u);
    expect(() =>
      renderToStaticMarkup(
        <RegionControl
          {...base}
          options={[{ disabled: true, label: "Canada", value: "CA" }]}
          value="CA"
        />,
      ),
    ).toThrow(/enabled option/u);
  });
});
