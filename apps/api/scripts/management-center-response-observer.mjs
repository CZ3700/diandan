/** Observes only the six management BFF endpoints; no body, URL or raw error is retained. */
export function createManagementResponseObserver({
  page,
  origin,
  keys,
  schema,
  accept,
  check,
  onFailure,
}) {
  const requests = new Map();
  const waiters = new Set();
  let started = 0,
    document = 0;
  const changed = () => {
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  const complete = (request, record) => {
    if (record.transportFinished && record.bodyFinished)
      requests.delete(request);
    changed();
  };
  function failure(record, stage, code) {
    onFailure({
      endpoint: record.key,
      request: record.sequence,
      method: record.method,
      status: record.status,
      stage,
      code,
      documentAtRequest: record.document,
      documentAtFailure: document,
      transportFinished: record.transportFinished,
    });
  }
  function requestStarted(request) {
    const url = new globalThis.URL(request.url());
    const key = url.pathname.slice("/api/admin/".length);
    if (
      url.origin !== origin ||
      url.pathname !== `/api/admin/${key}` ||
      !keys.has(key)
    )
      return;
    requests.set(request, {
      key,
      method: request.method(),
      sequence: ++started,
      document,
      status: null,
      transportFinished: false,
      bodyFinished: false,
    });
    changed();
  }
  function responseReceived(response) {
    const request = response.request(),
      record = requests.get(request);
    if (!record) return;
    record.status = response.status();
    if (!response.ok()) {
      record.bodyFinished = true;
      complete(request, record);
      return;
    }
    void (async () => {
      let stage = "BODY_READ";
      try {
        const bytes = await response.body();
        stage = "JSON_PARSE";
        const body = JSON.parse(bytes.toString("utf8"));
        stage = "SCHEMA";
        const parsed = schema.safeParse(body);
        check(
          parsed.success,
          `real management BFF ${record.key} response conforms to its schema`,
        );
        if (!parsed.success) throw new Error("SCHEMA_INVALID");
        stage = "APPLY";
        accept(parsed.data, record.key);
      } catch (error) {
        const code =
          stage === "SCHEMA"
            ? "SCHEMA_INVALID"
            : stage === "JSON_PARSE"
              ? "INVALID_JSON"
              : stage === "APPLY"
                ? "OBSERVER_CALLBACK_FAILED"
                : /No resource with given identifier|No data found for resource|Request content was evicted/u.test(
                      error?.message ?? "",
                    )
                  ? "BODY_UNAVAILABLE"
                  : /Target.*closed|has been closed/u.test(error?.message ?? "")
                    ? "TARGET_CLOSED"
                    : "BODY_READ_FAILED";
        failure(record, stage, code);
      } finally {
        record.bodyFinished = true;
        complete(request, record);
      }
    })();
  }
  function requestFinished(request) {
    const record = requests.get(request);
    if (!record) return;
    record.transportFinished = true;
    complete(request, record);
  }
  function requestFailed(request) {
    const record = requests.get(request);
    if (!record) return;
    record.transportFinished = true;
    failure(
      record,
      "TRANSPORT",
      request.failure()?.errorText === "net::ERR_ABORTED"
        ? "REQUEST_ABORTED"
        : "REQUEST_FAILED",
    );
    if (record.status === null) record.bodyFinished = true;
    complete(request, record);
  }
  const navigated = (frame) => {
    if (frame === page.mainFrame()) document += 1;
  };
  const listeners = {
    request: requestStarted,
    response: responseReceived,
    requestfinished: requestFinished,
    requestfailed: requestFailed,
    framenavigated: navigated,
  };
  for (const [event, listener] of Object.entries(listeners))
    page.on(event, listener);
  return {
    get started() {
      return started;
    },
    async settled(timeoutMs = 45_000) {
      const deadline = Date.now() + timeoutMs;
      while (requests.size > 0) {
        const remaining = deadline - Date.now();
        if (remaining <= 0)
          throw new Error("MANAGEMENT_OBSERVER_DRAIN_TIMEOUT");
        await new Promise((resolve, reject) => {
          const ready = () => {
            globalThis.clearTimeout(timer);
            waiters.delete(ready);
            resolve();
          };
          const timer = globalThis.setTimeout(() => {
            waiters.delete(ready);
            reject(new Error("MANAGEMENT_OBSERVER_DRAIN_TIMEOUT"));
          }, remaining);
          waiters.add(ready);
        });
      }
    },
    dispose() {
      for (const [event, listener] of Object.entries(listeners))
        page.off(event, listener);
      if (requests.size !== 0) throw new Error("MANAGEMENT_OBSERVER_UNSETTLED");
    },
  };
}
