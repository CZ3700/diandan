const NativeRequest = globalThis.Request;
const nativeUrl = Object.getOwnPropertyDescriptor(
  NativeRequest.prototype,
  "url",
).get;
const nativeHeaders = Object.getOwnPropertyDescriptor(
  NativeRequest.prototype,
  "headers",
).get;
globalThis.Request = class ObservedRequest extends NativeRequest {
  constructor(...args) {
    super(...args);
    const url = new globalThis.URL(nativeUrl.call(this));
    if (url.pathname === "/api/storefront/cart") {
      const headers = nativeHeaders.call(this);
      process.stdout.write(
        "SAFE_AUTHORITY " +
          JSON.stringify({
            origin: url.origin,
            host: headers.get("host"),
            forwardedHost: headers.get("x-forwarded-host"),
            forwardedProto: headers.get("x-forwarded-proto"),
          }) +
          "\n",
      );
    }
  }
};
