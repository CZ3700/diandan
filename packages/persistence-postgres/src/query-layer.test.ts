import { sql } from "drizzle-orm";
import type { NodePgClient } from "drizzle-orm/node-postgres";
import { describe, expect, test } from "vitest";

import { createPostgresQueryLayer } from "./query-layer.js";

describe("createPostgresQueryLayer", () => {
  test("executes Drizzle queries through the supplied transaction client", async () => {
    const calls: Array<Readonly<{ text: string; values: readonly unknown[] }>> =
      [];
    const client = {
      query: async (
        query: Readonly<{ text: string }>,
        values: readonly unknown[],
      ) => {
        calls.push({ text: query.text, values });
        return { rows: [{ transaction_marker: "same-client" }] };
      },
    } as unknown as NodePgClient;

    const database = createPostgresQueryLayer(client);
    const result = await database.execute(
      sql`select ${"same-client"}::text as transaction_marker`,
    );

    expect(result.rows).toEqual([{ transaction_marker: "same-client" }]);
    expect(calls).toEqual([
      {
        text: "select $1::text as transaction_marker",
        values: ["same-client"],
      },
    ]);
  });
});
