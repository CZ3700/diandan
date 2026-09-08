import { afterEach, expect, test, vi } from "vitest";
import { scheduleManagementFocus } from "./focus";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const body = {},
    trigger = {},
    photo = {};
  const document = { body, activeElement: trigger };
  const queue = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal("document", document);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queue.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
  const focus = vi.fn();
  const target = () => ({ focus }) as unknown as HTMLElement;
  return {
    document,
    body,
    photo,
    target,
    focus,
    queue,
    flush: () => {
      for (const callback of queue.values()) callback(0);
      queue.clear();
    },
  };
}

test("late scheduled entry focus does not replace the user's new control focus", () => {
  const state = fixture();
  scheduleManagementFocus(state.target);
  state.document.activeElement = state.photo;
  state.flush();
  expect(state.focus).not.toHaveBeenCalled();
});

test("entry focus remains available when the trigger stays focused or is removed", () => {
  const state = fixture();
  scheduleManagementFocus(state.target);
  state.flush();
  scheduleManagementFocus(state.target);
  state.document.activeElement = state.body;
  state.flush();
  expect(state.focus).toHaveBeenCalledTimes(2);
});

test("a superseded or unmounted workspace can cancel its scheduled focus", () => {
  const state = fixture();
  const cancel = scheduleManagementFocus(state.target);
  cancel();
  state.flush();
  expect(state.focus).not.toHaveBeenCalled();
  expect(state.queue.size).toBe(0);
});
