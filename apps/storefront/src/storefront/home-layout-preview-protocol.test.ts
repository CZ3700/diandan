import { expect, test } from "vitest";
import { createDefaultHomeLayout } from "@fan-support/contracts";
const subject = await import("./home-layout-preview-protocol").catch(
  () => undefined,
);
const channel = "a0000000-0000-4000-8000-000000000001";
test("preview accepts only layout data from its configured parent and current channel", () => {
  expect(subject?.receivePreviewLayout).toBeTypeOf("function");
  const parent = {};
  const data = {
    schemaVersion: 1,
    type: "HOME_LAYOUT_PREVIEW",
    channel,
    layout: createDefaultHomeLayout(),
  };
  const event = {
    origin: "https://admin.example.invalid",
    source: parent,
    data,
  };
  const config = { adminOrigin: event.origin, parent, channel };
  expect(subject!.receivePreviewLayout(event, config)).toEqual(data.layout);
  for (const invalid of [
    { ...event, origin: "https://attacker.example.invalid" },
    { ...event, source: {} },
    {
      ...event,
      data: { ...data, channel: "b0000000-0000-4000-8000-000000000001" },
    },
    { ...event, data: { ...data, secret: "forbidden" } },
    { ...event, data: { ...data, layout: { ...data.layout, sections: [] } } },
  ]) {
    expect(subject!.receivePreviewLayout(invalid, config)).toBeNull();
  }
});
