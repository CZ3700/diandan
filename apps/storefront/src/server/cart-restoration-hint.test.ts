import { beforeEach, expect, test, vi } from "vitest";

const request = vi.hoisted(() => ({
  has: vi.fn(),
  get: vi.fn(() => {
    throw new Error("Cookie credentials must not be read by the hint");
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => request,
}));

beforeEach(() => {
  request.has.mockReset();
  request.get.mockClear();
});

test.each([false, true])(
  "returns only cookie presence (%s), never reads or serializes credentials",
  async (present) => {
    request.has.mockReturnValue(present);
    const subject = await import("./cart-restoration-hint");
    const result = await subject.readCartRestorationHint();
    expect(result).toBe(present);
    expect(request.has).toHaveBeenCalledExactlyOnceWith("__Host-fan-cart");
    expect(request.get).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toBe(String(present));
  },
);

test("checks each request rather than retaining another visitor's presence", async () => {
  const subject = await import("./cart-restoration-hint");
  request.has.mockReturnValueOnce(true).mockReturnValueOnce(false);
  expect(await subject.readCartRestorationHint()).toBe(true);
  expect(await subject.readCartRestorationHint()).toBe(false);
});
