import { and, eq, sql, type SQL } from "drizzle-orm";
import type {
  AppendOutboxEventCommand,
  AppendOutboxEventResponse,
  OutboxRepository,
} from "@fan-support/persistence-port";

import type { PostgresQueryLayer } from "./query-layer.js";
import {
  parseRepositoryCommand,
  repositoryFailure,
  repositorySuccess,
} from "./repository-response.js";
import { runRepositoryOperation } from "./repository-savepoint.js";
import type { TransactionScopeControl } from "./transaction-runner.js";
import { outboxEvents } from "./schema.js";

type AggregateType =
  | "CART"
  | "CONTENT_PUBLICATION"
  | "ORDER"
  | "PAYMENT_ATTEMPT"
  | "REFUND"
  | "DISPUTE"
  | "FULFILLMENT"
  | "NOTIFICATION_DELIVERY"
  | "PAYMENT_CONFIG"
  | "PRICE_BOOK";

type CommerceContext = Readonly<{
  locale: string | null;
  market: string | null;
  currency: string | null;
  aggregateVersion: string;
  secondarySubjectId: string | null;
  payloadStatus?: string | null;
  priceBookRevision?: string | null;
  priceBookMarket?: string | null;
  priceBookCurrency?: string | null;
}>;

const aggregateTypes = {
  CART_ITEM_ADDED: "CART",
  CONTENT_PUBLICATION_CHANGED: "CONTENT_PUBLICATION",
  PAYMENT_STATUS_CHANGED: "PAYMENT_ATTEMPT",
  ORDER_PAYMENT_CONFIRMED: "ORDER",
  REFUND_STATUS_CHANGED: "REFUND",
  DISPUTE_STATUS_CHANGED: "DISPUTE",
  FULFILLMENT_STATUS_CHANGED: "FULFILLMENT",
  NOTIFICATION_REQUESTED: "NOTIFICATION_DELIVERY",
  PAYMENT_CONFIG_PUBLISHED: "PAYMENT_CONFIG",
  PRICE_BOOK_PUBLISHED: "PRICE_BOOK",
} as const satisfies Readonly<Record<string, AggregateType>>;

function expectedSubjects(command: AppendOutboxEventCommand): Readonly<{
  primary: string;
  secondary?: string;
}> {
  const { event } = command;
  switch (event.eventType) {
    case "CART_ITEM_ADDED":
      return {
        primary: event.payload.cartId,
        secondary: event.payload.cartItemId,
      };
    case "CONTENT_PUBLICATION_CHANGED":
      return { primary: event.payload.contentPublicationId };
    case "PAYMENT_STATUS_CHANGED":
      return {
        primary: event.payload.paymentAttemptId,
        secondary: event.payload.orderId,
      };
    case "ORDER_PAYMENT_CONFIRMED":
      return {
        primary: event.payload.orderId,
        secondary: event.payload.paymentAttemptId,
      };
    case "REFUND_STATUS_CHANGED":
      return {
        primary: event.payload.refundId,
        secondary: event.payload.orderId,
      };
    case "DISPUTE_STATUS_CHANGED":
      return {
        primary: event.payload.disputeId,
        secondary: event.payload.orderId,
      };
    case "FULFILLMENT_STATUS_CHANGED":
      return {
        primary: event.payload.fulfillmentId,
        secondary: event.payload.orderId,
      };
    case "NOTIFICATION_REQUESTED":
      return {
        primary: event.payload.notificationDeliveryId,
        secondary: event.payload.orderId,
      };
    case "PAYMENT_CONFIG_PUBLISHED":
      return { primary: event.payload.paymentConfigPublicationId };
    case "PRICE_BOOK_PUBLISHED":
      return {
        primary: event.payload.priceBookPublicationId,
        secondary: event.payload.priceBookId,
      };
  }
}

function commandSubjectsMatch(command: AppendOutboxEventCommand): boolean {
  const expected = expectedSubjects(command);
  if (command.primarySubjectId !== expected.primary) {
    return false;
  }
  if (command.event.eventType === "CONTENT_PUBLICATION_CHANGED") {
    return command.secondarySubjectId !== undefined;
  }
  if (expected.secondary === undefined) {
    return command.secondarySubjectId === undefined;
  }
  return command.secondarySubjectId === expected.secondary;
}

async function loadCommerceContext(
  database: PostgresQueryLayer,
  command: AppendOutboxEventCommand,
): Promise<CommerceContext | undefined> {
  const { event } = command;
  let result: Awaited<ReturnType<PostgresQueryLayer["execute"]>>;
  switch (event.eventType) {
    case "CART_ITEM_ADDED":
      result = await database.execute(sql`
        select cart.presentation_locale as locale, cart.market, cart.currency,
               cart.version::text as aggregate_version,
               item.id::text as secondary_subject_id
          from carts cart
          join cart_items item on item.cart_id = cart.id
         where cart.id = ${event.aggregateId}
           and item.id = ${event.payload.cartItemId}
      `);
      break;
    case "PAYMENT_STATUS_CHANGED":
      result = await database.execute(sql`
        select attempt.requested_locale as locale,
               source_order.market,
               attempt.currency,
               attempt.version::text as aggregate_version,
               attempt.order_id::text as secondary_subject_id,
               attempt.status as payload_status
          from payment_attempts attempt
          join orders source_order on source_order.id = attempt.order_id
         where attempt.id = ${event.aggregateId}
      `);
      break;
    case "ORDER_PAYMENT_CONFIRMED":
      result = await database.execute(sql`
        select source_order.presentation_locale as locale,
               source_order.market,
               source_order.currency,
               source_order.version::text as aggregate_version,
               attempt.id::text as secondary_subject_id
          from orders source_order
          join payment_attempts attempt
            on attempt.id = source_order.current_payment_attempt_id
           and attempt.order_id = source_order.id
         where source_order.id = ${event.aggregateId}
           and source_order.order_status = 'OPEN'
           and source_order.payment_status = 'PAID'
           and attempt.status = 'SUCCEEDED'
      `);
      break;
    case "REFUND_STATUS_CHANGED":
      result = await database.execute(sql`
        select source_order.presentation_locale as locale,
               source_order.market,
               refund.currency,
               refund.version::text as aggregate_version,
               refund.order_id::text as secondary_subject_id,
               refund.status as payload_status
          from refunds refund
          join orders source_order on source_order.id = refund.order_id
         where refund.id = ${event.aggregateId}
      `);
      break;
    case "DISPUTE_STATUS_CHANGED":
      result = await database.execute(sql`
        select source_order.presentation_locale as locale,
               source_order.market,
               dispute.currency,
               dispute.version::text as aggregate_version,
               dispute.order_id::text as secondary_subject_id,
               dispute.status as payload_status
          from disputes dispute
          join orders source_order on source_order.id = dispute.order_id
         where dispute.id = ${event.aggregateId}
      `);
      break;
    case "FULFILLMENT_STATUS_CHANGED":
      result = await database.execute(sql`
        select source_order.presentation_locale as locale,
               source_order.market,
               source_order.currency,
               fulfillment.version::text as aggregate_version,
               fulfillment.order_id::text as secondary_subject_id,
               fulfillment.status as payload_status
          from fulfillments fulfillment
          join orders source_order on source_order.id = fulfillment.order_id
         where fulfillment.id = ${event.aggregateId}
      `);
      break;
    case "NOTIFICATION_REQUESTED":
      result = await database.execute(sql`
        select delivery.resolved_locale as locale,
               source_order.market,
               source_order.currency,
               delivery.version::text as aggregate_version,
               delivery.order_id::text as secondary_subject_id
          from notification_deliveries delivery
          join orders source_order on source_order.id = delivery.order_id
         where delivery.id = ${event.aggregateId}
           and delivery.status = 'REQUESTED'
           and delivery.attempt_count = 0
      `);
      break;
    case "CONTENT_PUBLICATION_CHANGED":
      result = await database.execute(sql`
        select publication_locale.locale,
               null::text as market,
               null::text as currency,
               '1'::text as aggregate_version,
               coalesce(
                 idol_revision_id,
                 gift_revision_id,
                 homepage_revision_id,
                 policy_revision_id,
                 media_metadata_revision_id,
                 site_locale_config_revision_id
               )::text as secondary_subject_id
          from content_publications
          join lateral (
            select translation.locale::text as locale
              from idol_revision_translations translation
             where content_publications.content_type = 'IDOL'
               and translation.idol_revision_id = content_publications.idol_revision_id
            union all
            select translation.locale::text as locale
              from gift_revision_translations translation
             where content_publications.content_type = 'GIFT'
               and translation.gift_revision_id = content_publications.gift_revision_id
            union all
            select translation.locale::text as locale
              from homepage_revision_translations translation
             where content_publications.content_type = 'HOMEPAGE'
               and translation.homepage_revision_id = content_publications.homepage_revision_id
            union all
            select translation.locale::text as locale
              from policy_revision_translations translation
             where content_publications.content_type = 'POLICY'
               and translation.policy_revision_id = content_publications.policy_revision_id
            union all
            select translation.locale::text as locale
              from media_metadata_revision_translations translation
             where content_publications.content_type = 'MEDIA_METADATA'
               and translation.media_metadata_revision_id = content_publications.media_metadata_revision_id
            union all
            select entry.locale::text as locale
              from site_locale_config_entries entry
             where content_publications.content_type = 'SITE_LOCALE_CONFIG'
               and entry.site_locale_config_revision_id = content_publications.site_locale_config_revision_id
               and entry.enabled
          ) publication_locale on publication_locale.locale = ${event.locale}
         where id = ${event.aggregateId}
      `);
      break;
    case "PAYMENT_CONFIG_PUBLISHED":
      result = await database.execute(sql`
        select null::text as locale,
               null::text as market,
               null::text as currency,
               revision.version::text as aggregate_version,
               null::text as secondary_subject_id
          from payment_config_publications publication
          join config_versions revision
            on revision.id = publication.config_version_id
         where publication.id = ${event.payload.paymentConfigPublicationId}
           and publication.config_version_id = ${event.aggregateId}
      `);
      break;
    case "PRICE_BOOK_PUBLISHED":
      result = await database.execute(sql`
        select null::text as locale,
               publication.market,
               publication.currency,
               publication.price_book_revision::text as aggregate_version,
               publication.price_book_id::text as secondary_subject_id,
               publication.price_book_revision::text as price_book_revision,
               publication.market::text as price_book_market,
               publication.currency::text as price_book_currency
          from price_book_publications publication
         where publication.id = ${event.payload.priceBookPublicationId}
           and publication.price_book_id = ${event.aggregateId}
      `);
      break;
  }
  const row = result.rows[0] as
    | Readonly<{
        locale: string | null;
        market: string | null;
        currency: string | null;
        aggregate_version: string;
        secondary_subject_id: string | null;
        payload_status?: string | null;
        price_book_revision?: string | null;
        price_book_market?: string | null;
        price_book_currency?: string | null;
      }>
    | undefined;
  if (row === undefined || typeof row.aggregate_version !== "string") {
    return undefined;
  }
  return {
    locale: row.locale,
    market: row.market,
    currency: row.currency,
    aggregateVersion: row.aggregate_version,
    secondarySubjectId: row.secondary_subject_id,
    ...(row.payload_status === undefined
      ? {}
      : { payloadStatus: row.payload_status }),
    ...(row.price_book_revision === undefined
      ? {}
      : { priceBookRevision: row.price_book_revision }),
    ...(row.price_book_market === undefined
      ? {}
      : { priceBookMarket: row.price_book_market }),
    ...(row.price_book_currency === undefined
      ? {}
      : { priceBookCurrency: row.price_book_currency }),
  };
}

function commerceContextMatches(
  command: AppendOutboxEventCommand,
  context: CommerceContext,
): boolean {
  return (
    (command.market ?? null) === context.market &&
    (command.currency ?? null) === context.currency &&
    (command.secondarySubjectId ?? null) === context.secondarySubjectId &&
    (command.event.eventType !== "CONTENT_PUBLICATION_CHANGED" ||
      command.event.locale === context.locale)
  );
}

function eventPayloadMatchesAuthority(
  command: AppendOutboxEventCommand,
  context: CommerceContext,
): boolean {
  const { event } = command;
  switch (event.eventType) {
    case "PAYMENT_STATUS_CHANGED":
    case "REFUND_STATUS_CHANGED":
    case "DISPUTE_STATUS_CHANGED":
    case "FULFILLMENT_STATUS_CHANGED":
      return event.payload.status === context.payloadStatus;
    case "PRICE_BOOK_PUBLISHED":
      return (
        String(event.payload.priceBookRevision) === context.priceBookRevision &&
        event.payload.market === context.priceBookMarket &&
        event.payload.currency === context.priceBookCurrency
      );
    default:
      return true;
  }
}

function exactReplayPredicates(command: AppendOutboxEventCommand): SQL[] {
  const predicates: SQL[] = [
    eq(outboxEvents.idempotencyKey, command.idempotencyKey),
    eq(outboxEvents.id, command.event.eventId),
    eq(outboxEvents.eventType, command.event.eventType),
    eq(outboxEvents.aggregateType, aggregateTypes[command.event.eventType]),
    eq(outboxEvents.aggregateId, command.event.aggregateId),
    eq(outboxEvents.aggregateVersion, command.aggregateVersion),
    eq(outboxEvents.primarySubjectId, command.primarySubjectId),
    sql`${outboxEvents.secondarySubjectId} is not distinct from ${command.secondarySubjectId ?? null}`,
    sql`${outboxEvents.market} is not distinct from ${command.market ?? null}`,
    sql`${outboxEvents.currency} is not distinct from ${command.currency ?? null}`,
    eq(outboxEvents.correlationId, command.event.correlationId),
    sql`${outboxEvents.causationId} is not distinct from ${command.event.causationId ?? null}`,
    eq(outboxEvents.requestId, command.event.requestId),
    sql`${outboxEvents.traceId} is not distinct from ${command.event.traceId ?? null}`,
    eq(outboxEvents.occurredAt, command.event.occurredAt),
    eq(outboxEvents.availableAt, command.availableAt),
  ];

  if (command.event.eventType === "CONTENT_PUBLICATION_CHANGED") {
    predicates.push(eq(outboxEvents.locale, command.event.locale));
  } else if (
    command.event.eventType === "PAYMENT_CONFIG_PUBLISHED" ||
    command.event.eventType === "PRICE_BOOK_PUBLISHED"
  ) {
    predicates.push(sql`${outboxEvents.locale} is null`);
  }
  if (command.event.eventType === "PRICE_BOOK_PUBLISHED") {
    predicates.push(
      eq(
        outboxEvents.aggregateVersion,
        command.event.payload.priceBookRevision,
      ),
      eq(outboxEvents.market, command.event.payload.market),
      eq(outboxEvents.currency, command.event.payload.currency),
    );
  }
  return predicates;
}

async function statusPayloadMatchesEventHistory(
  database: PostgresQueryLayer,
  command: AppendOutboxEventCommand,
): Promise<boolean> {
  const { event } = command;
  let result: Awaited<ReturnType<PostgresQueryLayer["execute"]>>;
  switch (event.eventType) {
    case "PAYMENT_STATUS_CHANGED":
      result = await database.execute(sql`
        select exists (
          select 1
            from payment_attempt_events event
           where event.payment_attempt_id = ${event.aggregateId}
             and event.sequence = ${command.aggregateVersion}
             and event.to_status = ${event.payload.status}
        ) as matches
      `);
      break;
    case "REFUND_STATUS_CHANGED":
      result = await database.execute(sql`
        select exists (
          select 1
            from refund_events event
           where event.refund_id = ${event.aggregateId}
             and event.sequence = ${command.aggregateVersion}
             and event.to_status = ${event.payload.status}
        ) as matches
      `);
      break;
    case "DISPUTE_STATUS_CHANGED":
      result = await database.execute(sql`
        select exists (
          select 1
            from dispute_events event
           where event.dispute_id = ${event.aggregateId}
             and event.sequence = ${command.aggregateVersion}
             and event.to_status = ${event.payload.status}
        ) as matches
      `);
      break;
    case "FULFILLMENT_STATUS_CHANGED":
      result = await database.execute(sql`
        select exists (
          select 1
            from fulfillment_events event
           where event.fulfillment_id = ${event.aggregateId}
             and event.sequence = ${command.aggregateVersion}
             and event.to_status = ${event.payload.status}
        ) as matches
      `);
      break;
    default:
      return true;
  }
  return result.rows[0]?.["matches"] === true;
}

async function findReplay(
  database: PostgresQueryLayer,
  command: AppendOutboxEventCommand,
): Promise<"ABSENT" | "EXACT" | "CONFLICT"> {
  const [existing] = await database
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(eq(outboxEvents.idempotencyKey, command.idempotencyKey));
  if (existing === undefined) {
    return "ABSENT";
  }
  const [exact] = await database
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(and(...exactReplayPredicates(command)));
  if (exact === undefined) {
    return "CONFLICT";
  }
  return (await statusPayloadMatchesEventHistory(database, command))
    ? "EXACT"
    : "CONFLICT";
}

export function createOutboxRepository(
  database: PostgresQueryLayer,
  transactionScope: TransactionScopeControl,
): OutboxRepository {
  return {
    async append(command): Promise<AppendOutboxEventResponse> {
      const parsed = parseRepositoryCommand<
        "APPEND_OUTBOX_EVENT",
        AppendOutboxEventCommand
      >(command, "APPEND_OUTBOX_EVENT");
      if (parsed === undefined || !commandSubjectsMatch(parsed)) {
        const failure = repositoryFailure(
          "APPEND_OUTBOX_EVENT",
          "INVALID_COMMAND",
        );
        transactionScope.markRollbackOnly(failure);
        return failure;
      }

      return runRepositoryOperation(
        database,
        transactionScope,
        "APPEND_OUTBOX_EVENT",
        async () => {
          const replay = await findReplay(database, parsed);
          if (replay === "EXACT") {
            return repositorySuccess("APPEND_OUTBOX_EVENT", {
              eventId: parsed.event.eventId,
              appended: true,
            });
          }
          if (replay === "CONFLICT") {
            return repositoryFailure(
              "APPEND_OUTBOX_EVENT",
              "IDEMPOTENCY_CONFLICT",
            );
          }

          const context = await loadCommerceContext(database, parsed);
          if (context === undefined) {
            return repositoryFailure("APPEND_OUTBOX_EVENT", "NOT_FOUND");
          }
          if (!commerceContextMatches(parsed, context)) {
            return repositoryFailure("APPEND_OUTBOX_EVENT", "INVALID_COMMAND");
          }
          if (String(parsed.aggregateVersion) !== context.aggregateVersion) {
            return repositoryFailure("APPEND_OUTBOX_EVENT", "VERSION_CONFLICT");
          }
          if (!eventPayloadMatchesAuthority(parsed, context)) {
            return repositoryFailure("APPEND_OUTBOX_EVENT", "INVALID_COMMAND");
          }

          // Keep the writer compatible with schema 0008 while 0009 rolls out:
          // the database derives payload_status from immutable event history.
          const inserted = await database.execute(sql`
            insert into public.outbox_events (
              id, event_type, aggregate_type, aggregate_id, aggregate_version,
              primary_subject_id, secondary_subject_id, locale, market,
              currency, idempotency_key, correlation_id, causation_id,
              request_id, trace_id, occurred_at, available_at
            ) values (
              ${parsed.event.eventId}, ${parsed.event.eventType},
              ${aggregateTypes[parsed.event.eventType]},
              ${parsed.event.aggregateId}, ${parsed.aggregateVersion},
              ${parsed.primarySubjectId}, ${parsed.secondarySubjectId ?? null},
              ${context.locale}, ${context.market}, ${context.currency},
              ${parsed.idempotencyKey}, ${parsed.event.correlationId},
              ${parsed.event.causationId ?? null}, ${parsed.event.requestId},
              ${parsed.event.traceId ?? null}, ${parsed.event.occurredAt},
              ${parsed.availableAt}
            )
            on conflict (idempotency_key) do nothing
            returning id
          `);

          if (inserted.rows[0] !== undefined) {
            return repositorySuccess("APPEND_OUTBOX_EVENT", {
              eventId: parsed.event.eventId,
              appended: true,
            });
          }
          if ((await findReplay(database, parsed)) === "EXACT") {
            return repositorySuccess("APPEND_OUTBOX_EVENT", {
              eventId: parsed.event.eventId,
              appended: true,
            });
          }
          return repositoryFailure(
            "APPEND_OUTBOX_EVENT",
            "IDEMPOTENCY_CONFLICT",
          );
        },
      );
    },
  };
}
