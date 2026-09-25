import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { request } from "node:http";

const businessTables = [
  "carts",
  "cart_items",
  "support_intents",
  "checkout_sessions",
  "orders",
  "order_items",
  "order_events",
  "policy_acceptances",
  "payment_attempts",
  "payment_attempt_events",
  "payment_transactions",
  "provider_events",
  "inventory_reservations",
  "inventory_balances",
  "inventory_ledger",
  "fulfillments",
  "fulfillment_events",
  "notification_deliveries",
  "outbox_events",
];

/** Read-only fingerprints exclude access logs/counters while detecting any financial or notification mutation. */
export async function captureOrderAccessBusinessState(client, psp) {
  const tables = {};
  for (const table of businessTables) {
    const result = await client.query(
      `SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) AS rows FROM public.${table} row`,
    );
    const rows = result.rows[0].rows;
    tables[table] = {
      count: rows.length,
      sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
  return { tables, psp: await psp.counts() };
}

/** Raw header arrays preserve duplicated header fields for a real HTTP parser rejection test. */
export async function requestRawOrderAccess(
  base,
  path,
  { method = "POST", headers = [], body = "" } = {},
) {
  return new Promise((resolve, reject) => {
    const url = new globalThis.URL(path, base);
    const names = headers
      .filter((_value, index) => index % 2 === 0)
      .map((name) => name.toLowerCase());
    const framedHeaders = [
      ...headers,
      ...(names.includes("host") ? [] : ["Host", url.host]),
      ...(names.includes("content-length") ||
      names.includes("transfer-encoding")
        ? []
        : ["Content-Length", String(Buffer.byteLength(body))]),
    ];
    const pending = request(
      url,
      { method, headers: framedHeaders, timeout: 10000 },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1_048_576)
            pending.destroy(new Error("Bounded TEST order response"));
          else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    pending.on("timeout", () =>
      pending.destroy(new Error("TEST order request timeout")),
    );
    pending.on("error", reject);
    pending.end(body);
  });
}
