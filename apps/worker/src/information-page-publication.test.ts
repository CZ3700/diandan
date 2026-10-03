import { expect, test } from "vitest";
const subject = await import("./information-page-publication.js").catch(
  () => undefined,
);
const id = "a0000000-0000-4000-8000-000000000001";
const context = {
  decision: "READY",
  outboxEventId: id,
  consumerKey: "information-page-publication",
  event: {
    schemaVersion: 1,
    eventId: id,
    eventType: "INFORMATION_PAGE_PUBLICATION_CHANGED",
    aggregateId: id,
    occurredAt: "2026-09-29T00:00:00.000Z",
    correlationId: id,
    requestId: id,
    locale: "en",
    payload: { informationPagePublicationId: id },
  },
  aggregateVersion: 1,
  primarySubjectId: id,
  nextAttemptNumber: 1,
};
test("no-store publication consumer validates the authoritative event before recording its durable observation", async () => {
  expect(subject?.informationPagePublicationConsumer).toBeDefined();
  const consumer = subject!.informationPagePublicationConsumer;
  const input = context as unknown as Parameters<typeof consumer.effect>[0];
  expect(consumer.effect(input)).toEqual({
    effectKey: "INFORMATION_PAGE_PUBLICATION_OBSERVED",
    subjectId: id,
  });
  await expect(
    consumer.dispatch(input, {
      schemaVersion: 1,
      idempotencyKey: "local-observation",
    }),
  ).resolves.toBeUndefined();
  for (const change of [
    { consumerKey: "notification-provider" },
    { primarySubjectId: "b0000000-0000-4000-8000-000000000001" },
    { event: { ...context.event, eventType: "CONTENT_PUBLICATION_CHANGED" } },
  ])
    expect(() =>
      consumer.effect({ ...context, ...change } as unknown as typeof input),
    ).toThrow();
});
