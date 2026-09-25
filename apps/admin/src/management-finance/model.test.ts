import { expect, test } from "vitest";
const model = await import("./model").catch(() => undefined);
const first = "10000000-0000-4000-8000-000000000001";
const second = "10000000-0000-4000-8000-000000000002";
const items = [
  {
    orderItemId: first,
    position: 1,
    amountMinor: 900,
    occupiedAmountMinor: 200,
    availableAmountMinor: 700,
  },
  {
    orderItemId: second,
    position: 2,
    amountMinor: 900,
    occupiedAmountMinor: 0,
    availableAmountMinor: 900,
  },
];
test("full refunds allocate only the unoccupied amount of every item", () => {
  expect(model?.refundAllocation).toBeTypeOf("function");
  expect(model!.refundAllocation(items, "FULL", {}, "en", "USD", 1600)).toEqual(
    {
      amountMinor: 1600,
      allocations: [
        { orderItemId: first, amountMinor: 700 },
        { orderItemId: second, amountMinor: 900 },
      ],
    },
  );
});
test("partial refunds parse exact currency units and reject line or capture overflow", () => {
  expect(model?.refundAllocation).toBeTypeOf("function");
  expect(
    model!.refundAllocation(
      items,
      "PARTIAL",
      { [first]: "1,01", [second]: "" },
      "pt",
      "USD",
      1600,
    ),
  ).toEqual({
    amountMinor: 101,
    allocations: [{ orderItemId: first, amountMinor: 101 }],
  });
  for (const value of ["7.01", "-1", "0", "1.001", "Infinity", "1e2"])
    expect(
      model!.refundAllocation(
        items,
        "PARTIAL",
        { [first]: value },
        "en",
        "USD",
        1600,
      ),
    ).toBeNull();
  expect(
    model!.refundAllocation(items, "FULL", {}, "en", "USD", 1599),
  ).toBeNull();
  expect(
    model!.refundAllocation(
      items,
      "PARTIAL",
      { [first]: "1.01" },
      "pt",
      "USD",
      1600,
    ),
  ).toBeNull();
});
