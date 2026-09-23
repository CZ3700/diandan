import { afterEach, expect, test, vi } from "vitest";
import type { MetricType } from "web-vitals";

const subscription = vi.hoisted(() => ({
  report: undefined as ((metric: MetricType) => void) | undefined,
}));
vi.mock("web-vitals", () => ({
  onLCP: (report: (metric: MetricType) => void) => {
    subscription.report = report;
  },
  onINP: () => {},
  onCLS: () => {},
}));

afterEach(() => {
  subscription.report = undefined;
  vi.unstubAllGlobals();
});

async function sendMetric(fetch: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("document", {});
  vi.stubGlobal("window", {
    location: { pathname: "/en" },
    innerWidth: 390,
  });
  vi.stubGlobal("navigator", { webdriver: true });
  vi.stubGlobal("fetch", fetch);
  const { startBrowserRum } = await import("./rum-client");
  await startBrowserRum({ locale: "en", samplePermille: 1000 });
  expect(subscription.report).toBeTypeOf("function");
  subscription.report!({
    id: "transport-test-lcp",
    name: "LCP",
    value: 120,
    navigationType: "navigate",
    navigationId: 1,
    delta: 120,
    rating: "good",
    entries: [],
  } satisfies MetricType);
  // Let both successful and rejected fetch/body promises settle. Vitest rejects unhandled errors.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]![0]).toBe("/api/storefront/rum");
  expect(fetch.mock.calls[0]![1]).toMatchObject({
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
  });
}

test("consumes the empty 204 acknowledgement without changing the private single request", async () => {
  const consume = vi.fn(async () => new ArrayBuffer(0));
  const fetch = vi.fn(async () => ({ status: 204, arrayBuffer: consume }));
  await sendMetric(fetch);
  expect(consume).toHaveBeenCalledOnce();
});

test("an empty 204 body read failure is handled without a retry or unhandled rejection", async () => {
  const consume = vi.fn(async () => {
    throw new Error("TEST_BODY_FAILURE");
  });
  await sendMetric(vi.fn(async () => ({ status: 204, arrayBuffer: consume })));
  expect(consume).toHaveBeenCalledOnce();
});

test("does not read non-204 responses and handles network rejection without retrying", async () => {
  for (const status of [200, 400, 403, 429, 503]) {
    const consume = vi.fn(async () => {
      throw new Error("NON_204_BODY_MUST_NOT_BE_READ");
    });
    await sendMetric(vi.fn(async () => ({ status, arrayBuffer: consume })));
    expect(consume).not.toHaveBeenCalled();
  }
  await sendMetric(
    vi.fn(async () => {
      throw new Error("TEST_NETWORK_FAILURE");
    }),
  );
});
