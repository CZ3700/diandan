import { storefrontHealth } from "../../health";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(storefrontHealth, {
    headers: { "cache-control": "no-store" },
  });
}
