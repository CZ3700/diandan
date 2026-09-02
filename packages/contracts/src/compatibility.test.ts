import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import { cartSchema } from "./commerce.js";
import { eventEnvelopeSchema, publicErrorEnvelopeSchema } from "./envelopes.js";
import { orderSchema } from "./order.js";
import { paymentAttemptSchema, providerEventSchema } from "./payment.js";

type GoldenSchema = Readonly<{
  parse: (value: unknown) => unknown;
  safeParse: (value: unknown) => Readonly<{ success: boolean }>;
}>;

async function readGoldenFixture(fileName: string): Promise<unknown> {
  const fixtureText = await readFile(
    new URL(`./fixtures/v1/${fileName}`, import.meta.url),
    "utf8",
  ).catch(() => undefined);

  expect(
    fixtureText,
    `${fileName} v1 golden fixture must be committed`,
  ).toBeDefined();
  return JSON.parse(fixtureText ?? "null") as unknown;
}

test.each([
  ["public-error-envelope.json", publicErrorEnvelopeSchema],
  ["cart.json", cartSchema],
  ["order.json", orderSchema],
  ["payment-attempt.json", paymentAttemptSchema],
  ["provider-event.json", providerEventSchema],
  ["event-envelope.json", eventEnvelopeSchema],
] as const)(
  "continues to decode the committed %s v1 golden fixture",
  async (fileName, schema) => {
    const fixture = await readGoldenFixture(fileName);
    const parsed = (schema as GoldenSchema).parse(fixture);

    expect(JSON.parse(JSON.stringify(parsed))).toEqual(fixture);
    expect(
      (schema as GoldenSchema).safeParse({
        ...(fixture as Record<string, unknown>),
        schemaVersion: 2,
      }).success,
    ).toBe(false);
  },
);

test("keeps the public error golden fixture on its safe field allowlist", async () => {
  const fixture = await readGoldenFixture("public-error-envelope.json");
  expect(
    publicErrorEnvelopeSchema.safeParse({
      ...(fixture as Record<string, unknown>),
      providerMessage: "must never cross the public boundary",
    }).success,
  ).toBe(false);
});
