import { Buffer } from "node:buffer";
import {
  SUPPORTED_LOCALES,
  storefrontSeoCursorSchema,
  storefrontSeoCursorPayloadSchema,
  storefrontSeoEntitySchema,
  type StorefrontSeoCursorPayload,
  type StorefrontSeoEntity,
  type StorefrontSeoFailure,
  type StorefrontSeoLocator,
} from "@fan-support/contracts";
import { projectPublishedContentLocales } from "./published-content.js";

export function createStorefrontSeoCursor(
  input: StorefrontSeoCursorPayload,
): string {
  return Buffer.from(
    JSON.stringify(storefrontSeoCursorPayloadSchema.parse(input)),
    "utf8",
  ).toString("base64url");
}
export function decodeStorefrontSeoCursor(
  input: string,
  operation: "INDEX" | "CATALOG",
): StorefrontSeoCursorPayload | undefined {
  try {
    const cursor = storefrontSeoCursorSchema.parse(input);
    const payload = storefrontSeoCursorPayloadSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return payload.operation === operation &&
      createStorefrontSeoCursor(payload) === cursor
      ? payload
      : undefined;
  } catch {
    return undefined;
  }
}
export function sameStorefrontSeoLocator(
  left: StorefrontSeoLocator,
  right: StorefrontSeoLocator,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "HOMEPAGE":
      return true;
    case "POLICY":
      return right.kind === "POLICY" && left.policyKey === right.policyKey;
    default:
      return (
        (right.kind === "IDOL" || right.kind === "GIFT") &&
        left.handle === right.handle
      );
  }
}

/** Reuses the unchanged publication/rights gate for all locales with one loaded database context. */
export function projectStorefrontSeoEntity(input: unknown):
  | Readonly<{
      schemaVersion: 1;
      outcome: "SUCCESS";
      kind: "STOREFRONT_SEO_ENTITY";
      entity: StorefrontSeoEntity;
    }>
  | StorefrontSeoFailure {
  try {
    const views = projectPublishedContentLocales(input);
    const first = views[0]!;
    if (first.outcome !== "SUCCESS" || first.content.kind === "MEDIA_METADATA")
      throw new Error("SEO publication unavailable");
    const content = first.content;
    const locator: StorefrontSeoLocator =
      content.kind === "HOMEPAGE"
        ? { kind: content.kind }
        : content.kind === "POLICY"
          ? { kind: content.kind, policyKey: content.view.policyKey }
          : { kind: content.kind, handle: content.view.handle };
    const locales = views.flatMap((view, index) => {
      const locale = SUPPORTED_LOCALES[index]!;
      if (
        view.outcome !== "SUCCESS" ||
        view.content.kind !== content.kind ||
        JSON.stringify(view.publication) !== JSON.stringify(first.publication)
      )
        throw new Error("SEO publication mismatch");
      const provenance = view.content.view.localeContext;
      if (provenance.schemaVersion === 2 && provenance.fallbackUsed) return [];
      if (
        provenance.requestedLocale !== locale ||
        provenance.resolvedLocale !== locale ||
        provenance.fallbackUsed ||
        !provenance.translationRevision
      )
        throw new Error("SEO locale unavailable");
      return [
        {
          locale,
          translationRevision: provenance.translationRevision,
          lastModified: view.publication.publishedAt,
        },
      ];
    });
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "STOREFRONT_SEO_ENTITY",
      entity: storefrontSeoEntitySchema.parse({
        schemaVersion: 1,
        locator,
        publication: first.publication,
        locales,
      }),
    };
  } catch {
    return {
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    };
  }
}
