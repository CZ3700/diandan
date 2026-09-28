import type { OutboxConsumer } from "@fan-support/application";
import { loadOutboxDispatchContextResponseSchema } from "@fan-support/contracts";

export const informationPagePublicationConsumerKey =
  "information-page-publication";
function validate(input: Parameters<OutboxConsumer["effect"]>[0]) {
  const { value } = loadOutboxDispatchContextResponseSchema.parse({
    schemaVersion: 1,
    operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
    outcome: "SUCCESS",
    value: input,
  });
  if (
    value.decision !== "READY" ||
    value.consumerKey !== informationPagePublicationConsumerKey ||
    value.event.eventType !== "INFORMATION_PAGE_PUBLICATION_CHANGED" ||
    value.primarySubjectId !== value.event.aggregateId
  )
    throw new TypeError("Invalid information publication event");
  return value.primarySubjectId;
}
/** Public reads are no-store. The existing dispatcher records this typed, retry-safe observation; there is no CDN effect to pretend was performed. */
export const informationPagePublicationConsumer: OutboxConsumer = {
  effect(context) {
    return {
      effectKey: "INFORMATION_PAGE_PUBLICATION_OBSERVED",
      subjectId: validate(context),
    };
  },
  async dispatch(context) {
    validate(context);
  },
};
