import { describe, expect, test } from "vitest";
import {
  createIdolDirectoryCursor,
  decodeIdolDirectoryCursor,
  normalizeArtistSearchName,
  createIdolDiscoveryPlan,
} from "./index.js";
const query = { schemaVersion: 1, locale: "en", q: "ＭＩＲＡ", limit: 12 };
const id = "10000000-0000-4000-8000-000000000001";
const version = "a".repeat(64);
describe("directory cursor", () => {
  test("binds canonical search, locale and window but not the initial anchor", () => {
    const cursor = createIdolDirectoryCursor({
      schemaVersion: 1,
      query: { ...query, anchorId: id },
      catalogVersion: version,
      afterId: id,
    });
    const decoded = decodeIdolDirectoryCursor({
      schemaVersion: 1,
      query: { ...query, q: "mira", after: cursor },
      cursor,
    });
    expect(decoded).toMatchObject({
      schemaVersion: 1,
      catalogVersion: version,
      afterId: id,
    });
    for (const changed of [{ locale: "ja" }, { q: "other" }, { limit: 24 }]) {
      expect(
        decodeIdolDirectoryCursor({
          schemaVersion: 1,
          query: { ...query, ...changed },
          cursor,
        }),
      ).toBeUndefined();
    }
  });
  test("rejects malformed, noncanonical and oversized payloads without throwing", () => {
    const cursor = createIdolDirectoryCursor({
      schemaVersion: 1,
      query,
      catalogVersion: version,
      afterId: id,
    });
    const payload = Buffer.from(cursor, "base64url").toString("utf8");
    const alternates = [
      payload + " ",
      payload.replace("{", '{"schemaVersion":2,'),
      payload.replace('"schemaVersion":1', '"schemaVersion":2'),
    ];
    for (const bad of [
      "",
      cursor + "=",
      "%%%",
      "A".repeat(769),
      Buffer.from("{}").toString("base64url"),
      ...alternates.map((value) => Buffer.from(value).toString("base64url")),
    ]) {
      expect(
        decodeIdolDirectoryCursor({ schemaVersion: 1, query, cursor: bad }),
      ).toBeUndefined();
    }
  });
  test("uses identical Unicode normalization for persisted names and query fingerprints", () => {
    for (const name of ["İpek", "ＭＩＲＡ", "ฟ้า", "Cafe\u0301"]) {
      expect(normalizeArtistSearchName(name)).toBe(
        createIdolDiscoveryPlan({ ...query, q: name }).searchTerm,
      );
    }
  });
  test("normalizes valid published names containing surrounding and line whitespace", () => {
    expect(normalizeArtistSearchName(" Mira\n Vale ")).toBe("mira vale");
  });
});
