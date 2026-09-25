import { channel } from "node:diagnostics_channel";

const prefix = "STOREFRONT_TEST_FETCH_DIAGNOSTIC ";
const maxRequests = 256;
const maxRecords = 768;
const transportCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const errorNames = new Set([
  "Error",
  "TypeError",
  "AbortError",
  "TimeoutError",
  "SocketError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
]);
const nativeDomExceptionName = Object.getOwnPropertyDescriptor(
  globalThis.DOMException.prototype,
  "name",
).get;

function data(object, key) {
  if (!object || typeof object !== "object") return undefined;
  return Object.getOwnPropertyDescriptor(object, key)?.value;
}

function describeError(error) {
  let errorName = "UNKNOWN";
  // The captured native getter checks DOMException's internal brand; it never invokes an input getter.
  try {
    const name = nativeDomExceptionName.call(error);
    if (errorNames.has(name)) errorName = name;
  } catch {
    /* Ordinary Errors do not have DOMException's internal slots. */
  }
  let ancestor = error;
  for (
    let depth = 0;
    errorName === "UNKNOWN" && ancestor && depth < 3;
    depth++
  ) {
    const name = data(ancestor, "name");
    if (errorNames.has(name)) {
      errorName = name;
      break;
    }
    ancestor = Object.getPrototypeOf(ancestor);
  }
  let transportCode;
  for (let depth = 0; error && depth < 3; depth++) {
    const code = data(error, "code");
    if (transportCodes.has(code)) {
      transportCode = code;
      break;
    }
    error = data(error, "cause");
  }
  return { errorName, ...(transportCode ? { transportCode } : {}) };
}

/** TEST-only native observation. Never replaces fetch, reads a body or retries a request. */
export function installStorefrontTestFetchDiagnostics({
  environment = process.env,
  write = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const inactive = () => undefined;
  if (
    environment.STOREFRONT_TEST_FETCH_DIAGNOSTICS !== "1" ||
    environment.FAN_SUPPORT_DEPLOYMENT_ENV !== "test"
  )
    return inactive;
  let origin;
  try {
    const url = new globalThis.URL(
      environment.STOREFRONT_TEST_FETCH_DIAGNOSTICS_ORIGIN,
    );
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return inactive;
    origin = url.origin;
  } catch {
    return inactive;
  }
  const requests = new WeakMap();
  const subscriptions = [];
  let requestSequence = 0;
  let sequence = 0;
  let truncated = false;
  function stop() {
    for (const [source, listener] of subscriptions)
      source.unsubscribe(listener);
  }
  function emit(record) {
    if (truncated) return;
    if (sequence >= maxRecords || requestSequence > maxRequests) {
      truncated = true;
      stop();
      write(
        `${prefix}${JSON.stringify({ schemaVersion: 1, observedAt: new Date().toISOString(), sequence: ++sequence, stage: "TRUNCATED" })}`,
      );
      return;
    }
    write(
      `${prefix}${JSON.stringify({ schemaVersion: 1, observedAt: new Date().toISOString(), sequence: ++sequence, ...record })}`,
    );
  }
  function record(state, stage, extra = {}) {
    emit({
      requestSequence: state.sequence,
      target: state.target,
      stage,
      durationMs: Math.max(
        0,
        Math.round(globalThis.performance.now() - state.started),
      ),
      ...extra,
    });
  }
  function subscribe(name, handle) {
    const source = channel(`undici:request:${name}`);
    const listener = (event) => {
      try {
        handle(event);
      } catch {
        /* Optional diagnostics cannot affect Undici delivery. */
      }
    };
    source.subscribe(listener);
    subscriptions.push([source, listener]);
  }
  subscribe("create", ({ request }) => {
    if (data(request, "method") !== "GET" || data(request, "origin") !== origin)
      return;
    const pathname = data(request, "path")?.split("?", 1)[0];
    const target =
      pathname === "/api/v1/storefront-homepage"
        ? "HOMEPAGE"
        : /^\/api\/v1\/idols\/[^/]+$/u.test(pathname)
          ? "IDOL"
          : /^\/api\/v1\/gift-content\/[^/]+$/u.test(pathname)
            ? "GIFT_CONTENT"
            : /^\/api\/v1\/storefront-gifts\/[^/]+$/u.test(pathname)
              ? "STOREFRONT_GIFT"
              : null;
    if (!target) return;
    const state = {
      sequence: ++requestSequence,
      target,
      started: globalThis.performance.now(),
    };
    requests.set(request, state);
    record(state, "CREATE");
  });
  subscribe("headers", ({ request, response }) => {
    const state = requests.get(request);
    if (!state) return;
    const status = data(response, "statusCode");
    record(
      state,
      "HEADERS",
      Number.isInteger(status) && status >= 100 && status <= 599
        ? { status }
        : {},
    );
  });
  subscribe("trailers", ({ request }) => {
    const state = requests.get(request);
    if (!state) return;
    requests.delete(request);
    record(state, "COMPLETE");
  });
  subscribe("error", ({ request, error }) => {
    const state = requests.get(request);
    if (!state) return;
    requests.delete(request);
    record(state, "ERROR", describeError(error));
  });
  return stop;
}

installStorefrontTestFetchDiagnostics();
