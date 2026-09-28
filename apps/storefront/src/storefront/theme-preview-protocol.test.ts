import { expect, test } from "vitest";
import type * as ThemePreviewProtocol from "./theme-preview-protocol";

const parent = {};
const channel = "8c7cc797-c5fa-4a11-b0eb-6d282b9c4019";
const adminOrigin = "https://admin.example.invalid";
const theme = {
  schemaVersion: 1,
  palette: "MIDNIGHT_BLUE",
  typography: "LARGE",
  density: "AIRY",
  corners: "ROUND",
};

test("theme preview requires its own message, current parent, origin and channel", async () => {
  let subject: typeof ThemePreviewProtocol | undefined;
  try {
    subject = await import("./theme-preview-protocol");
  } catch {
    /* Missing implementation is the initial red case. */
  }
  expect(subject?.receivePreviewTheme).toBeTypeOf("function");
  const receive = subject!.receivePreviewTheme;
  const context = { parent, adminOrigin, channel };
  const event = {
    source: parent,
    origin: adminOrigin,
    data: {
      schemaVersion: 1,
      type: "STOREFRONT_THEME_PREVIEW",
      channel,
      theme,
    },
  };
  expect(receive(event, context)).toEqual(theme);
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
      data: { ...event.data, theme: { ...theme, css: "display:none" } },
    },
  ])
    expect(receive(invalid, context)).toBeNull();
});
