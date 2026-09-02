import { adminHealth } from "../../health";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(adminHealth, {
    headers: { "cache-control": "no-store" },
  });
}
