import {
  paymentConfigurationDiffInputSchema,
  paymentConfigurationDiffValueSchema,
  type PaymentConfigurationDiff,
  type PaymentConfigurationDiffResult,
} from "@fan-support/contracts";
function stable(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(stable).sort());
  if (value !== null && typeof value === "object")
    return JSON.stringify(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  return JSON.stringify(value);
}
function values(
  fields: readonly PaymentConfigurationDiff["fields"][number][],
  before: object | undefined,
  after: object | undefined,
) {
  return fields.map((field) => ({
    field,
    before: paymentConfigurationDiffValueSchema.parse(
      (before as Record<string, unknown> | undefined)?.[field] ?? null,
    ),
    after: paymentConfigurationDiffValueSchema.parse(
      (after as Record<string, unknown> | undefined)?.[field] ?? null,
    ),
  }));
}
/** Compare operator-visible values only; array ordering does not invent changes. */
export function diffPaymentConfiguration(
  raw: unknown,
): PaymentConfigurationDiffResult {
  const input = paymentConfigurationDiffInputSchema.parse(raw);
  const diff: PaymentConfigurationDiff[] = [];
  const sets = [
    {
      kind: "CHANNEL",
      before: input.before?.channels ?? [],
      after: input.after.channels,
      key: "providerAccountId",
      fields: [
        "enabled",
        "displayOrder",
        "rolloutBasisPoints",
        "healthPolicy",
        "translations",
      ],
    },
    {
      kind: "ROUTE",
      before: input.before?.routes ?? [],
      after: input.after.routes,
      key: "ruleKey",
      fields: [
        "providerAccountId",
        "paymentMethod",
        "enabled",
        "countries",
        "markets",
        "currencies",
        "minimumAmountMinor",
        "maximumAmountMinor",
        "requiredDeviceCapabilities",
        "priority",
        "rolloutBasisPoints",
      ],
    },
  ] as const;
  for (const set of sets) {
    const keyOf = (row: object) =>
      String((row as Record<string, unknown>)[set.key]);
    const old = new Map(set.before.map((row) => [keyOf(row), row]));
    const next = new Map(set.after.map((row) => [keyOf(row), row]));
    for (const key of [...new Set([...old.keys(), ...next.keys()])].sort()) {
      const before = old.get(key);
      const after = next.get(key);
      if (!before || !after) {
        diff.push({
          kind: set.kind,
          key,
          change: before ? "REMOVED" : "ADDED",
          fields: [...set.fields],
          values: values(set.fields, before, after),
        });
        continue;
      }
      const fields = set.fields.filter(
        (field) =>
          stable((before as Record<string, unknown>)[field]) !==
          stable((after as Record<string, unknown>)[field]),
      );
      if (fields.length)
        diff.push({
          kind: set.kind,
          key,
          change: "CHANGED",
          fields,
          values: values(fields, before, after),
        });
    }
  }
  return { schemaVersion: 1, diff };
}
