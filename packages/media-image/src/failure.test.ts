import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessingBudget } from "./failure.js";

afterEach(() => vi.useRealTimers());

describe("processing deadlines", () => {
  it("bounds even a native operation queued beyond the whole 180 second lease budget", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const budget = new ProcessingBudget(15_000, 30);
    const work = budget.run(async () => new Promise(() => {}));
    const assertion = expect(work).rejects.toMatchObject({
      code: "PROCESSING_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(180_000);
    await assertion;
    let called = false;
    await expect(
      budget.request(async () => {
        called = true;
      }),
    ).rejects.toMatchObject({ code: "PROCESSING_TIMEOUT" });
    expect(called).toBe(false);
  });

  it("reduces native codec timeout to the remaining process time", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const budget = new ProcessingBudget(15_000, 30);
    expect(budget.codecSeconds()).toBe(30);
    vi.advanceTimersByTime(179_000);
    expect(budget.codecSeconds()).toBe(1);
  });
});
