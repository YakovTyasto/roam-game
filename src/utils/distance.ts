import type { LatLng } from '../types';

/** Mean radius of the Earth in kilometres. */
export const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two coordinates using the Haversine formula.
 * Returns the distance in kilometres.
 */
export function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);

  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/**
 * Format a distance (in kilometres) for display. Uses metres below 1 km,
 * kilometres otherwise, with sensible precision. Supports imperial units.
 */
export function formatDistance(
  distanceKm: number,
  units: 'metric' | 'imperial' = 'metric',
): string {
  if (units === 'imperial') {
    const miles = distanceKm * 0.621371;
    if (miles < 0.1) {
      const feet = miles * 5280;
      return `${Math.round(feet)} ft`;
    }
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${Math.round(miles).toLocaleString()} mi`;
  }

  if (distanceKm < 1) {
    const metres = distanceKm * 1000;
    return `${Math.round(metres)} m`;
  }
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km`;
  return `${Math.round(distanceKm).toLocaleString()} km`;
}
