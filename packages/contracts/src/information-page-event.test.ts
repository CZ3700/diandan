import { expect, test } from "vitest";
import { eventEnvelopeSchema } from "./envelopes.js";
const id = "10000000-0000-4000-8000-000000000001";
test("information page publication has a distinct typed event without legacy content identity", () => {
  const event = {
    schemaVersion: 1,
    eventId: id,
    eventType: "INFORMATION_PAGE_PUBLICATION_CHANGED",
    aggregateId: id,
    occurredAt: "2026-09-29T00:00:00Z",
    correlationId: id,
    requestId: id,
    locale: "en",
    payload: { informationPagePublicationId: id },
  };
  expect(eventEnvelopeSchema.safeParse(event).success).toBe(true);
  expect(
    eventEnvelopeSchema.safeParse({
      ...event,
      payload: { contentPublicationId: id },
    }).success,
  ).toBe(false);
});
