import { expect, test, vi } from "vitest";
import type { MetricType } from "web-vitals";

test("disabled, sampled-out and token exchange documents download no collector", async () => {
  const loaded = await import("./rum-client").catch(() => undefined);
  expect(loaded, "RUM lifecycle adapter must exist").toBeDefined();
  if (!loaded) return;
  const load = vi.fn();
  const runtime = {
    documentIdentity: {},
    pathname: () => "/en",
    viewportWidth: () => 390,
    automated: false,
    random: () => 0.5,
    uuid: () => crypto.randomUUID(),
    load,
    send: vi.fn(),
  };
  for (const samplePermille of [0, 100])
    await loaded.startRum({ locale: "en", samplePermille }, runtime);
  await loaded.startRum(
    { locale: "en", samplePermille: 1000 },
    { ...runtime, documentIdentity: {}, pathname: () => "/en/order-access" },
  );
  expect(load).not.toHaveBeenCalled();
});

test("subscribes once and fixes hard-document context through route changes with ephemeral metric revisions", async () => {
  const { startRum } = await import("./rum-client");
  const callbacks: ((metric: MetricType) => void)[] = [];
  const on = (callback: (metric: MetricType) => void) => {
    callbacks.push(callback);
  };
  const load = vi.fn(async () => ({ onLCP: on, onINP: on, onCLS: on }));
  const send = vi.fn();
  let pathname = "/en/gifts/example";
  const runtime = {
    documentIdentity: {},
    pathname: () => pathname,
    viewportWidth: () => 390,
    automated: true,
    random: () => 0,
    uuid: () => crypto.randomUUID(),
    load,
    send,
  };
  await startRum({ locale: "en", samplePermille: 1000 }, runtime);
  await startRum({ locale: "en", samplePermille: 1000 }, runtime);
  expect(load).toHaveBeenCalledOnce();
  expect(callbacks).toHaveLength(3);
  const metric = {
    id: "raw-private-id",
    name: "LCP",
    value: 123,
    navigationType: "navigate",
    entries: [{ name: "private DOM" }],
    navigationURL: "https://private.invalid?token=PRIVATE",
  } as unknown as MetricType;
  callbacks[0]!(metric);
  pathname = "/th/cart";
  callbacks[0]!({ ...metric, value: 456 });
  pathname = "/en/gifts/example";
  callbacks[0]!({
    ...metric,
    id: "new-bfcache-id",
    navigationType: "back-forward-cache",
  });
  const first = send.mock.calls[0]![0];
  const second = send.mock.calls[1]![0];
  const third = send.mock.calls[2]![0];
  expect(first.context).toEqual({
    locale: "en",
    page: "gift",
    viewport: "mobile",
    automation: "automated",
  });
  expect(first.metric.measurementKey).toBe(second.metric.measurementKey);
  expect(second.metric.revision).toBe(2);
  expect(third.metric.measurementKey).not.toBe(first.metric.measurementKey);
  expect(JSON.stringify(send.mock.calls)).not.toMatch(
    /PRIVATE|private|raw-private-id|entries|navigationURL/u,
  );
  pathname = "/en/order-access";
  callbacks[0]!(metric);
  expect(send).toHaveBeenCalledTimes(3);
});

test("does not misattribute BFCache after a soft route has moved to another page", async () => {
  const { startRum } = await import("./rum-client");
  let callback: ((metric: MetricType) => void) | undefined;
  let pathname = "/en";
  const on = (report: (metric: MetricType) => void) => {
    callback = report;
  };
  const send = vi.fn();
  await startRum(
    { locale: "en", samplePermille: 1000 },
    {
      documentIdentity: {},
      pathname: () => pathname,
      viewportWidth: () => 390,
      automated: true,
      random: () => 0,
      uuid: () => crypto.randomUUID(),
      load: async () => ({ onLCP: on, onINP: on, onCLS: on }),
      send,
    },
  );
  pathname = "/th/gifts/example";
  callback!({
    id: "restored",
    name: "LCP",
    value: 250,
    navigationType: "back-forward-cache",
  } as MetricType);
  expect(send).not.toHaveBeenCalled();
});
