// Contracts accept fractional ISO timestamps; Date alone truncates them to milliseconds.
function parts(timestamp: string): { milliseconds: number; fraction: string } {
  const match = /^(.+?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(timestamp);
  if (match === null) throw new Error("invalid canonical timestamp");
  const milliseconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(milliseconds))
    throw new Error("invalid canonical timestamp");
  return { milliseconds, fraction: match[2] ?? "" };
}

export function compareBaseContentTime(left: string, right: string): number {
  const a = parts(left);
  const b = parts(right);
  if (a.milliseconds !== b.milliseconds)
    return a.milliseconds < b.milliseconds ? -1 : 1;
  const width = Math.max(a.fraction.length, b.fraction.length);
  const x = a.fraction.padEnd(width, "0");
  const y = b.fraction.padEnd(width, "0");
  return x === y ? 0 : x < y ? -1 : 1;
}

export function addBaseContentSeconds(
  timestamp: string,
  seconds: number,
): string {
  const time = parts(timestamp);
  return new Date(time.milliseconds + seconds * 1000)
    .toISOString()
    .replace(/\.000Z$/u, `.${time.fraction || "000"}Z`);
}
