/** SVG helpers for the gauges: angles in degrees, 0 at 12 o'clock, clockwise. */

export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** An arc from `from` to `to` degrees (to > from), as a path for a stroked line. */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const sweep = Math.min(to - from, 359.99);
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, from + sweep);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
