import type { GameLocation } from '../types';

/** Radii (metres) tried in order — mirrors the solo StreetView component. */
export const RESOLVE_RADII = [120, 1000, 6000];

/**
 * Resolve a concrete Street View panorama id for a curated location using the
 * Google Street View service. Returns the pano id (globally valid, so both
 * clients can `setPano(panoId)` and see the identical panorama) or null if no
 * outdoor panorama exists nearby.
 *
 * This runs ONLY on the host, once, while building the match manifest — it is
 * how we guarantee both players load the same panorama and orientation without
 * exposing the target coordinates through the round row during play.
 */
export function resolvePanoId(
  google: typeof window.google,
  location: GameLocation,
  radii: number[] = RESOLVE_RADII,
): Promise<string | null> {
  const service = new google.maps.StreetViewService();

  const tryRadius = (index: number): Promise<string | null> => {
    if (index >= radii.length) return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
      service.getPanorama(
        {
          location: { lat: location.lat, lng: location.lng },
          radius: location.radius ?? radii[index],
          source: google.maps.StreetViewSource.OUTDOOR,
          preference: google.maps.StreetViewPreference.NEAREST,
        },
        (data, status) => {
          if (
            status === google.maps.StreetViewStatus.OK &&
            data?.location?.pano
          ) {
            resolve(data.location.pano);
          } else {
            resolve(null);
          }
        },
      );
    }).then((pano) => (pano ? pano : tryRadius(index + 1)));
  };

  return tryRadius(0);
}
