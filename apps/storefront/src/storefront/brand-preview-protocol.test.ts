import { expect, test } from "vitest";
import type * as Protocol from "./brand-preview-protocol";

test("brand preview accepts only its own current parent, origin, channel and safe media view", async () => {
  let subject: typeof Protocol | undefined;
  try {
    subject = await import("./brand-preview-protocol");
  } catch {
    /* Initial red case. */
  }
  expect(subject?.receivePreviewBrand).toBeTypeOf("function");
  const receive = subject!.receivePreviewBrand;
  const parent = {};
  const channel = "8c7cc797-c5fa-4a11-b0eb-6d282b9c4019";
  const adminOrigin = "https://admin.example.invalid";
  const brand = { schemaVersion: 1, lightLogo: null, darkLogo: null };
  const context = { parent, adminOrigin, channel };
  const event = {
    source: parent,
    origin: adminOrigin,
    data: {
      schemaVersion: 1,
      type: "STOREFRONT_BRAND_PREVIEW",
      channel,
      brand,
    },
  };
  expect(receive(event, context)).toEqual(brand);
  for (const invalid of [
    { ...event, source: {} },
    { ...event, origin: "https://other.example.invalid" },
    {
      ...event,
      data: { ...event.data, channel: "a9394969-50f7-4ba1-a02e-82ba8b1f04bf" },
    },
    { ...event, data: { ...event.data, type: "STOREFRONT_THEME_PREVIEW" } },
    {
      ...event,
      data: { ...event.data, brand: { ...brand, css: "display:none" } },
    },
    {
      ...event,
      data: {
        ...event.data,
        brand: {
          ...brand,
          lightLogo: {
            assetId: channel,
            url: "data:image/svg+xml,<svg/>",
            width: 50,
            height: 50,
          },
        },
      },
    },
  ])
    expect(receive(invalid, context)).toBeNull();
});
