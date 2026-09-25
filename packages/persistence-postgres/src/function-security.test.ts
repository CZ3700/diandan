import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");

test("pins a safe lookup path on every migration function", async () => {
  for (const file of [
    "0001_foundation-security.up.sql",
    "0002_content-catalog.up.sql",
    "0003_inventory-cart-private-data.up.sql",
    "0004_orders-fulfillment.up.sql",
    "0005_payments-reliable-events.up.sql",
    "0006_publication-heads-outbox.up.sql",
  ]) {
    const sql = await readFile(
      path.join(workspaceRoot, "database/migrations", file),
      "utf8",
    );
    const functions = sql.match(/CREATE FUNCTION[\s\S]*?\$\$;/gu) ?? [];
    expect(functions.length, `${file} must define functions`).toBeGreaterThan(
      0,
    );
    for (const functionSql of functions) {
      expect(functionSql).toMatch(
        /LANGUAGE plpgsql(?:\s+SECURITY INVOKER)?\s+SET search_path = pg_catalog, public, pg_temp\s+AS \$\$/u,
      );
    }
  }
});
