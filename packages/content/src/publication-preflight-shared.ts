import type {
  PublicationPreflightIssue,
  SupportedLocale,
} from "@fan-support/contracts";
export function preflightIssue(
  code: PublicationPreflightIssue["code"],
  path: PublicationPreflightIssue["path"],
  locale?: SupportedLocale,
): PublicationPreflightIssue {
  return {
    code,
    severity: "BLOCKER",
    path,
    ...(locale === undefined ? {} : { locale }),
  };
}
export function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
export function rawCanonical(value: unknown): string {
  function order(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(order);
    if (item !== null && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, v]) => [key, order(v)]),
      );
    return item;
  }
  return JSON.stringify(order(value));
}
export function rawEqual(left: unknown, right: unknown): boolean {
  return rawCanonical(left) === rawCanonical(right);
}
export function equalSet(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  return rawEqual(
    left.map(rawCanonical).sort(),
    right.map(rawCanonical).sort(),
  );
}
// Keep fractional precision: PostgreSQL timestamps can differ within one JS millisecond.
export function comparePreflightTime(left: string, right: string): number {
  function parts(timestamp: string) {
    const match = /^(.+?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(timestamp);
    if (!match) throw new Error("invalid canonical timestamp");
    return {
      seconds: Date.parse(`${match[1]}${match[3]}`),
      fraction: match[2] ?? "",
    };
  }
  const a = parts(left),
    b = parts(right);
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
  const width = Math.max(a.fraction.length, b.fraction.length),
    x = a.fraction.padEnd(width, "0"),
    y = b.fraction.padEnd(width, "0");
  return x === y ? 0 : x < y ? -1 : 1;
}
export function withoutFields<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Omit<T, K> {
  const omitted = new Set<string>(keys.map(String));
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !omitted.has(key)),
  ) as Omit<T, K>;
}
