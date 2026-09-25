export function canonicalUuid(value: string): string {
  return value.toLowerCase();
}

export function sameUuid(left: string, right: string): boolean {
  return canonicalUuid(left) === canonicalUuid(right);
}

export function sameOptionalUuid(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && sameUuid(left, right);
}
