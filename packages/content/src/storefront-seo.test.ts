import { expect, test } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { storefrontPublishedFixture } from "./storefront-homepage-fixtures.js";

test("SEO proves all seven locales against the same real publication and preserves publication lastmod", async () => {
  const seo = await import("./storefront-seo.js").catch(() => undefined);
  expect(seo, "the SEO proof projection must exist").toBeDefined();
  if (!seo) return;
  for (const kind of ["HOMEPAGE", "IDOL", "GIFT", "POLICY"] as const) {
    const fixture = storefrontPublishedFixture(kind);
    const result = seo.projectStorefrontSeoEntity(fixture);
    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") continue;
    expect(result.entity.locales.map((row) => row.locale)).toEqual(
      SUPPORTED_LOCALES,
    );
    expect(
      result.entity.locales.every(
        (row) => row.lastModified === fixture.publication.publishedAt,
      ),
    ).toBe(true);
    expect(result.entity.publication.id).toBe(
      fixture.publication.publicationId,
    );
    expect(JSON.stringify(result)).not.toMatch(
      /rightsReference|createdBy|objectKey|approvalId/u,
    );
  }
});

test("paused visible entities retain SEO while archive, missing translation and revoked rights fail closed", async () => {
  const seo = await import("./storefront-seo.js").catch(() => undefined);
  expect(seo).toBeDefined();
  if (!seo) return;
  const paused = storefrontPublishedFixture("IDOL");
  if (paused.canonical.candidate.objectKind !== "IDOL")
    throw new Error("fixture");
  paused.canonical.candidate.base.status = "paused";
  expect(seo.projectStorefrontSeoEntity(paused).outcome).toBe("SUCCESS");
  const archived = structuredClone(paused);
  if (archived.canonical.candidate.objectKind !== "IDOL")
    throw new Error("fixture");
  archived.canonical.candidate.base.status = "archived";
  const missing = storefrontPublishedFixture("GIFT");
  missing.canonical.snapshot.content.translations.pop();
  const rights = storefrontPublishedFixture("IDOL");
  if (rights.canonical.candidate.objectKind !== "IDOL")
    throw new Error("fixture");
  rights.canonical.candidate.mediaAssets[0]!.rightsStatus = "EXPIRED";
  const tampered = storefrontPublishedFixture("POLICY");
  tampered.publication.manifestHash = "0".repeat(64) as never;
  for (const value of [archived, missing, rights, tampered])
    expect(seo.projectStorefrontSeoEntity(value)).toMatchObject({
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
});

test("SEO cursors have canonical encoding, operation and version bindings without accepting arbitrary JSON", async () => {
  const seo = await import("./storefront-seo.js").catch(() => undefined);
  expect(seo).toBeDefined();
  if (!seo) return;
  const payload = {
    schemaVersion: 1,
    operation: "INDEX",
    catalogVersion: "a".repeat(64),
    afterKey: null,
  } as const;
  const cursor = seo.createStorefrontSeoCursor(payload);
  expect(seo.decodeStorefrontSeoCursor(cursor, "INDEX")).toEqual(payload);
  expect(seo.decodeStorefrontSeoCursor(cursor, "CATALOG")).toBeUndefined();
  for (const value of [
    cursor + "=",
    Buffer.from(JSON.stringify({ ...payload, secret: "private" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify(payload, null, 2)).toString("base64url"),
    "A",
  ])
    expect(seo.decodeStorefrontSeoCursor(value, "INDEX")).toBeUndefined();
});
