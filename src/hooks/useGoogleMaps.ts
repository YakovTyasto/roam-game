import { useEffect, useState } from 'react';
import { GOOGLE_MAPS_API_KEY } from '../config/env';

/**
 * Loads the Google Maps JavaScript API exactly once for the whole app.
 *
 * The loader promise is a module-level singleton, so React Strict Mode's
 * double-invoked effects (and any number of components asking for Google) all
 * share ONE script tag and ONE API load — no duplicate downloads, no repeated
 * initialisation, and therefore no unnecessary API activity.
 */

type GoogleNamespace = typeof google;

let loaderPromise: Promise<GoogleNamespace> | null = null;

function loadGoogleMaps(): Promise<GoogleNamespace> {
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<GoogleNamespace>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Google Maps can only load in the browser.'));
      return;
    }

    // Already present (e.g. fast refresh).
    if (window.google?.maps) {
      resolve(window.google);
      return;
    }

    if (!GOOGLE_MAPS_API_KEY) {
      reject(new Error('Missing Google Maps API key.'));
      return;
    }

    const callbackName = '__roamInitGoogleMaps';
    const params = new URLSearchParams({
      key: GOOGLE_MAPS_API_KEY,
      v: 'weekly',
      loading: 'async',
      callback: callbackName,
    });

    (window as unknown as Record<string, () => void>)[callbackName] = () => {
      resolve(window.google);
      delete (window as unknown as Record<string, unknown>)[callbackName];
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error('Failed to load the Google Maps script.'));
    };

    document.head.appendChild(script);
  });

  return loaderPromise;
}

export type GoogleMapsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseGoogleMapsResult {
  status: GoogleMapsStatus;
  google: GoogleNamespace | null;
  error: string | null;
}

export function useGoogleMaps(): UseGoogleMapsResult {
  const [status, setStatus] = useState<GoogleMapsStatus>('loading');
  const [googleNs, setGoogleNs] = useState<GoogleNamespace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    loadGoogleMaps()
      .then((ns) => {
        if (cancelled) return;
        setGoogleNs(ns);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { status, google: googleNs, error };
}
