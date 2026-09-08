/** Capture ownership before the request; never move focus the user moved elsewhere. */
export function prepareCartRemovalFocus(root: HTMLElement, itemId: string) {
  const original = root.ownerDocument.activeElement;
  const rows = Array.from(
    root.querySelectorAll<HTMLElement>("[data-cart-item]"),
  );
  const index = rows.findIndex(
    (row) => row.getAttribute("data-cart-item") === itemId,
  );
  const owned = index >= 0 && rows[index]?.contains(original);
  return () => {
    if (!owned || !root.isConnected || !original) return;
    const active = root.ownerDocument.activeElement;
    if (
      active !== original &&
      (active !== root.ownerDocument.body || original.isConnected)
    )
      return;
    const current = Array.from(
      root.querySelectorAll<HTMLElement>("[data-cart-item]"),
    );
    const next =
      current[
        Math.min(index, current.length - 1)
      ]?.querySelector<HTMLButtonElement>("[data-cart-remove]");
    (next ?? root).focus();
  };
}
