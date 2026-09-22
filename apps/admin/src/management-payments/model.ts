export function parsePercentage(input: string): number | null {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/u.test(input)) return null;
  const [whole, part = ""] = input.split(".");
  const value = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  return value <= 10000 ? value : null;
}
