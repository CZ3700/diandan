/** Existing content limits use UTF-16 units; never split an original surrogate pair. */
export function summarizeDailyOriginal(value: string, length: number): string {
  const summary = value.slice(0, length);
  const last = summary.charCodeAt(summary.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? summary.slice(0, -1) : summary;
}
