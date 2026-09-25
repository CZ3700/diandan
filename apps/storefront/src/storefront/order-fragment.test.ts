import { expect, it } from "vitest";
const load = () => import("./order-fragment").catch(() => null);
const id = "10000000-0000-4000-8000-000000000001";
const token = "A".repeat(43);
it("accepts only a single credential and non-authorizing order hint", async () => {
  const loaded = await load();
  expect(loaded?.parseOrderFragment).toBeTypeOf("function");
  if (!loaded) return;
  expect(loaded.parseOrderFragment(`#token=${token}&order=${id}`)).toEqual({
    token,
    publicOrderId: id,
  });
  for (const value of [
    null,
    "",
    `#token=${token}`,
    `#token=${token}&order=${id}&paid=true`,
    `#token=${token}&token=${token}&order=${id}`,
    `#token=${token}&order=x`,
    `#token=x&order=${id}`,
    `#token=${token}&order=${id}&order=${id}`,
  ])
    expect(loaded.parseOrderFragment(value)).toBeNull();
});
