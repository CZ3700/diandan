import { readFile } from "node:fs/promises";

import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import { describe, expect, test } from "vitest";

import * as schema from "./schema.js";
import {
  idempotencyRecords,
  inventoryBalances,
  inventoryItems,
  inventoryLedger,
  inventoryLocations,
  inventoryReservations,
  outboxEvents,
  paymentAttempts,
  webhookPayloads,
} from "./schema.js";

const repositoryTables = [
  idempotencyRecords,
  outboxEvents,
  inventoryLocations,
  inventoryItems,
  inventoryBalances,
  inventoryReservations,
  inventoryLedger,
  paymentAttempts,
  webhookPayloads,
] as const;

describe("repository Drizzle schema", () => {
  test("maps every authoritative column used by the repositories", async () => {
    const catalog = JSON.parse(
      await readFile(
        new URL(
          "../../../database/schema/expected-catalog.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Readonly<{
      columns: readonly Readonly<{
        table: string;
        position: number;
        name: string;
        notNull: boolean;
        defaultExpression: string | null;
      }>[];
    }>;

    for (const table of repositoryTables) {
      const tableName = getTableName(table);
      const expectedColumns = catalog.columns
        .filter((column) => column.table === tableName)
        .sort((left, right) => left.position - right.position)
        .map((column) => column.name);
      const mappedColumns = Object.values(getTableColumns(table)).map(
        (column) => column.name,
      );

      expect(mappedColumns, tableName).toEqual(expectedColumns);

      for (const column of Object.values(getTableColumns(table))) {
        const expected = catalog.columns.find(
          (candidate) =>
            candidate.table === tableName && candidate.name === column.name,
        );
        expect(expected, `${tableName}.${column.name}`).toBeDefined();
        expect(column.notNull, `${tableName}.${column.name} nullability`).toBe(
          expected?.notNull,
        );
        expect(
          column.hasDefault,
          `${tableName}.${column.name} default presence`,
        ).toBe(expected?.defaultExpression !== null);
      }
    }
  });

  test("maps payment encryption key versions as contract-compatible text", () => {
    const paymentAttempts = Reflect.get(schema, "paymentAttempts");
    const webhookPayloads = Reflect.get(schema, "webhookPayloads");

    expect(paymentAttempts).toBeDefined();
    expect(webhookPayloads).toBeDefined();

    const paymentColumns = getTableColumns(paymentAttempts as Table);
    const webhookColumns = getTableColumns(webhookPayloads as Table);
    expect(paymentColumns["actionKeyVersion"]?.getSQLType()).toBe("text");
    expect(webhookColumns["encryptionKeyVersion"]?.getSQLType()).toBe("text");
  });

  test("maps the minimal typed outbox payload needed for status replay", () => {
    const columns = getTableColumns(outboxEvents);

    expect(columns["payloadStatus"]?.getSQLType()).toBe("text");
    expect(columns["payloadStatus"]?.notNull).toBe(false);
  });
});
