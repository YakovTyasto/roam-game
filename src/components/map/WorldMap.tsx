import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GameLocation, LatLng } from '../../types';
import styles from './WorldMap.module.css';

interface WorldMapProps {
  mode: 'guess' | 'result';
  guess: LatLng | null;
  actual?: GameLocation | null;
  interactive: boolean;
  onPlaceGuess: (latlng: LatLng) => void;
}

const guessIcon = L.divIcon({
  className: '',
  html: `<div class="${styles.pin} ${styles.pinGuess}"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

const actualIcon = L.divIcon({
  className: '',
  html: `<div class="${styles.pin} ${styles.pinActual}"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

/**
 * A single, persistent Leaflet map reused for both placing a guess and showing
 * the round result. It is created once and kept mounted for the whole game;
 * rounds only add/remove markers and a connecting line, and never recreate the
 * map. Uses OpenStreetMap tiles (no Google Maps, no key).
 */
export function WorldMap({
  mode,
  guess,
  actual,
  interactive,
  onPlaceGuess,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const guessMarkerRef = useRef<L.Marker | null>(null);
  const actualMarkerRef = useRef<L.Marker | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);

  const onPlaceRef = useRef(onPlaceGuess);
  onPlaceRef.current = onPlaceGuess;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Create the map exactly once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 1,
      minZoom: 1,
      maxZoom: 18,
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      noWrap: false,
    }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (modeRef.current !== 'guess' || !interactiveRef.current) return;
      onPlaceRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;

    // Keep the canvas sized correctly when its container resizes/opens.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      guessMarkerRef.current = null;
      actualMarkerRef.current = null;
      lineRef.current = null;
    };
  }, []);

  // Reconcile the guess marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!guess) {
      if (guessMarkerRef.current) {
        guessMarkerRef.current.remove();
        guessMarkerRef.current = null;
      }
      return;
    }

    if (!guessMarkerRef.current) {
      const marker = L.marker([guess.lat, guess.lng], {
        icon: guessIcon,
        draggable: mode === 'guess' && interactive,
        keyboard: false,
        title: 'Your guess',
      }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        onPlaceRef.current({ lat: p.lat, lng: p.lng });
      });
      guessMarkerRef.current = marker;
    } else {
      guessMarkerRef.current.setLatLng([guess.lat, guess.lng]);
      const drag = guessMarkerRef.current.dragging;
      if (drag) {
        if (mode === 'guess' && interactive) drag.enable();
        else drag.disable();
      }
    }
  }, [guess, mode, interactive]);

  // Reconcile result overlays (actual marker + connecting line + fit bounds).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const clearResult = () => {
      actualMarkerRef.current?.remove();
      actualMarkerRef.current = null;
      lineRef.current?.remove();
      lineRef.current = null;
    };

    if (mode !== 'result' || !actual || !guess) {
      clearResult();
      return;
    }

    const actualLatLng: L.LatLngExpression = [actual.lat, actual.lng];
    const guessLatLng: L.LatLngExpression = [guess.lat, guess.lng];

    actualMarkerRef.current = L.marker(actualLatLng, {
      icon: actualIcon,
      title: actual.label,
    }).addTo(map);

    lineRef.current = L.polyline([guessLatLng, actualLatLng], {
      color: '#bff43a',
      weight: 2,
      dashArray: '4 6',
      opacity: 0.9,
    }).addTo(map);

    const bounds = L.latLngBounds([guessLatLng, actualLatLng]);
    map.fitBounds(bounds, { padding: [56, 56], maxZoom: 8, animate: true });

    return clearResult;
  }, [mode, actual, guess]);

  return (
    <div
      ref={containerRef}
      className={styles.map}
      role="application"
      aria-label={
        mode === 'guess'
          ? 'World map — tap to place your guess'
          : 'World map — round result'
      }
    />
  );
}
