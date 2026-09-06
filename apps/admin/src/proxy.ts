import { NextResponse, type NextRequest } from "next/server";
import { supportedLocaleSchema } from "@fan-support/contracts";

import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@fan-support/observability";

export function proxy(request: NextRequest): NextResponse {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  const locale = supportedLocaleSchema.safeParse(
    request.nextUrl.pathname.split("/")[1],
  );
  requestHeaders.set("x-admin-locale", locale.success ? locale.data : "en");

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  return response;
}
