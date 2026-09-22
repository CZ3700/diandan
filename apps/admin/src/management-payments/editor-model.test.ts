import { expect, test } from "vitest";
const model = await import("./editor-model").catch(() => undefined);
test("editor rejects absent health policy and does not infer country, market or currency from language", () => {
  expect(model?.readPaymentDocument).toBeTypeOf("function");
  const data = new FormData();
  data.set("c0.account", "10000000-0000-4000-8000-000000000001");
  data.set("c0.order", "0");
  data.set("c0.rollout", "25.25");
  expect(model!.readPaymentDocument(data, 1, []).success).toBe(false);
  for (const [key, value] of Object.entries({
    failureThreshold: "3",
    failureWindowMs: "60",
    openDurationMs: "30",
    probeLeaseMs: "5",
    probeRetryMs: "10",
  }))
    data.set(`c0.${key}`, value);
  const result = model!.readPaymentDocument(data, 1, []);
  expect(result.success).toBe(true);
  if (!result.success) return;
  expect(result.data.channels[0]).toMatchObject({
    rolloutBasisPoints: 2525,
    healthPolicy: { failureWindowMs: 60000 },
    translations: [],
  });
  expect(result.data.routes).toEqual([]);
});
test("editor preserves explicit scope, exact minor units and marks fresh translated text for server binding", () => {
  expect(model?.readPaymentDocument).toBeTypeOf("function");
  const data = new FormData();
  for (const [key, value] of Object.entries({
    account: "10000000-0000-4000-8000-000000000001",
    order: "0",
    rollout: "100",
    failureThreshold: "3",
    failureWindowMs: "60",
    openDurationMs: "30",
    probeLeaseMs: "5",
    probeRetryMs: "10",
    "en.name": "Card",
    "en.hint": "Hosted",
    "th.name": "บัตร",
    "th.hint": "ชำระเงิน",
  }))
    data.set(`c0.${key}`, value);
  for (const [key, value] of Object.entries({
    account: "10000000-0000-4000-8000-000000000001",
    method: "card",
    rollout: "25",
    priority: "0",
    minimum: "123",
    maximum: "456",
    countries: "th, JP",
    markets: "TH, JP",
    currencies: "usd, JPY",
  }))
    data.set(`r0.${key}`, value);
  const result = model!.readPaymentDocument(data, 1, ["rule-1"]);
  expect(result.success).toBe(true);
  if (!result.success) return;
  expect(result.data.routes[0]).toMatchObject({
    countries: ["TH", "JP"],
    currencies: ["USD", "JPY"],
    minimumAmountMinor: 123,
    maximumAmountMinor: 456,
  });
  expect(
    result.data.channels[0]?.translations[1]?.translatedFromSourceHash,
  ).toBeNull();
  data.set("r0.minimum", "1e2");
  expect(model!.readPaymentDocument(data, 1, ["rule-1"]).success).toBe(false);
});

test("deployed health durations keep exact millisecond precision through seconds fields", () => {
  expect(model?.secondsToMilliseconds).toBeTypeOf("function");
  expect(model!.secondsToMilliseconds("1.125")).toBe(1125);
  expect(model!.secondsToMilliseconds("0.001")).toBe(1);
  expect(Number.isNaN(model!.secondsToMilliseconds("1.0001"))).toBe(true);
});
