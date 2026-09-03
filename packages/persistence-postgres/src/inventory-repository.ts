import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type {
  ApplyInventoryReservationCreationCommand,
  ApplyInventoryReservationCreationResponse,
  ApplyInventoryReservationTransitionCommand,
  ApplyInventoryReservationTransitionResponse,
  InventoryRepository,
  LoadInventoryForUpdateCommand,
  LoadInventoryForUpdateResponse,
} from "@fan-support/persistence-port";

import type { PostgresQueryLayer } from "./query-layer.js";
import {
  parseRepositoryCommand,
  repositoryFailure,
  repositorySuccess,
} from "./repository-response.js";
import { runRepositoryOperation } from "./repository-savepoint.js";
import type { TransactionScopeControl } from "./transaction-runner.js";
import {
  inventoryBalances,
  inventoryItems,
  inventoryLedger,
  inventoryLocations,
  inventoryReservations,
} from "./schema.js";

type LockTarget = LoadInventoryForUpdateCommand["targets"][number];
type BalanceRow = Readonly<{
  inventoryItemId: string;
  inventoryLocationId: string;
  onHand: number;
  reserved: number;
  version: number;
}>;
type ItemRow = Readonly<{
  id: string;
  giftVariantId: string;
  sku: string;
  policy: "TRACKED" | "PROCURE_ON_DEMAND" | "PREORDER";
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
}>;
type LocationRow = Readonly<{
  id: string;
  code: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
}>;
type ReservationRow = typeof inventoryReservations.$inferSelect;
type LockedTarget = Readonly<{
  inventoryItem: ItemRow;
  inventoryLocation: LocationRow;
  balance: BalanceRow;
}>;

function targetKey(inventoryItemId: string, inventoryLocationId: string) {
  return `${inventoryItemId.toLowerCase()}:${inventoryLocationId.toLowerCase()}`;
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameTimestamp(left: string | Date, right: string): boolean {
  return new Date(left).getTime() === Date.parse(right);
}

function canonicalUuid<Value extends string>(value: Value): Value {
  return value.toLowerCase() as Value;
}

function canonicalTimestamp<Value extends string>(value: Value): Value {
  return new Date(value).toISOString() as Value;
}

function stableTargets(targets: readonly LockTarget[]): readonly LockTarget[] {
  return [...targets].sort((left, right) =>
    targetKey(left.inventoryItemId, left.inventoryLocationId).localeCompare(
      targetKey(right.inventoryItemId, right.inventoryLocationId),
    ),
  );
}

function mapReservation(row: ReservationRow) {
  return {
    schemaVersion: row.schemaVersion,
    id: row.id,
    checkoutQuoteId: row.checkoutQuoteId,
    cartItemId: row.cartItemId,
    giftVariantId: row.giftVariantId,
    inventoryLocationId: row.locationId,
    quantity: row.quantity,
    status: row.status,
    expiresAt: new Date(row.expiresAt).toISOString(),
    version: row.version,
  };
}

function mapLockedTarget(
  target: LockedTarget,
  reservation: ReservationRow | undefined,
) {
  return {
    inventoryItem: {
      schemaVersion: 1,
      ...target.inventoryItem,
    },
    inventoryLocation: {
      schemaVersion: 1,
      ...target.inventoryLocation,
    },
    balance: {
      schemaVersion: 1,
      ...target.balance,
    },
    reservation: reservation === undefined ? null : mapReservation(reservation),
  };
}

async function lockTargets(
  database: PostgresQueryLayer,
  targets: readonly LockTarget[],
): Promise<readonly LockedTarget[]> {
  const predicates = targets.map((target) =>
    and(
      eq(inventoryBalances.inventoryItemId, target.inventoryItemId),
      eq(inventoryBalances.locationId, target.inventoryLocationId),
    ),
  );
  return database
    .select({
      inventoryItem: {
        id: inventoryItems.id,
        giftVariantId: inventoryItems.giftVariantId,
        sku: inventoryItems.sku,
        policy: inventoryItems.policy,
        status: inventoryItems.status,
      },
      inventoryLocation: {
        id: inventoryLocations.id,
        code: inventoryLocations.locationKey,
        status: inventoryLocations.status,
      },
      balance: {
        inventoryItemId: inventoryBalances.inventoryItemId,
        inventoryLocationId: inventoryBalances.locationId,
        onHand: inventoryBalances.onHand,
        reserved: inventoryBalances.reserved,
        version: inventoryBalances.version,
      },
    })
    .from(inventoryBalances)
    .innerJoin(
      inventoryItems,
      eq(inventoryItems.id, inventoryBalances.inventoryItemId),
    )
    .innerJoin(
      inventoryLocations,
      eq(inventoryLocations.id, inventoryBalances.locationId),
    )
    .where(or(...predicates))
    .orderBy(
      asc(inventoryBalances.inventoryItemId),
      asc(inventoryBalances.locationId),
    )
    .for("update", {
      of: [inventoryBalances, inventoryItems, inventoryLocations],
    });
}

async function lockReservations(
  database: PostgresQueryLayer,
  targets: readonly LockTarget[],
): Promise<ReadonlyMap<string, ReservationRow>> {
  const reservationIds = targets.flatMap((target) =>
    target.reservationId === undefined ? [] : [target.reservationId],
  );
  if (reservationIds.length === 0) {
    return new Map();
  }
  const rows = await database
    .select()
    .from(inventoryReservations)
    .where(inArray(inventoryReservations.id, reservationIds))
    .orderBy(
      asc(inventoryReservations.inventoryItemId),
      asc(inventoryReservations.locationId),
      asc(inventoryReservations.id),
    )
    .for("update");
  return new Map(rows.map((row) => [row.id.toLowerCase(), row]));
}

function snapshotMatchesTarget(
  target: LockedTarget,
  decision:
    | ApplyInventoryReservationCreationCommand["decision"]
    | ApplyInventoryReservationTransitionCommand["decision"],
): boolean {
  return (
    sameUuid(target.inventoryItem.id, decision.inventoryItem.id) &&
    sameUuid(
      target.inventoryItem.giftVariantId,
      decision.inventoryItem.giftVariantId,
    ) &&
    target.inventoryItem.sku === decision.inventoryItem.sku &&
    target.inventoryItem.policy === decision.inventoryItem.policy &&
    target.inventoryItem.status === decision.inventoryItem.status &&
    target.balance.onHand === decision.previousBalance.onHand &&
    target.balance.reserved === decision.previousBalance.reserved &&
    target.balance.version === decision.expectedBalanceVersion
  );
}

function creationTargetIsUsable(target: LockedTarget): boolean {
  return (
    target.inventoryItem.policy === "TRACKED" &&
    target.inventoryItem.status === "ACTIVE" &&
    target.inventoryLocation.status === "ACTIVE"
  );
}

function reservationMatchesTransition(
  row: ReservationRow,
  command: ApplyInventoryReservationTransitionCommand,
): boolean {
  const { decision } = command;
  const previous = decision.previousReservation;
  return (
    sameUuid(row.id, decision.reservationId) &&
    sameUuid(row.inventoryItemId, decision.inventoryItemId) &&
    sameUuid(row.locationId, decision.inventoryLocationId) &&
    sameUuid(row.giftVariantId, previous.giftVariantId) &&
    sameUuid(row.checkoutQuoteId, previous.checkoutQuoteId) &&
    sameUuid(row.cartItemId, previous.cartItemId) &&
    row.quantity === previous.quantity &&
    row.status === previous.status &&
    row.version === decision.expectedReservationVersion &&
    sameTimestamp(row.expiresAt, previous.expiresAt)
  );
}

async function reservationHasExpired(
  database: PostgresQueryLayer,
  reservationId: string,
): Promise<boolean> {
  const result = await database.execute(sql`
    select transaction_timestamp() >= expires_at as expired
      from inventory_reservations
     where id = ${reservationId}
  `);
  const row = result.rows[0] as Readonly<{ expired: boolean }> | undefined;
  return row?.expired === true;
}

function ledgerActorColumns(
  actor: ApplyInventoryReservationCreationCommand["ledgerEntry"]["actor"],
) {
  switch (actor.kind) {
    case "ADMIN":
      return {
        actorKind: actor.kind,
        adminIdentityId: actor.adminIdentityId,
      } as const;
    case "SYSTEM":
      return { actorKind: actor.kind, taskName: actor.taskName } as const;
    case "IMPORT":
      return {
        actorKind: actor.kind,
        importBatchId: actor.importBatchId,
      } as const;
  }
}

async function insertLedger(
  database: PostgresQueryLayer,
  command:
    | ApplyInventoryReservationCreationCommand
    | ApplyInventoryReservationTransitionCommand,
  sourceType: "RESERVATION" | "PAYMENT" | "EXPIRY",
  sourceId: string,
): Promise<void> {
  const { decision, ledgerEntry } = command;
  await database.insert(inventoryLedger).values({
    id: ledgerEntry.id,
    inventoryItemId: ledgerEntry.inventoryItemId,
    locationId: ledgerEntry.inventoryLocationId,
    reservationId: decision.reservationId,
    balanceVersionBefore: decision.previousBalance.version,
    balanceVersionAfter: decision.nextBalance.version,
    deltaOnHand: ledgerEntry.deltaOnHand,
    deltaReserved: ledgerEntry.deltaReserved,
    reasonCode: ledgerEntry.reasonCode,
    sourceType,
    sourceId,
    idempotencyKey: ledgerEntry.idempotencyKey,
    ...ledgerActorColumns(ledgerEntry.actor),
    occurredAt: ledgerEntry.occurredAt,
  });
}

function inventoryWriteValue(
  command:
    | ApplyInventoryReservationCreationCommand
    | ApplyInventoryReservationTransitionCommand,
) {
  const balance = command.decision.nextBalance;
  const reservation = command.decision.nextReservation;
  const ledgerEntry = command.ledgerEntry;
  const actor =
    ledgerEntry.actor.kind === "ADMIN"
      ? {
          ...ledgerEntry.actor,
          adminIdentityId: canonicalUuid(ledgerEntry.actor.adminIdentityId),
        }
      : ledgerEntry.actor.kind === "IMPORT"
        ? {
            ...ledgerEntry.actor,
            importBatchId: canonicalUuid(ledgerEntry.actor.importBatchId),
          }
        : ledgerEntry.actor;
  return {
    balance: {
      ...balance,
      inventoryItemId: canonicalUuid(balance.inventoryItemId),
      inventoryLocationId: canonicalUuid(balance.inventoryLocationId),
    },
    reservation: {
      ...reservation,
      id: canonicalUuid(reservation.id),
      checkoutQuoteId: canonicalUuid(reservation.checkoutQuoteId),
      cartItemId: canonicalUuid(reservation.cartItemId),
      giftVariantId: canonicalUuid(reservation.giftVariantId),
      inventoryLocationId: canonicalUuid(reservation.inventoryLocationId),
      expiresAt: canonicalTimestamp(reservation.expiresAt),
    },
    ledgerEntry: {
      ...ledgerEntry,
      id: canonicalUuid(ledgerEntry.id),
      inventoryItemId: canonicalUuid(ledgerEntry.inventoryItemId),
      inventoryLocationId: canonicalUuid(ledgerEntry.inventoryLocationId),
      actor,
      occurredAt: canonicalTimestamp(ledgerEntry.occurredAt),
    },
  };
}

export function createInventoryRepository(
  database: PostgresQueryLayer,
  transactionScope: TransactionScopeControl,
): InventoryRepository {
  return {
    async loadManyForUpdate(command): Promise<LoadInventoryForUpdateResponse> {
      const parsed = parseRepositoryCommand<
        "LOAD_INVENTORY_FOR_UPDATE",
        LoadInventoryForUpdateCommand
      >(command, "LOAD_INVENTORY_FOR_UPDATE");
      if (parsed === undefined) {
        const failure = repositoryFailure(
          "LOAD_INVENTORY_FOR_UPDATE",
          "INVALID_COMMAND",
        );
        transactionScope.markRollbackOnly(failure);
        return failure;
      }
      return runRepositoryOperation(
        database,
        transactionScope,
        "LOAD_INVENTORY_FOR_UPDATE",
        async () => {
          const targets = stableTargets(parsed.targets);
          const locked = await lockTargets(database, targets);
          if (locked.length !== targets.length) {
            return repositoryFailure("LOAD_INVENTORY_FOR_UPDATE", "NOT_FOUND");
          }
          const lockedByTarget = new Map(
            locked.map((row) => [
              targetKey(
                row.balance.inventoryItemId,
                row.balance.inventoryLocationId,
              ),
              row,
            ]),
          );
          const reservations = await lockReservations(database, targets);
          const items = [];
          for (const target of targets) {
            const row = lockedByTarget.get(
              targetKey(target.inventoryItemId, target.inventoryLocationId),
            );
            if (row === undefined) {
              return repositoryFailure(
                "LOAD_INVENTORY_FOR_UPDATE",
                "NOT_FOUND",
              );
            }
            const reservation =
              target.reservationId === undefined
                ? undefined
                : reservations.get(target.reservationId.toLowerCase());
            if (
              target.reservationId !== undefined &&
              (reservation === undefined ||
                !sameUuid(
                  reservation.inventoryItemId,
                  target.inventoryItemId,
                ) ||
                !sameUuid(reservation.locationId, target.inventoryLocationId))
            ) {
              return repositoryFailure(
                "LOAD_INVENTORY_FOR_UPDATE",
                "NOT_FOUND",
              );
            }
            items.push(mapLockedTarget(row, reservation));
          }
          return repositorySuccess("LOAD_INVENTORY_FOR_UPDATE", { items });
        },
      );
    },

    async applyReservationCreation(
      command,
    ): Promise<ApplyInventoryReservationCreationResponse> {
      const parsed = parseRepositoryCommand<
        "APPLY_INVENTORY_RESERVATION_CREATION",
        ApplyInventoryReservationCreationCommand
      >(command, "APPLY_INVENTORY_RESERVATION_CREATION");
      if (parsed === undefined) {
        const failure = repositoryFailure(
          "APPLY_INVENTORY_RESERVATION_CREATION",
          "INVALID_COMMAND",
        );
        transactionScope.markRollbackOnly(failure);
        return failure;
      }
      return runRepositoryOperation(
        database,
        transactionScope,
        "APPLY_INVENTORY_RESERVATION_CREATION",
        async () => {
          const [target] = await lockTargets(database, [
            {
              inventoryItemId: parsed.decision.inventoryItemId,
              inventoryLocationId: parsed.decision.inventoryLocationId,
            },
          ]);
          if (target === undefined) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_CREATION",
              "NOT_FOUND",
            );
          }
          if (!snapshotMatchesTarget(target, parsed.decision)) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_CREATION",
              "VERSION_CONFLICT",
            );
          }
          if (!creationTargetIsUsable(target)) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_CREATION",
              "VERSION_CONFLICT",
            );
          }

          const orderResult = await database.execute(sql`
            select source_order.id::text as locked_order_id,
                   source_order.checkout_session_id::text as checkout_session_id,
                   source_order.cart_id::text as cart_id
              from orders source_order
              join checkout_sessions session
                on session.id = source_order.checkout_session_id
               and session.quote_id = source_order.checkout_quote_id
               and session.cart_id = source_order.cart_id
             where source_order.checkout_quote_id = ${parsed.decision.nextReservation.checkoutQuoteId}
             for key share of source_order, session
          `);
          const order = orderResult.rows[0] as
            | Readonly<{
                locked_order_id: string;
                checkout_session_id: string;
                cart_id: string;
              }>
            | undefined;
          if (order === undefined) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_CREATION",
              "NOT_FOUND",
            );
          }

          const canonicalLine = await database.execute(sql`
            select quote_line.id
              from checkout_quote_lines quote_line
              join cart_items cart_item
                on cart_item.id = quote_line.cart_item_id
               and cart_item.cart_id = ${order.cart_id}
               and cart_item.gift_variant_id = quote_line.gift_variant_id
               and cart_item.quantity = quote_line.quantity
             where quote_line.checkout_session_id = ${order.checkout_session_id}
               and quote_line.checkout_quote_id = ${parsed.decision.nextReservation.checkoutQuoteId}
               and quote_line.cart_item_id = ${parsed.decision.nextReservation.cartItemId}
               and quote_line.gift_variant_id = ${parsed.decision.nextReservation.giftVariantId}
               and quote_line.quantity = ${parsed.decision.nextReservation.quantity}
             for key share of quote_line, cart_item
          `);
          if (canonicalLine.rows.length !== 1) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_CREATION",
              "INTEGRITY_VIOLATION",
            );
          }

          const [updatedBalance] = await database
            .update(inventoryBalances)
            .set({
              onHand: parsed.decision.nextBalance.onHand,
              reserved: parsed.decision.nextBalance.reserved,
              version: parsed.decision.nextBalance.version,
              updatedAt: parsed.ledgerEntry.occurredAt,
            })
            .where(
              and(
                eq(
                  inventoryBalances.inventoryItemId,
                  parsed.decision.inventoryItemId,
                ),
                eq(
                  inventoryBalances.locationId,
                  parsed.decision.inventoryLocationId,
                ),
                eq(
                  inventoryBalances.version,
                  parsed.decision.expectedBalanceVersion,
                ),
                eq(
                  inventoryBalances.onHand,
                  parsed.decision.previousBalance.onHand,
                ),
                eq(
                  inventoryBalances.reserved,
                  parsed.decision.previousBalance.reserved,
                ),
              ),
            )
            .returning({ version: inventoryBalances.version });
          if (updatedBalance === undefined) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_CREATION",
              "VERSION_CONFLICT",
            );
          }

          const reservation = parsed.decision.nextReservation;
          await database.insert(inventoryReservations).values({
            id: reservation.id,
            inventoryItemId: parsed.decision.inventoryItemId,
            giftVariantId: reservation.giftVariantId,
            locationId: reservation.inventoryLocationId,
            checkoutSessionId: order.checkout_session_id,
            checkoutQuoteId: reservation.checkoutQuoteId,
            cartItemId: reservation.cartItemId,
            lockedOrderId: order.locked_order_id,
            quantity: reservation.quantity,
            status: "ACTIVE",
            version: reservation.version,
            expiresAt: reservation.expiresAt,
          });
          await insertLedger(database, parsed, "RESERVATION", reservation.id);
          return repositorySuccess(
            "APPLY_INVENTORY_RESERVATION_CREATION",
            inventoryWriteValue(parsed),
          );
        },
      );
    },

    async applyReservationTransition(
      command,
    ): Promise<ApplyInventoryReservationTransitionResponse> {
      const parsed = parseRepositoryCommand<
        "APPLY_INVENTORY_RESERVATION_TRANSITION",
        ApplyInventoryReservationTransitionCommand
      >(command, "APPLY_INVENTORY_RESERVATION_TRANSITION");
      if (parsed === undefined) {
        const failure = repositoryFailure(
          "APPLY_INVENTORY_RESERVATION_TRANSITION",
          "INVALID_COMMAND",
        );
        transactionScope.markRollbackOnly(failure);
        return failure;
      }
      return runRepositoryOperation(
        database,
        transactionScope,
        "APPLY_INVENTORY_RESERVATION_TRANSITION",
        async () => {
          const [target] = await lockTargets(database, [
            {
              inventoryItemId: parsed.decision.inventoryItemId,
              inventoryLocationId: parsed.decision.inventoryLocationId,
              reservationId: parsed.decision.reservationId,
            },
          ]);
          if (target === undefined) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_TRANSITION",
              "NOT_FOUND",
            );
          }
          const reservations = await lockReservations(database, [
            {
              inventoryItemId: parsed.decision.inventoryItemId,
              inventoryLocationId: parsed.decision.inventoryLocationId,
              reservationId: parsed.decision.reservationId,
            },
          ]);
          const reservation = reservations.get(
            parsed.decision.reservationId.toLowerCase(),
          );
          if (reservation === undefined) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_TRANSITION",
              "NOT_FOUND",
            );
          }
          if (
            !snapshotMatchesTarget(target, parsed.decision) ||
            !reservationMatchesTransition(reservation, parsed)
          ) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_TRANSITION",
              "VERSION_CONFLICT",
            );
          }

          const nextStatus = parsed.decision.nextReservation.status;
          if (
            nextStatus === "EXPIRED" &&
            !(await reservationHasExpired(database, reservation.id))
          ) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_TRANSITION",
              "VERSION_CONFLICT",
            );
          }

          const [updatedBalance] = await database
            .update(inventoryBalances)
            .set({
              onHand: parsed.decision.nextBalance.onHand,
              reserved: parsed.decision.nextBalance.reserved,
              version: parsed.decision.nextBalance.version,
              updatedAt: parsed.ledgerEntry.occurredAt,
            })
            .where(
              and(
                eq(
                  inventoryBalances.inventoryItemId,
                  parsed.decision.inventoryItemId,
                ),
                eq(
                  inventoryBalances.locationId,
                  parsed.decision.inventoryLocationId,
                ),
                eq(
                  inventoryBalances.version,
                  parsed.decision.expectedBalanceVersion,
                ),
              ),
            )
            .returning({ version: inventoryBalances.version });
          if (updatedBalance === undefined) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_TRANSITION",
              "VERSION_CONFLICT",
            );
          }

          const [updatedReservation] = await database
            .update(inventoryReservations)
            .set({
              status: nextStatus,
              version: parsed.decision.nextReservation.version,
              updatedAt: parsed.ledgerEntry.occurredAt,
              committedAt:
                nextStatus === "COMMITTED"
                  ? parsed.ledgerEntry.occurredAt
                  : null,
              releasedAt:
                nextStatus === "RELEASED"
                  ? parsed.ledgerEntry.occurredAt
                  : null,
              expiredAt:
                nextStatus === "EXPIRED" ? parsed.ledgerEntry.occurredAt : null,
            })
            .where(
              and(
                eq(inventoryReservations.id, parsed.decision.reservationId),
                eq(
                  inventoryReservations.version,
                  parsed.decision.expectedReservationVersion,
                ),
                eq(inventoryReservations.status, "ACTIVE"),
              ),
            )
            .returning({ id: inventoryReservations.id });
          if (updatedReservation === undefined) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_TRANSITION",
              "VERSION_CONFLICT",
            );
          }

          const sourceType = nextStatus === "EXPIRED" ? "EXPIRY" : "PAYMENT";
          const sourceId =
            nextStatus === "EXPIRED"
              ? reservation.id
              : reservation.lockedOrderId;
          if (sourceId === null) {
            return repositoryFailure(
              "APPLY_INVENTORY_RESERVATION_TRANSITION",
              "INTEGRITY_VIOLATION",
            );
          }
          await insertLedger(database, parsed, sourceType, sourceId);
          return repositorySuccess(
            "APPLY_INVENTORY_RESERVATION_TRANSITION",
            inventoryWriteValue(parsed),
          );
        },
      );
    },
  };
}
