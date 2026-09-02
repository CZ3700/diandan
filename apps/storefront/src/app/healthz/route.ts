import { storefrontHealth } from "../../health";
import { loadStorefrontRuntimeConfig } from "../../server/runtime-config";

export const dynamic = "force-dynamic";

export function GET(): Response {
  loadStorefrontRuntimeConfig();

  return Response.json(storefrontHealth, {
    headers: { "cache-control": "no-store" },
  });
}
