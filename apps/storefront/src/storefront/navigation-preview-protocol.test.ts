import { expect, test } from "vitest";
import type * as NavigationPreviewProtocol from "./navigation-preview-protocol";

const parent = {};
const channel = "8c7cc797-c5fa-4a11-b0eb-6d282b9c4019";
const adminOrigin = "https://admin.example.invalid";
const navigation = {
  schemaVersion: 1,
  header: ["GIFTS", "HOME", "ARTISTS"],
  footer: [
    { id: "DESCRIPTION", visible: false },
    { id: "REGION", visible: true },
    { id: "ARTISTS", visible: true },
    { id: "GIFTS", visible: true },
    { id: "POLICIES", visible: true },
  ],
};

test("navigation preview requires its own message, current parent, origin and channel", async () => {
  let subject: typeof NavigationPreviewProtocol | undefined;
  try {
    subject = await import("./navigation-preview-protocol");
  } catch {
    /* Missing implementation is the initial red case. */
  }
  expect(subject?.receivePreviewNavigation).toBeTypeOf("function");
  const receive = subject!.receivePreviewNavigation;
  const context = { parent, adminOrigin, channel };
  const event = {
    source: parent,
    origin: adminOrigin,
    data: {
      schemaVersion: 1,
      type: "STOREFRONT_NAVIGATION_PREVIEW",
      channel,
      navigation,
    },
  };
  expect(receive(event, context)).toEqual(navigation);
  for (const invalid of [
    { ...event, source: {} },
    { ...event, origin: "https://other.example.invalid" },
    {
      ...event,
      data: { ...event.data, channel: "a9394969-50f7-4ba1-a02e-82ba8b1f04bf" },
    },
    { ...event, data: { ...event.data, type: "HOME_LAYOUT_PREVIEW" } },
    {
      ...event,
      data: {
        ...event.data,
        navigation: { ...navigation, css: "display:none" },
      },
    },
  ])
    expect(receive(invalid, context)).toBeNull();
});
