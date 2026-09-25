/** A completed user action may remove its control; polling must never move focus. */
export function prepareCheckoutStepFocus(root: HTMLElement) {
  const original = root.ownerDocument.activeElement;
  const owned = root.contains(original);
  return () => {
    if (
      owned &&
      original &&
      !original.isConnected &&
      root.isConnected &&
      root.ownerDocument.activeElement === root.ownerDocument.body
    )
      root.focus();
  };
}
