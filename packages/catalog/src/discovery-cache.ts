import { createHash } from "node:crypto";

import {
  discoveryCacheInputSchema,
  type DiscoveryCacheKey,
} from "@fan-support/contracts";

import { createIdolDiscoveryPlan } from "./discovery.js";

/** Server-side cache partition; no raw query or opaque cursor enters the key. */
export function createDiscoveryCacheKey(input: unknown): DiscoveryCacheKey {
  const value = discoveryCacheInputSchema.parse(input);
  // Zod projects each strict object in declared key order and supplies defaults.
  const query =
    value.kind === "IDOLS"
      ? { ...value.query, q: createIdolDiscoveryPlan(value.query).searchTerm }
      : value.query;
  const canonical = JSON.stringify({
    kind: value.kind,
    catalogVersion: value.catalogVersion,
    query,
  });
  return {
    schemaVersion: 1,
    key: `catalog:v1:${createHash("sha256").update(canonical, "utf8").digest("hex")}`,
  };
}
