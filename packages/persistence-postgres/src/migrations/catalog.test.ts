import { describe, expect, test } from "vitest";

import {
  assertCatalogMatches,
  captureDatabaseCatalog,
  parseDatabaseCatalogSnapshot,
  type DatabaseCatalogSnapshot,
} from "./catalog.js";
import type { MigrationDatabaseSession } from "./runner.js";

const emptyCatalog: DatabaseCatalogSnapshot = {
  schemaVersion: 1,
  postgresMajorVersion: 18,
  extensions: [],
  types: [],
  enumValues: [],
  domainConstraints: [],
  tables: [],
  columns: [],
  constraints: [],
  indexes: [],
  triggers: [],
  functions: [],
};

class CatalogSession implements MigrationDatabaseSession {
  public async query(
    text: string,
  ): Promise<Readonly<{ rows: readonly unknown[] }>> {
    if (/\b(?:AS\s+constraint|constraint\.)\b/iu.test(text)) {
      throw new Error("reserved SQL alias");
    }
    const fixtures: Readonly<Record<string, readonly unknown[]>> = {
      "server-version": [{ server_version_num: "180006" }],
      extensions: [{ name: "btree_gist", version: "1.8" }],
      types: [
        {
          name: "minor_amount",
          kind: "DOMAIN",
          base_type: "bigint",
          not_null: false,
        },
      ],
      "enum-values": [],
      "domain-constraints": [
        {
          domain: "minor_amount",
          name: "minor_amount_check",
          definition: "CHECK ((VALUE >= 0))",
        },
      ],
      tables: [{ name: "orders", kind: "TABLE" }],
      columns: [
        {
          table: "orders",
          position: 1,
          name: "id",
          data_type: "uuid",
          not_null: true,
          default_expression: null,
          identity: "",
          generation: "",
        },
      ],
      constraints: [
        {
          table: "orders",
          name: "orders_pkey",
          kind: "PRIMARY_KEY",
          definition: "PRIMARY KEY (id)",
          deferrable: false,
          initially_deferred: false,
        },
      ],
      indexes: [
        {
          table: "orders",
          name: "orders_pkey",
          definition:
            "CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)",
          unique: true,
          primary: true,
          exclusion: false,
          valid: true,
        },
      ],
      triggers: [],
      functions: [],
    };
    const marker = Object.keys(fixtures).find((name) =>
      text.includes(`catalog:${name}`),
    );
    if (marker === undefined) {
      throw new Error("unexpected catalog query");
    }
    return { rows: fixtures[marker] ?? [] };
  }
}

class LogicalColumnPositionSession extends CatalogSession {
  public override async query(
    text: string,
  ): Promise<Readonly<{ rows: readonly unknown[] }>> {
    if (text.includes("catalog:columns")) {
      expect(text).toMatch(
        /row_number\(\) OVER \(\s*PARTITION BY relation\.oid\s+ORDER BY attribute\.attnum\s*\)::integer AS position/u,
      );
      expect(text).not.toContain("attribute.attnum::integer AS position");
    }
    return super.query(text);
  }
}

describe("assertCatalogMatches", () => {
  test("accepts an exact catalog snapshot", () => {
    expect(() =>
      assertCatalogMatches(emptyCatalog, emptyCatalog),
    ).not.toThrow();
  });

  test("reports the first structural path when the catalog drifts", () => {
    const actual: DatabaseCatalogSnapshot = {
      ...emptyCatalog,
      tables: [{ name: "orders", kind: "TABLE" }],
    };

    expect(() => assertCatalogMatches(actual, emptyCatalog)).toThrow(
      "database catalog drift at $.tables.length",
    );
  });

  test("rejects a malformed committed catalog before comparison", () => {
    expect(() =>
      parseDatabaseCatalogSnapshot({ schemaVersion: 1, tables: [] }),
    ).toThrow("catalog contract has an invalid shape");
  });
});

describe("captureDatabaseCatalog", () => {
  test("normalizes visible column positions across drop and re-add holes", async () => {
    await expect(
      captureDatabaseCatalog(new LogicalColumnPositionSession()),
    ).resolves.toBeDefined();
  });

  test("captures a normalized, reviewable public catalog", async () => {
    await expect(captureDatabaseCatalog(new CatalogSession())).resolves.toEqual(
      {
        ...emptyCatalog,
        extensions: [{ name: "btree_gist", version: "1.8" }],
        types: [
          {
            name: "minor_amount",
            kind: "DOMAIN",
            baseType: "bigint",
            notNull: false,
          },
        ],
        domainConstraints: [
          {
            domain: "minor_amount",
            name: "minor_amount_check",
            definition: "CHECK ((VALUE >= 0))",
          },
        ],
        tables: [{ name: "orders", kind: "TABLE" }],
        columns: [
          {
            table: "orders",
            position: 1,
            name: "id",
            dataType: "uuid",
            notNull: true,
            defaultExpression: null,
            identity: "",
            generation: "",
          },
        ],
        constraints: [
          {
            table: "orders",
            name: "orders_pkey",
            kind: "PRIMARY_KEY",
            definition: "PRIMARY KEY (id)",
            deferrable: false,
            initiallyDeferred: false,
          },
        ],
        indexes: [
          {
            table: "orders",
            name: "orders_pkey",
            definition:
              "CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)",
            unique: true,
            primary: true,
            exclusion: false,
            valid: true,
          },
        ],
      },
    );
  });
});
