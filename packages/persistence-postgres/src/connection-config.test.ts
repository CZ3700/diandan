import { describe, expect, test } from "vitest";
import { Client, type ClientConfig } from "pg";

import {
  isPostgresConnectionConfig,
  normalizePostgresConnectionConfig,
} from "./connection-config.js";

const completeConnectionString = [
  "postgresql://fan_support",
  ":fixture-password",
  "@database.internal:5432/fan_support",
].join("");

describe("PostgreSQL connection configuration", () => {
  test("requires an explicit complete connection identity", () => {
    expect(isPostgresConnectionConfig({})).toBe(false);
    expect(
      isPostgresConnectionConfig({
        host: "database.internal",
        port: 5432,
        database: "fan_support",
        user: "fan_support",
        password: "fixture-password",
      }),
    ).toBe(true);
    expect(
      isPostgresConnectionConfig({
        connectionString: completeConnectionString,
      }),
    ).toBe(true);
  });

  test.each([
    "postgresql://user:pass@db.example/app?host=%2Ftmp%2Fpg&user=evil",
    "postgresql://user:pass@db.example/app?sslmode=no-verify",
    "postgresql://user@db.example/app",
    "postgresql://user:pass@db.example/app",
  ])(
    "rejects ambient or query-overridden connection strings: %s",
    (connectionString) => {
      expect(isPostgresConnectionConfig({ connectionString })).toBe(false);
    },
  );

  test("copies a complete connection identity and overrides ambient pg settings", () => {
    expect(
      normalizePostgresConnectionConfig({
        connectionString: completeConnectionString,
      }),
    ).toEqual({
      host: "database.internal",
      port: 5432,
      database: "fan_support",
      user: "fan_support",
      password: "fixture-password",
      application_name: "fan-support-platform",
      connectionTimeoutMillis: 0,
      ssl: false,
      sslnegotiation: "postgres",
      options: "-c search_path=pg_catalog,public",
      client_encoding: "UTF8",
      replication: "false",
    });
  });

  test("rejects accessors instead of validating and later re-reading them", () => {
    let reads = 0;
    const config = Object.defineProperty({}, "connectionString", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1
          ? "postgresql://good:secret@db.example:5432/app"
          : "postgresql://evil:secret@%2Ftmp%2Fpg:5432/app";
      },
    });

    expect(normalizePostgresConnectionConfig(config)).toBeUndefined();
    expect(reads).toBe(0);
  });

  test("passes a copied mTLS key to node-postgres without freezing its driver object", () => {
    const sourceTls = {
      rejectUnauthorized: true,
      ca: "fixture-ca",
      cert: "fixture-cert",
      key: "fixture-key",
    };
    const normalized = normalizePostgresConnectionConfig({
      host: "database.internal",
      port: 5432,
      database: "fan_support",
      user: "fan_support",
      password: "fixture-password",
      ssl: sourceTls,
    });

    expect(normalized).toBeDefined();
    expect(normalized?.ssl).not.toBe(sourceTls);
    expect(() => new Client(normalized as ClientConfig)).not.toThrow();
  });

  test("keeps ambient PG settings out of the effective driver connection", () => {
    const ambientKeys = [
      "PGPORT",
      "PGSSLMODE",
      "PGOPTIONS",
      "PGAPPNAME",
      "PGCLIENTENCODING",
      "PGSSLNEGOTIATION",
      "PGREPLICATION",
    ] as const;
    const previous = new Map(
      ambientKeys.map((key) => [key, process.env[key]] as const),
    );
    Object.assign(process.env, {
      PGPORT: "6543",
      PGSSLMODE: "no-verify",
      PGOPTIONS: "-c search_path=evil",
      PGAPPNAME: "ambient-app",
      PGCLIENTENCODING: "LATIN1",
      PGSSLNEGOTIATION: "direct",
      PGREPLICATION: "database",
    });

    try {
      const normalized = normalizePostgresConnectionConfig({
        host: "database.internal",
        port: 5432,
        database: "fan_support",
        user: "fan_support",
        password: "fixture-password",
      });
      const client = new Client(normalized as ClientConfig);
      const parameters = (
        client as unknown as {
          connectionParameters: Readonly<Record<string, unknown>>;
        }
      ).connectionParameters;

      expect(parameters).toMatchObject({
        port: 5432,
        ssl: false,
        options: "-c search_path=pg_catalog,public",
        application_name: "fan-support-platform",
        client_encoding: "UTF8",
        sslnegotiation: "postgres",
        replication: "false",
      });
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
