/**
 * Rectangle intersection used by the browser checks.
 *
 * The area is intentionally unrounded: a 0.25px² intersection is a real overlap
 * and must not be collapsed to "no overlap" by rounding.
 */
export function intersectionArea(a, b) {
  if (!a || !b) return 0;
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}
