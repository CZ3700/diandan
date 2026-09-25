import { describe, expect, test } from "vitest";
import { createPostgresPersistenceWithPoolFactory } from "./postgres-persistence.js";

describe("exception recovery persistence", () => {
  test("exposes a transactional exception repository without a public media dependency", async () => {
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
        connect: async () => {
          throw new Error("unused");
        },
        end: async () => {},
        on: () => {},
        off: () => {},
      }),
    );
    try {
      expect(
        (persistence as unknown as Record<string, unknown>)[
          "adminExceptionsTransactionManager"
        ],
      ).toBeDefined();
    } finally {
      await persistence.close();
    }
  });
});
