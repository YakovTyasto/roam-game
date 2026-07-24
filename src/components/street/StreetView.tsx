import { useEffect, useRef } from 'react';
import type { GameLocation } from '../../types';
import { useGoogleMaps } from '../../hooks/useGoogleMaps';
import styles from './StreetView.module.css';

/**
 * A fixed panorama target used by multiplayer: both clients set the exact same
 * pano id and orientation so they see an identical view. No search is performed
 * and no target coordinates are needed on the client to render it.
 */
export interface PanoramaTarget {
  panoId: string;
  heading: number;
  pitch?: number;
  zoom?: number;
}

interface StreetViewProps {
  /** Solo mode: a curated location the component searches a panorama for. */
  location?: GameLocation | null;
  /** Multiplayer mode: an exact, pre-resolved panorama + orientation. */
  panorama?: PanoramaTarget | null;
  /** Called once a panorama has been positioned. */
  onReady: () => void;
  /** Called when no usable panorama exists near a searched location (solo). */
  onNoPanorama?: () => void;
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
 *
 * Two targeting modes share the single instance:
 *   • `location` — solo mode searches for the nearest outdoor panorama.
 *   • `panorama` — multiplayer mode sets an exact pano id + heading so both
 *     players see the identical view without exposing target coordinates.
 */
export function StreetView({
  location,
  panorama,
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

  // Multiplayer: position the panorama at an exact pano id + heading. Keyed on
  // the primitive fields (not the object) so a rerender never re-issues a
  // billable setPano — it only fires when the round's panorama actually changes.
  const panoId = panorama?.panoId;
  const heading = panorama?.heading;
  const pitch = panorama?.pitch;
  const zoom = panorama?.zoom;
  useEffect(() => {
    if (!google || panoId == null) return;
    const pano = panoRef.current;
    if (!pano) return;

    pano.setPano(panoId);
    pano.setPov({ heading: heading ?? 0, pitch: pitch ?? 0 });
    pano.setZoom(zoom ?? 0);
    pano.setVisible(true);
    onReadyRef.current();
  }, [google, panoId, heading, pitch, zoom]);

  // Solo: search for and reposition the panorama when the location changes.
  useEffect(() => {
    if (!google || panoId != null || !location) return;
    const pano = panoRef.current;
    const service = serviceRef.current;
    if (!pano || !service) return;

    let cancelled = false;
    pano.setVisible(false);

    const tryRadius = (index: number) => {
      if (cancelled) return;
      if (index >= SEARCH_RADII.length) {
        onNoPanoRef.current?.();
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
  }, [google, location, panoId]);

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
