import { describe, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createAdminPaymentConfigurationRepository } from "./admin-payment-configuration-repository.js";
import { createPostgresPersistenceWithPoolFactory } from "./postgres-persistence.js";
import type { TransactionClient } from "./transaction-runner.js";

describe("managed payment configuration storage boundary", () => {
  test("bounds a stalled pool acquisition and destroys its late client", async () => {
    vi.useFakeTimers();
    let resolve!: (client: TransactionClient) => void;
    const late = new Promise<TransactionClient>((done) => {
      resolve = done;
    });
    const persistence = createPostgresPersistenceWithPoolFactory(
      {
        host: "127.0.0.1",
        port: 5432,
        user: "test",
        password: "test-only",
        database: "test",
        ssl: false,
      },
      {},
      () => ({
        connect: () => late,
        end: async () => {},
        on: () => {},
        off: () => {},
      }),
    );
    let failed = false;
    const work = persistence.adminPaymentConfigurationTransactionManager
      .runInAdminPaymentConfigurationTransaction((repository) =>
        repository.readPublished(),
      )
      .catch(() => {
        failed = true;
      });
    try {
      await vi.advanceTimersByTimeAsync(10001);
      expect(failed).toBe(true);
    } finally {
      const raw = {
        query: vi.fn(async () => ({ rows: [], command: "COMMIT" })),
        release: vi.fn(),
      };
      resolve(raw);
      await work;
      await persistence.close();
      vi.useRealTimers();
      if (failed) {
        expect(raw.release).toHaveBeenCalledExactlyOnceWith(true);
        expect(raw.query).not.toHaveBeenCalled();
      }
    }
  });
  test("rejects unknown commands before querying", async () => {
    const repository = createAdminPaymentConfigurationRepository(
      {
        query: async () => {
          throw new Error("must not query");
        },
      } as never,
      { trackOperation: (work: () => Promise<unknown>) => work() } as never,
    );
    expect(await repository.execute({} as never)).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_COMMAND",
    });
  });
  test("adds immutable managed history and refuses destructive downgrade", async () => {
    const root = new URL("../../../database/migrations/", import.meta.url);
    const up = await readFile(
      new URL("0036_admin-payment-configuration.up.sql", root),
      "utf8",
    );
    const down = await readFile(
      new URL("0036_admin-payment-configuration.down.sql", root),
      "utf8",
    );
    for (const name of [
      "admin_payment_configuration_revisions",
      "admin_payment_configuration_receipts",
      "admin_payment_configuration_validations",
      "admin_payment_configuration_activations",
    ])
      expect(up).toContain(`CREATE TABLE public.${name}`);
    expect(up).toContain("admin_order_authorized");
    expect(up).toContain("guard_append_only");
    expect(down.indexOf("RAISE EXCEPTION")).toBeLessThan(
      down.indexOf("DROP TABLE"),
    );
  });
});
