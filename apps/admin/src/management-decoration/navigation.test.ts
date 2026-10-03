import { expect, test, vi } from "vitest";
const subject = await import("./navigation").catch(() => undefined);
test("busy decoration cannot leave and dirty decoration needs explicit discard", () => {
  expect(subject?.canLeaveDecoration).toBeTypeOf("function");
  const confirm = vi.fn(() => false);
  expect(
    subject!.canLeaveDecoration({ busy: true, dirty: true }, confirm),
  ).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  expect(
    subject!.canLeaveDecoration({ busy: false, dirty: false }, confirm),
  ).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  expect(
    subject!.canLeaveDecoration({ busy: false, dirty: true }, confirm),
  ).toBe(false);
  expect(confirm).toHaveBeenCalledOnce();
  confirm.mockReturnValue(true);
  expect(
    subject!.canLeaveDecoration({ busy: false, dirty: true }, confirm),
  ).toBe(true);
});
