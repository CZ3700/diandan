import { expect, it, vi } from "vitest";
it("restores focus only when a submitted control disappeared and the user did not move elsewhere", async () => {
  const loaded = await import("./checkout-focus").catch(() => null);
  expect(loaded?.prepareCheckoutStepFocus).toBeTypeOf("function");
  if (!loaded) return;
  const old = { isConnected: true };
  const doc = { activeElement: old as unknown, body: {} };
  const root = {
    ownerDocument: doc,
    isConnected: true,
    contains: (node: unknown) => node === old,
    focus: vi.fn(),
  };
  const restore = loaded.prepareCheckoutStepFocus(
    root as unknown as HTMLElement,
  );
  restore();
  expect(root.focus).not.toHaveBeenCalled();
  old.isConnected = false;
  doc.activeElement = {};
  restore();
  expect(root.focus).not.toHaveBeenCalled();
  doc.activeElement = doc.body;
  restore();
  expect(root.focus).toHaveBeenCalledOnce();
  root.isConnected = false;
  restore();
  expect(root.focus).toHaveBeenCalledOnce();
});
