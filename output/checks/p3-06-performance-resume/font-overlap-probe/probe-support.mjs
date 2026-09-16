export function subtractPoints(ranges, excluded) {
  const points = [...excluded].sort((a, b) => a - b);
  const result = [];
  for (const [start, end] of ranges) {
    let cursor = start;
    for (const point of points) {
      if (point < cursor) continue;
      if (point > end) break;
      if (cursor < point) result.push([cursor, point - 1]);
      cursor = point + 1;
    }
    if (cursor <= end) result.push([cursor, end]);
  }
  return result;
}
