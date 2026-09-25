/** Inventory timestamps arrive as ISO commands or PostgreSQL timestamp-mode strings. */
export function canonicalInventoryTimestamp<Value extends string>(
  value: Value,
): Value {
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)$/u.exec(
      value,
    );
  if (!match?.[1] || !match[2] || !match[5]) {
    throw new Error("Invalid inventory timestamp");
  }
  const rawOffset = match[5];
  const offset =
    rawOffset.length === 3
      ? `${rawOffset}:00`
      : rawOffset.length === 5
        ? `${rawOffset.slice(0, 3)}:${rawOffset.slice(3)}`
        : rawOffset;
  // Date only normalizes whole seconds and the offset; it never receives the fraction.
  const seconds = Date.parse(
    `${match[1]}T${match[2]}:${match[3] ?? "00"}${offset}`,
  );
  if (!Number.isFinite(seconds)) {
    throw new Error("Invalid inventory timestamp");
  }
  const fraction = (match[4] ?? "").replace(/0+$/u, "").padEnd(3, "0");
  return `${new Date(seconds).toISOString().slice(0, -5)}.${fraction}Z` as Value;
}

export function sameInventoryTimestamp(left: string, right: string): boolean {
  return (
    canonicalInventoryTimestamp(left) === canonicalInventoryTimestamp(right)
  );
}
