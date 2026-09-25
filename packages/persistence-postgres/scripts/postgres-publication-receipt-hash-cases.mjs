import { createHash } from "node:crypto";
import {
  computeContentAuthoringSnapshotHash,
  serializePublicationManifest,
} from "@fan-support/content";

function canonical(value) {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
export async function verifyPublicationLegacyJson(client, check) {
  const numbers = [
    0, 1, -0, 0.00001, 0.99999, 0.5, 2147483647, 9007199254740991,
  ];
  let seed = 17;
  for (let index = 0; index < 128; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    numbers.push(Math.round((seed / 4294967296) * 100000) / 100000);
  }
  for (const number of numbers) {
    const value = {
      number,
      title: "中文 🎁 Cafe\u0301",
      ordered: ["pt", "en", "ja"],
      nested: { z: "e\u0301", a: true },
    };
    const [{ encoded }] = (
      await client.query(
        "SELECT public.publication_legacy_snapshot_json($1::jsonb) AS encoded",
        [JSON.stringify(value)],
      )
    ).rows;
    check(
      encoded,
      JSON.stringify(canonical(value)),
      "SQL legacy snapshot JSON preserves JS numeric, NFC and array order",
    );
  }
}
/** Uses the real canonical loader snapshot, not a second payload supplied to the SQL gate. */
export async function verifyPublicationReceiptHashes(
  client,
  manifest,
  snapshot,
  check,
) {
  const revision = JSON.parse(serializePublicationManifest(manifest)).revision;
  const [{ hash }] = (
    await client.query(
      "SELECT public.publication_snapshot_hash($1::jsonb,$2::jsonb) AS hash",
      [JSON.stringify(revision), JSON.stringify(snapshot.lifecycle)],
    )
  ).rows;
  check(
    hash,
    computeContentAuthoringSnapshotHash(snapshot),
    "SQL snapshot hash matches actual canonical loader and lifecycle",
  );
  const [{ zone }] = (
    await client.query("SELECT current_setting('TimeZone') AS zone")
  ).rows;
  try {
    await client.query("SELECT set_config('TimeZone','Asia/Shanghai',true)");
    const [{ hash: inShanghai }] = (
      await client.query(
        "SELECT public.publication_snapshot_hash($1::jsonb,$2::jsonb) AS hash",
        [JSON.stringify(revision), JSON.stringify(snapshot.lifecycle)],
      )
    ).rows;
    check(
      inShanghai,
      hash,
      "SQL snapshot hashing is independent of connection time zone",
    );
  } finally {
    await client.query("SELECT set_config('TimeZone',$1,true)", [zone]);
  }
}
/** Precisely replaces one hash in a real repository INSERT; no body, identity or timestamp is changed. */
export function tamperPublicationReceiptHash(sql, values, field) {
  if (
    !String(sql).startsWith("INSERT INTO public.content_publication_receipts(")
  )
    return values;
  if (field !== "expected" && field !== "result")
    throw new TypeError("unknown receipt hash field");
  const result = [...values];
  result[field === "expected" ? 8 : 10] = createHash("sha256")
    .update(`unrelated ${field} snapshot`)
    .digest("hex");
  return result;
}
export async function verifyPublicationReceiptHashFailures({
  client,
  write,
  withTamper,
  check,
}) {
  const counts = async () =>
    (
      await client.query(
        "SELECT (SELECT count(*)::integer FROM public.content_publication_receipts) receipts,(SELECT count(*)::integer FROM public.content_publication_manifests) manifests,(SELECT count(*)::integer FROM public.audit_logs) audits",
      )
    ).rows[0];
  for (const field of ["expected", "result", "offset", "head"]) {
    const before = await counts();
    let failure;
    try {
      await withTamper(field, write);
    } catch (error) {
      failure = error;
    }
    check(
      failure?.code,
      "INTEGRITY_VIOLATION",
      `forged receipt ${field} rejected by database proof`,
    );
    check(
      await counts(),
      before,
      "rejected receipt evidence rolls back audit, manifest and receipt",
    );
  }
}

/** Changes only the result hash to the same lifecycle instant encoded in an arbitrary connection offset. */
export async function tamperPublicationReceiptOffsetHash(client, sql, values) {
  if (
    !String(sql).startsWith(
      "INSERT INTO public.content_publication_receipts(",
    ) ||
    values[1] !== "VALIDATE"
  )
    return values;
  const [{ hash }] = (
    await client.query(
      "SELECT public.publication_snapshot_hash(manifest->'revision',jsonb_build_object('status','VALIDATED','validatedAt',to_char($1::timestamptz AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD\"T\"HH24:MI:SS.US')||'+08:00')) AS hash FROM public.content_publication_manifests WHERE id=$2",
      [values[11], values[5]],
    )
  ).rows;
  const result = [...values];
  result[10] = hash;
  return result;
}

/** Keeps both VALIDATE versions mutually consistent while breaking their binding to the actual head. */
export function tamperPublicationReceiptVersion(sql, values) {
  if (
    !String(sql).startsWith(
      "INSERT INTO public.content_publication_receipts(",
    ) ||
    values[1] !== "VALIDATE"
  )
    return values;
  const result = [...values];
  result[7] = Number(values[7]) + 7;
  result[9] = Number(values[9]) + 7;
  return result;
}
