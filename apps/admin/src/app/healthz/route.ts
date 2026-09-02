import { adminHealth } from "../../health";
import { loadAdminRuntimeConfig } from "../../server/runtime-config";

export const dynamic = "force-dynamic";

export function GET(): Response {
  loadAdminRuntimeConfig();

  return Response.json(adminHealth, {
    headers: { "cache-control": "no-store" },
  });
}
