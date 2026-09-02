import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@fan-support/observability";

import { storefrontHealth } from "../../health";
import { loadStorefrontRuntimeConfig } from "../../server/runtime-config";

export const dynamic = "force-dynamic";

export function GET(request?: Request): Response {
  loadStorefrontRuntimeConfig();
  const requestId = resolveRequestId(
    request?.headers.get(REQUEST_ID_HEADER) ?? undefined,
  );

  return Response.json(storefrontHealth, {
    headers: {
      "cache-control": "no-store",
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}
