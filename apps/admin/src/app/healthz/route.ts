import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@fan-support/observability";

import { adminHealth } from "../../health";
import { loadAdminRuntimeConfig } from "../../server/runtime-config";

export const dynamic = "force-dynamic";

export function GET(request?: Request): Response {
  loadAdminRuntimeConfig();
  const requestId = resolveRequestId(
    request?.headers.get(REQUEST_ID_HEADER) ?? undefined,
  );

  return Response.json(adminHealth, {
    headers: {
      "cache-control": "no-store",
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}
