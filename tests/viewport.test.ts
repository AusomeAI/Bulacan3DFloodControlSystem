import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  centreOn,
  clampToBase,
  panBy,
  resetViewport,
  viewBoxOf,
  zoomAbout,
  zoomByStep,
  zoomOf,
  type Viewport,
} from "../src/lib/viewport";

const base: Viewport = { x: 0, y: 0, w: 1000, h: 800 };

describe("zoom", () => {
  it("starts at 1x on the base extent", () => {
    expect(zoomOf(base, base)).toBe(1);
    expect(viewBoxOf(base)).toBe("0 0 1000 800");
  });

  it("shrinks the window as it zooms in, keeping the aspect ratio", () => {
    const zoomed = zoomByStep(base, base, ZOOM_STEP);
    expect(zoomOf(zoomed, base)).toBeCloseTo(ZOOM_STEP, 6);
    expect(zoomed.w / zoomed.h).toBeCloseTo(base.w / base.h, 6);
  });

  it("returns to the base extent after equal in and out steps", () => {
    const there = zoomByStep(base, base, ZOOM_STEP);
    const back = zoomByStep(there, base, 1 / ZOOM_STEP);
    expect(back.w).toBeCloseTo(base.w, 6);
    expect(back.h).toBeCloseTo(base.h, 6);
    expect(back.x).toBeCloseTo(0, 6);
    expect(back.y).toBeCloseTo(0, 6);
  });

  it("refuses to zoom out past the base extent", () => {
    const out = zoomByStep(base, base, 1 / ZOOM_STEP);
    expect(out).toEqual(base);
    expect(zoomOf(out, base)).toBe(MIN_ZOOM);
  });

  it("stops at the maximum magnification", () => {
    let vp = base;
    for (let i = 0; i < 40; i++) vp = zoomByStep(vp, base, ZOOM_STEP);
    expect(zoomOf(vp, base)).toBeCloseTo(MAX_ZOOM, 6);
    expect(zoomByStep(vp, base, ZOOM_STEP)).toBe(vp);
  });

  it("holds the anchor point still while zooming about it", () => {
    const anchor = { x: 250, y: 600 };
    const before = (anchor.x - base.x) / base.w;
    const zoomed = zoomAbout(base, base, 2, anchor.x, anchor.y);
    const after = (anchor.x - zoomed.x) / zoomed.w;
    expect(after).toBeCloseTo(before, 6);
    const beforeY = (anchor.y - base.y) / base.h;
    expect((anchor.y - zoomed.y) / zoomed.h).toBeCloseTo(beforeY, 6);
  });

  it("keeps the window inside the map when anchored at a corner", () => {
    const zoomed = zoomAbout(base, base, 4, base.w, base.h);
    expect(zoomed.x + zoomed.w).toBeLessThanOrEqual(base.w + 1e-9);
    expect(zoomed.y + zoomed.h).toBeLessThanOrEqual(base.h + 1e-9);
    expect(zoomed.x).toBeGreaterThanOrEqual(0);
    expect(zoomed.y).toBeGreaterThanOrEqual(0);
  });
});

describe("pan", () => {
  const zoomed = zoomByStep(base, base, 4);

  it("moves the window by the requested delta", () => {
    const moved = panBy(zoomed, base, 30, -20);
    expect(moved.x).toBeCloseTo(zoomed.x + 30, 6);
    expect(moved.y).toBeCloseTo(zoomed.y - 20, 6);
    expect(moved.w).toBe(zoomed.w);
  });

  it("cannot be dragged off any edge of the map", () => {
    for (const [dx, dy] of [
      [-9999, 0],
      [9999, 0],
      [0, -9999],
      [0, 9999],
    ]) {
      const moved = panBy(zoomed, base, dx, dy);
      expect(moved.x).toBeGreaterThanOrEqual(0);
      expect(moved.y).toBeGreaterThanOrEqual(0);
      expect(moved.x + moved.w).toBeLessThanOrEqual(base.w + 1e-9);
      expect(moved.y + moved.h).toBeLessThanOrEqual(base.h + 1e-9);
    }
  });

  it("has nowhere to go at 1x", () => {
    expect(panBy(base, base, 500, 500)).toEqual(base);
  });

  it("centres on a point, clamped at the edges", () => {
    const centred = centreOn(zoomed, base, 500, 400);
    expect(centred.x + centred.w / 2).toBeCloseTo(500, 6);
    expect(centred.y + centred.h / 2).toBeCloseTo(400, 6);

    const corner = centreOn(zoomed, base, 0, 0);
    expect(corner.x).toBe(0);
    expect(corner.y).toBe(0);
  });
});

describe("clamping and reset", () => {
  it("pulls an out-of-bounds window back inside", () => {
    const stray = clampToBase({ x: -400, y: 900, w: 200, h: 160 }, base);
    expect(stray.x).toBe(0);
    expect(stray.y).toBe(base.h - 160);
  });

  it("never returns a window larger than the map", () => {
    const huge = clampToBase({ x: -50, y: -50, w: 5000, h: 4000 }, base);
    expect(huge).toEqual(base);
  });

  it("resets to a copy of the base extent", () => {
    const reset = resetViewport(base);
    expect(reset).toEqual(base);
    expect(reset).not.toBe(base);
  });
});
