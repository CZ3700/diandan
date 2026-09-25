import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  supportedLocaleSchema,
  paymentRuntimeOriginSchema,
} from "@fan-support/contracts";

import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@fan-support/observability";

function checkoutPrivacy(response: NextResponse, pathname: string) {
  const orderPage = /^\/[^/]+\/(?:order-access|orders|thank-you)(?:\/|$)/u.test(
    pathname,
  );
  const orderApi = /^\/api\/storefront\/(?:order-access|orders)(?:\/|$)/u.test(
    pathname,
  );
  if (
    !orderPage &&
    !orderApi &&
    !/^\/(?:[^/]+\/checkout(?:\/|$)|api\/storefront\/checkout(?:\/|$)|api\/storefront\/cart\/validate(?:\/|$))/u.test(
      pathname,
    )
  )
    return response;
  let origins: string[] = [];
  try {
    const configured: unknown = JSON.parse(
      process.env["FAN_SUPPORT_PAYMENT_ACTION_ORIGINS_JSON"] ?? "[]",
    );
    if (
      !Array.isArray(configured) ||
      configured.length > 100 ||
      new Set(configured).size !== configured.length
    )
      throw new Error("Invalid payment action origins");
    origins = configured.map((value: unknown) =>
      paymentRuntimeOriginSchema.parse(value),
    );
  } catch {
    /* Fail closed: an invalid payment frame origin never broadens CSP. */
  }
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("x-robots-tag", "noindex, nofollow");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set(
    "content-security-policy",
    `${orderPage ? "script-src 'self' 'unsafe-inline'; connect-src 'self'; " : ""}frame-ancestors 'none'; frame-src ${!orderPage && !orderApi && origins.length ? origins.join(" ") : "'none'"}; object-src 'none'; base-uri 'self'; form-action 'self'`,
  );
  return response;
}

export function proxy(request: NextRequest): NextResponse {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  requestHeaders.delete("x-storefront-locale");
  requestHeaders.delete("x-storefront-order-access");
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
    return checkoutPrivacy(redirect, request.nextUrl.pathname);
  }
  if (locale && segment !== locale) {
    const destination = request.nextUrl.clone();
    destination.pathname = destination.pathname.replace(
      `/${segment}`,
      `/${locale}`,
    );
    const redirect = NextResponse.redirect(destination, 308);
    redirect.headers.set(REQUEST_ID_HEADER, requestId);
    return checkoutPrivacy(redirect, request.nextUrl.pathname);
  }
  if (locale) requestHeaders.set("x-storefront-locale", locale);
  if (locale && request.nextUrl.pathname === `/${locale}/order-access`)
    requestHeaders.set("x-storefront-order-access", "1");
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  if (locale) response.headers.set("content-language", locale);
  return checkoutPrivacy(response, request.nextUrl.pathname);
}
