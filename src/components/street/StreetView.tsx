import { useEffect, useRef } from 'react';
import type { GameLocation } from '../../types';
import { useGoogleMaps } from '../../hooks/useGoogleMaps';
import styles from './StreetView.module.css';

interface StreetViewProps {
  location: GameLocation | null;
  /** Called once a panorama has been positioned for the location. */
  onReady: () => void;
  /** Called when no usable panorama exists near the location. */
  onNoPanorama: () => void;
  /** Called if Google Maps fails to load at all. */
  onLoadError: (message: string) => void;
}

/** Radii (metres) tried in order when searching for the nearest panorama. */
const SEARCH_RADII = [120, 1000, 6000];

/**
 * Owns the ONE and ONLY `StreetViewPanorama` instance for the whole game.
 *
 * Cost strategy (see README):
 *   • The panorama object is created a single time and stored in a ref.
 *   • React rerenders never recreate it (guarded by the ref).
 *   • Changing rounds only calls `setPano` / `setPov` on the existing
 *     instance — the panorama is repositioned, never destroyed and rebuilt.
 *   • React Strict Mode's double-invoked effects are guarded so no second
 *     panorama (and no second billable load) is ever created.
 */
export function StreetView({
  location,
  onReady,
  onNoPanorama,
  onLoadError,
}: StreetViewProps) {
  const { google, status, error } = useGoogleMaps();
  const containerRef = useRef<HTMLDivElement>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const serviceRef = useRef<google.maps.StreetViewService | null>(null);

  // Keep the latest callbacks without forcing the lookup effect to re-run.
  const onReadyRef = useRef(onReady);
  const onNoPanoRef = useRef(onNoPanorama);
  onReadyRef.current = onReady;
  onNoPanoRef.current = onNoPanorama;

  // Report a hard load failure to the parent.
  useEffect(() => {
    if (status === 'error') onLoadError(error ?? 'Google Maps failed to load.');
  }, [status, error, onLoadError]);

  // Create the single panorama instance exactly once.
  useEffect(() => {
    if (!google || !containerRef.current || panoRef.current) return;

    panoRef.current = new google.maps.StreetViewPanorama(containerRef.current, {
      visible: false,
      // Hide location-revealing / distracting chrome where the API allows.
      addressControl: false,
      showRoadLabels: false,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
      enableCloseButton: false,
      // Keep exploration controls: look around, zoom, and move.
      panControl: true,
      zoomControl: true,
      linksControl: true,
      clickToGo: true,
      scrollwheel: true,
      disableDefaultUI: false,
    });
    serviceRef.current = new google.maps.StreetViewService();
  }, [google]);

  // Reposition the existing panorama whenever the location changes.
  useEffect(() => {
    if (!google || !location) return;
    const pano = panoRef.current;
    const service = serviceRef.current;
    if (!pano || !service) return;

    let cancelled = false;
    pano.setVisible(false);

    const tryRadius = (index: number) => {
      if (cancelled) return;
      if (index >= SEARCH_RADII.length) {
        onNoPanoRef.current();
        return;
      }

      service.getPanorama(
        {
          location: { lat: location.lat, lng: location.lng },
          radius: location.radius ?? SEARCH_RADII[index],
          source: google.maps.StreetViewSource.OUTDOOR,
          preference: google.maps.StreetViewPreference.NEAREST,
        },
        (data, svStatus) => {
          if (cancelled) return;
          if (
            svStatus === google.maps.StreetViewStatus.OK &&
            data?.location?.pano
          ) {
            pano.setPano(data.location.pano);
            // Randomise the starting heading so the same spot never opens
            // facing an identical, memorisable direction.
            pano.setPov({ heading: Math.floor(Math.random() * 360), pitch: 0 });
            pano.setZoom(0);
            pano.setVisible(true);
            onReadyRef.current();
          } else {
            tryRadius(index + 1);
          }
        },
      );
    };

    tryRadius(0);

    return () => {
      cancelled = true;
    };
  }, [google, location]);

  return (
    <div className={`${styles.wrap} noselect`} aria-hidden={false}>
      <div
        ref={containerRef}
        className={styles.canvas}
        role="application"
        aria-label="Street View panorama — explore the surroundings"
      />
    </div>
  );
}
