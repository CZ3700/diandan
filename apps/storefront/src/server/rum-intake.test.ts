import { expect, test, vi } from "vitest";
import type { RumObservation } from "@fan-support/contracts/rum";
vi.mock("server-only", () => ({}));
const origin = "https://shop.example.invalid";
const environment = {
  NODE_ENV: "test",
  FAN_SUPPORT_DEPLOYMENT_ENV: "test",
  FAN_SUPPORT_SITE_ORIGIN: origin,
  FAN_SUPPORT_RUM_MODE: "local",
};
const sample = {
  schemaVersion: 1,
  metric: {
    name: "INP",
    value: 120,
    measurementKey: "b89eaa4c-36af-4b94-ad71-91266a8d6e40",
    revision: 1,
    navigationType: "navigate",
  },
  context: {
    locale: "en",
    page: "home",
    viewport: "mobile",
    automation: "automated",
  },
};
function request(
  body = JSON.stringify(sample),
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/storefront/rum`, {
    method: "POST",
    body,
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...headers,
    },
  });
}

test("RUM intake forwards only validated data and server-owned provenance", async () => {
  const loaded = await import("./rum-intake").catch(() => undefined);
  expect(loaded, "same-origin intake must exist").toBeDefined();
  if (!loaded) return;
  const records: RumObservation[] = [];
  const handle = loaded.createRumIntake({
    environment,
    sink: {
      async record(value) {
        records.push(value);
      },
    },
    now: () => new Date("2026-09-24T00:00:00.000Z"),
  });
  const response = await handle(
    request(undefined, {
      cookie: "private=never-forward",
      referer: `${origin}/en#private`,
    }),
  );
  expect(response.status).toBe(204);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(records).toEqual([
    {
      schemaVersion: 1,
      event: "performance.web_vital",
      mode: "local",
      samplePermille: 1000,
      receivedAt: "2026-09-24T00:00:00.000Z",
      measurement: sample,
    },
  ]);
});

test("RUM is disabled by default and rejects cross-origin, oversized and extra-field payloads", async () => {
  const { createRumIntake } = await import("./rum-intake");
  const sink = { record: vi.fn(async () => {}) };
  expect(
    (await createRumIntake({ environment: {}, sink })(request())).status,
  ).toBe(404);
  const handle = createRumIntake({ environment, sink });
  for (const incoming of [
    request(undefined, { origin: "https://evil.invalid" }),
    request(undefined, { "sec-fetch-site": "same-site" }),
  ])
    expect((await handle(incoming)).status).toBe(403);
  expect(
    (await handle(request(undefined, { "content-type": "text/plain" }))).status,
  ).toBe(415);
  expect((await handle(request(" ".repeat(3000)))).status).toBe(413);
  expect(
    (await handle(request(JSON.stringify({ ...sample, url: "PRIVATE" }))))
      .status,
  ).toBe(400);
  expect((await handle(request("{"))).status).toBe(400);
  expect(sink.record).not.toHaveBeenCalled();
});

test("sink failures cannot be acknowledged as success and admission capacity is bounded", async () => {
  const { createRumIntake } = await import("./rum-intake");
  const fail = createRumIntake({
    environment,
    sink: {
      async record() {
        throw new Error("PRIVATE");
      },
    },
  });
  const response = await fail(request());
  expect(response.status).toBe(503);
  expect(await response.text()).toBe("");
  const limited = createRumIntake({
    environment,
    capacityPerMinute: 1,
    sink: { async record() {} },
  });
  expect((await limited(request())).status).toBe(204);
  expect((await limited(request())).status).toBe(429);
});

test("a blocked sink times out without admitting more than sixteen unresolved writes", async () => {
  const { createRumIntake } = await import("./rum-intake");
  vi.useFakeTimers();
  try {
    const sink = { record: vi.fn(() => new Promise<void>(() => {})) };
    const handle = createRumIntake({ environment, sink });
    const pending = Array.from({ length: 16 }, () => handle(request()));
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.record).toHaveBeenCalledTimes(16);
    await vi.advanceTimersByTimeAsync(2001);
    expect(
      (await Promise.all(pending)).every((value) => value.status === 503),
    ).toBe(true);
    expect((await handle(request())).status).toBe(429);
    expect(sink.record).toHaveBeenCalledTimes(16);
  } finally {
    vi.useRealTimers();
  }
});

test("streamed over-limit bodies are canceled even without length and cancellation failure is private", async () => {
  const { createRumIntake } = await import("./rum-intake");
  const sink = { record: vi.fn(async () => {}) };
  let canceled = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2049));
    },
    cancel() {
      canceled++;
      return Promise.reject(new Error("PRIVATE"));
    },
  });
  const incoming = new Request(`${origin}/api/storefront/rum`, {
    method: "POST",
    body: stream,
    duplex: "half",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
  } as RequestInit);
  const response = await createRumIntake({ environment, sink })(incoming);
  expect(response.status).toBe(413);
  expect(await response.text()).toBe("");
  expect(canceled).toBe(1);
  expect(sink.record).not.toHaveBeenCalled();
});

test("slow body timeout frees its slot and does not call the sink", async () => {
  const { createRumIntake } = await import("./rum-intake");
  vi.useFakeTimers();
  try {
    const sink = { record: vi.fn(async () => {}) };
    const handle = createRumIntake({ environment, sink });
    let canceled = 0;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        canceled++;
      },
    });
    const incoming = new Request(`${origin}/api/storefront/rum`, {
      method: "POST",
      body: stream,
      duplex: "half",
      headers: {
        origin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
    } as RequestInit);
    const pending = handle(incoming);
    await vi.advanceTimersByTimeAsync(2001);
    expect((await pending).status).toBe(400);
    expect(canceled).toBe(1);
    expect(sink.record).not.toHaveBeenCalled();
    expect((await handle(request())).status).toBe(204);
  } finally {
    vi.useRealTimers();
  }
});

test("a complete JSON chunk without stream EOF still times out instead of becoming an accepted record", async () => {
  const { createRumIntake } = await import("./rum-intake");
  vi.useFakeTimers();
  try {
    const sink = { record: vi.fn(async () => {}) };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(sample)));
      },
    });
    const incoming = new Request(`${origin}/api/storefront/rum`, {
      method: "POST",
      body: stream,
      duplex: "half",
      headers: {
        origin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
    } as RequestInit);
    const pending = createRumIntake({ environment, sink })(incoming);
    await vi.advanceTimersByTimeAsync(2001);
    expect((await pending).status).toBe(400);
    expect(sink.record).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
