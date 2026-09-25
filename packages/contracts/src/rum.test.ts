import { expect, test } from "vitest";

const sample = {
  schemaVersion: 1,
  metric: {
    name: "LCP",
    value: 1250,
    measurementKey: "b89eaa4c-36af-4b94-ad71-91266a8d6e40",
    revision: 1,
    navigationType: "navigate",
  },
  context: {
    locale: "en",
    page: "home",
    viewport: "mobile",
    automation: "browser",
  },
};

test("RUM has a strict standalone registered contract", async () => {
  const loaded = await import("./rum.js").catch(() => undefined);
  expect(
    loaded,
    "RUM schemas must exist before transport implementation",
  ).toBeDefined();
  if (!loaded) return;
  expect(loaded.rumIntakeSchema.parse(sample)).toEqual(sample);
  for (const payload of [
    { ...sample, url: "/en?email=PRIVATE" },
    { ...sample, context: { ...sample.context, orderId: "PRIVATE" } },
    { ...sample, metric: { ...sample.metric, entries: [] } },
    { ...sample, metric: { ...sample.metric, value: Infinity } },
    { ...sample, metric: { ...sample.metric, value: -1 } },
    { ...sample, metric: { ...sample.metric, name: "CLS", value: 101 } },
    { ...sample, metric: { ...sample.metric, measurementKey: "visitor-123" } },
    {
      ...sample,
      metric: { ...sample.metric, navigationType: "soft-navigation" },
    },
    { ...sample, context: { ...sample.context, locale: "fr" } },
  ])
    expect(loaded.rumIntakeSchema.safeParse(payload).success).toBe(false);
  const { contractArtifactRegistry } = await import("./artifact-registry.js");
  for (const name of ["RumIntake", "RumObservation", "RumReport"])
    expect(
      contractArtifactRegistry.find((entry) => entry.name === name),
    ).toMatchObject({ versionedRoot: true });
});
