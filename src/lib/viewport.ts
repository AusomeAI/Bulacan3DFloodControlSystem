/**
 * Pan/zoom arithmetic for the schematic SVG map.
 *
 * Kept free of React and the DOM so the interaction rules - how far you can
 * zoom, what stays on screen when you pan, where a zoom is anchored - can be
 * tested directly instead of only through the rendered map.
 *
 * A viewport is an SVG viewBox: a window in the map's own coordinate space.
 * Zooming in shrinks the window; panning slides it. The window is always kept
 * inside the base extent, so the map cannot be dragged off the canvas.
 */

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 12;
export const ZOOM_STEP = 1.6;

/** Current magnification relative to the base extent. */
export function zoomOf(vp: Viewport, base: Viewport): number {
  return base.w / vp.w;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Slides the window back inside the base extent, keeping its size. */
export function clampToBase(vp: Viewport, base: Viewport): Viewport {
  const w = Math.min(vp.w, base.w);
  const h = Math.min(vp.h, base.h);
  return {
    w,
    h,
    x: clamp(vp.x, base.x, base.x + base.w - w),
    y: clamp(vp.y, base.y, base.y + base.h - h),
  };
}

export function resetViewport(base: Viewport): Viewport {
  return { ...base };
}

/**
 * Scales the window by `factor` about a fixed point, given in map coordinates,
 * so whatever sits under the cursor stays under the cursor.
 */
export function zoomAbout(
  vp: Viewport,
  base: Viewport,
  factor: number,
  anchorX: number,
  anchorY: number,
): Viewport {
  const current = zoomOf(vp, base);
  const target = clamp(current * factor, MIN_ZOOM, MAX_ZOOM);
  if (target === current) return vp;

  const w = base.w / target;
  const h = base.h / target;
  // Keep the anchor at the same relative position within the window.
  const rx = vp.w === 0 ? 0.5 : (anchorX - vp.x) / vp.w;
  const ry = vp.h === 0 ? 0.5 : (anchorY - vp.y) / vp.h;
  return clampToBase({ x: anchorX - rx * w, y: anchorY - ry * h, w, h }, base);
}

/** Zooms about the centre of the current window - what the +/- buttons do. */
export function zoomByStep(vp: Viewport, base: Viewport, factor: number): Viewport {
  return zoomAbout(vp, base, factor, vp.x + vp.w / 2, vp.y + vp.h / 2);
}

/** Moves the window by a delta in map coordinates. */
export function panBy(vp: Viewport, base: Viewport, dx: number, dy: number): Viewport {
  return clampToBase({ ...vp, x: vp.x + dx, y: vp.y + dy }, base);
}

/** Centres the window on a point without changing magnification. */
export function centreOn(vp: Viewport, base: Viewport, cx: number, cy: number): Viewport {
  return clampToBase({ ...vp, x: cx - vp.w / 2, y: cy - vp.h / 2 }, base);
}

export const viewBoxOf = (vp: Viewport) => `${vp.x} ${vp.y} ${vp.w} ${vp.h}`;
