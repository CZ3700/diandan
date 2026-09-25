import { readPublicCatalog } from "../../../../server/public-catalog";
import type { IdolDirectoryResponse } from "@fan-support/contracts";
export const dynamic = "force-dynamic";
function responseStatus(result: IdolDirectoryResponse): number {
  if (result.outcome === "SUCCESS") return 200;
  switch (result.code) {
    case "CATALOG_UNAVAILABLE":
      return 503;
    case "CATALOG_CHANGED":
      return 409;
    case "ANCHOR_NOT_FOUND":
      return 404;
    default:
      return 400;
  }
}
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const result = await readPublicCatalog("/api/v1/idols", query, "directory");
  return Response.json(result, {
    status: responseStatus(result),
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
