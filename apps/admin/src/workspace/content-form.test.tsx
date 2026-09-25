import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentFields } from "./content-form";
import { translator } from "./components";

const giftFields = {
  subtitle: "Translated subtitle",
  safetyNotice: "Translated safety notice",
  title: "Translated title",
  shortDescription: "Translated short description",
  description: "Translated description",
  fulfillmentDescription: "Translated preparation",
  variantLabels: [
    { giftVariantId: "variant-b", label: "Second identifier, first label" },
    { giftVariantId: "variant-a", label: "First identifier, second label" },
  ],
  seoTitle: "Translated search title",
  seoDescription: "Translated search description",
};
const giftLabels = [
  "Title",
  "Subtitle",
  "Short description",
  "Description",
  "Preparation and delivery",
  "Safety notice",
  "Variant name · 1",
  "Variant name · 2",
  "Search title",
  "Search description",
];
function labels(html: string) {
  return [...html.matchAll(/<label\b[^>]*>(.*?)<\/label>/gu)].map(
    (match) => match[1],
  );
}
function render(fields: Record<string, unknown>, disabled = false) {
  return renderToStaticMarkup(
    <ContentFields
      fields={fields}
      t={translator("en")}
      onChange={() => {}}
      disabled={disabled}
    />,
  );
}

it("renders gift fields in review order regardless of object insertion order", () => {
  const html = render(giftFields);
  const reversed = render(
    Object.fromEntries(Object.entries(giftFields).reverse()),
  );
  expect(labels(html)).toEqual(giftLabels);
  expect(labels(reversed)).toEqual(giftLabels);
  expect(html.indexOf("Second identifier, first label")).toBeLessThan(
    html.indexOf("First identifier, second label"),
  );
});

it("keeps empty optional source fields in the same disabled slots without changing source data", () => {
  const source = Object.fromEntries(
    Object.entries(giftFields).filter(
      ([key]) => key !== "subtitle" && key !== "safetyNotice",
    ),
  );
  const before = structuredClone(source);
  const onChange = vi.fn();
  const html = renderToStaticMarkup(
    <ContentFields
      fields={source}
      t={translator("en")}
      onChange={onChange}
      disabled
    />,
  );
  expect(labels(html)).toEqual(giftLabels);
  for (const label of ["Subtitle", "Safety notice"]) {
    expect(html).toMatch(
      new RegExp(
        `<label[^>]*>${label}</label><textarea[^>]*disabled=""[^>]*></textarea>`,
        "u",
      ),
    );
  }
  expect(source).toEqual(before);
  expect(onChange).not.toHaveBeenCalled();
});

it.each([
  {
    fields: { displayName: "Artist", shortBio: "Biography", fullBio: "Full" },
    expected: ["Artist name", "Short biography", "Biography"],
  },
  {
    fields: {
      alt: "Image description",
      title: "Image title",
      caption: "Caption",
    },
    expected: ["Alternative text", "Title", "Caption"],
  },
])(
  "preserves existing non-gift field rendering: $expected",
  ({ fields, expected }) => {
    expect(labels(render(fields))).toEqual(expected);
  },
);
