import type { EventEmitter } from "node:events";

import { expect, test, vi } from "vitest";

const pools = vi.hoisted(() => [] as EventEmitter[]);
vi.mock("pg", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class Pool extends Emitter {
    public constructor() {
      super();
      pools.push(this);
    }

    public async end(): Promise<void> {}
  }
  class Client extends Emitter {}
  return { Pool, Client, default: { Pool, Client } };
});

import { createPostgresPersistence } from "./postgres-persistence.js";

test("a server error on a connection the closed pool let go of does not crash the process", async () => {
  const persistence = createPostgresPersistence({
    host: "database.internal",
    port: 5432,
    database: "fan_support_test",
    user: "fan_support_test",
    password: "test-password",
  });
  const pool = pools.at(-1);
  expect(pool).toBeDefined();

  await persistence.close();

  const shutdown = Object.assign(
    new Error("terminating connection due to administrator command"),
    { code: "57P01" },
  );
  expect(() => pool?.emit("error", shutdown)).not.toThrow();
});
