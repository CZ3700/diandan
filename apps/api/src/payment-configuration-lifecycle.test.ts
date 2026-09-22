import { expect, test, vi } from "vitest";
const module = await import("./payment-configuration-lifecycle.js").catch(
  () => undefined,
);
test("configuration refresh starts before readiness, retries independently, and drains before closing", async () => {
  vi.useFakeTimers();
  const close = vi.fn(async () => undefined),
    refresh = vi.fn(async () => undefined);
  expect(module?.createPaymentConfigurationLifecycle).toBeTypeOf("function");
  const lifecycle = module!.createPaymentConfigurationLifecycle({
    refresh,
    close,
    delayMs: 1000,
  });
  try {
    await lifecycle.start();
    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockRejectedValueOnce(new Error("No database"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledTimes(2);
    let finish!: () => void;
    refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    const stop = lifecycle.stop();
    expect(close).not.toHaveBeenCalled();
    finish();
    await stop;
    await vi.advanceTimersByTimeAsync(30000);
    await lifecycle.stop();
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
test("the bounded schedule cannot exceed the propagation budget", () => {
  expect(module?.createPaymentConfigurationLifecycle).toBeTypeOf("function");
  for (const delayMs of [0, 999, 60000, Number.NaN])
    expect(() =>
      module!.createPaymentConfigurationLifecycle({
        refresh: async () => undefined,
        close: async () => undefined,
        delayMs,
      }),
    ).toThrow();
});
