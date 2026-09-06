import { Scene, Vector3 } from "three";
import type { SceneProjector } from "./floodScene";

const METRES_PER_DEGREE_LAT = 111_320;

/**
 * Stands in for Google's overlay when there is no Google map.
 *
 * The same equirectangular projection the Maps overlay uses locally: metres
 * east and north of an anchor, with longitude compressed by cos(latitude).
 * Over a province-sized extent the distortion is far below the accuracy of the
 * schematic geometry it is drawing, and it keeps FloodScene's coordinate frame
 * identical in both views - Z up, metres, origin at the anchor.
 */
export class LocalProjector implements SceneProjector {
  readonly scene = new Scene();
  private readonly anchor: { lat: number; lng: number };
  private readonly metresPerDegreeLng: number;

  constructor(anchor: { lat: number; lng: number }) {
    this.anchor = anchor;
    this.metresPerDegreeLng = METRES_PER_DEGREE_LAT * Math.cos((anchor.lat * Math.PI) / 180);
  }

  latLngAltitudeToVector3(
    position: { lat: number; lng: number; altitude?: number },
    target = new Vector3(),
  ): Vector3 {
    return target.set(
      (position.lng - this.anchor.lng) * this.metresPerDegreeLng,
      (position.lat - this.anchor.lat) * METRES_PER_DEGREE_LAT,
      position.altitude ?? 0,
    );
  }
}

/** Bounding box of every coordinate in the datasets, in degrees. */
export function boundsOf(coords: [number, number][]): {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  centre: { lat: number; lng: number };
} {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  return {
    minLng,
    maxLng,
    minLat,
    maxLat,
    centre: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
  };
}
