import "server-only";
import { wishGalleryReadCommandSchema } from "@fan-support/contracts";
import { readWishGallery } from "./public-wish-gallery";
const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
function invalid() {
  return Response.json(
    { schemaVersion: 1, outcome: "FAILURE", code: "INVALID_REQUEST" },
    { status: 400, headers },
  );
}
/** The public projection receives no browser cookies, order token or checkout fields. */
export async function handleWishGalleryRequest(
  request: Request,
): Promise<Response> {
  if (
    request.method !== "GET" ||
    request.body !== null ||
    request.headers.has("transfer-encoding") ||
    (request.headers.has("content-length") &&
      request.headers.get("content-length") !== "0")
  )
    return invalid();
  const query: Record<string, unknown> = { schemaVersion: 1 };
  const seen = new Set<string>();
  for (const [key, value] of new URL(request.url).searchParams) {
    if (!["locale", "idol", "limit", "cursor"].includes(key) || seen.has(key))
      return invalid();
    seen.add(key);
    if (key === "limit") {
      if (!/^[1-9]\d?$/u.test(value)) return invalid();
      query[key] = Number(value);
    } else query[key === "idol" ? "idolId" : key] = value;
  }
  const command = wishGalleryReadCommandSchema.safeParse(query);
  if (!command.success) return invalid();
  const result = await readWishGallery(command.data);
  const status =
    result.outcome === "SUCCESS"
      ? 200
      : result.code === "INVALID_REQUEST"
        ? 400
        : result.code === "ACCESS_DENIED"
          ? 403
          : result.code === "RATE_LIMITED"
            ? 429
            : 503;
  return Response.json(result, { status, headers });
}
