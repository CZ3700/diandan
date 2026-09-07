import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  supportedLocaleSchema,
} from "@fan-support/contracts";

import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@fan-support/observability";

export function proxy(request: NextRequest): NextResponse {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  requestHeaders.delete("x-storefront-locale");
  const segment = request.nextUrl.pathname.split("/")[1];
  const locale = SUPPORTED_LOCALES.find(
    (value) => value.toLowerCase() === segment?.toLowerCase(),
  );
  if (request.nextUrl.pathname === "/") {
    const cookie = supportedLocaleSchema.safeParse(
      request.cookies.get("site_locale")?.value,
    );
    const destination = request.nextUrl.clone();
    destination.pathname = `/${cookie.success ? cookie.data : DEFAULT_LOCALE}`;
    const redirect = NextResponse.redirect(destination, 307);
    redirect.headers.set("cache-control", "private, no-store");
    redirect.headers.set("x-robots-tag", "noindex");
    redirect.headers.set(REQUEST_ID_HEADER, requestId);
    return redirect;
  }
  if (locale && segment !== locale) {
    const destination = request.nextUrl.clone();
    destination.pathname = destination.pathname.replace(
      `/${segment}`,
      `/${locale}`,
    );
    const redirect = NextResponse.redirect(destination, 308);
    redirect.headers.set(REQUEST_ID_HEADER, requestId);
    return redirect;
  }
  if (locale) requestHeaders.set("x-storefront-locale", locale);
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  if (locale) response.headers.set("content-language", locale);
  return response;
}
