/** Transfer entry focus after rendering, unless the user has already moved it. */
export function scheduleManagementFocus(target: () => HTMLElement | null) {
  const trigger = document.activeElement;
  const frame = requestAnimationFrame(() => {
    if (
      document.activeElement === trigger ||
      document.activeElement === document.body
    )
      target()?.focus();
  });
  return () => cancelAnimationFrame(frame);
}
