import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export interface ServiceWorkerUpdateController {
  /** A new version has installed and is waiting — show the update prompt. */
  needsRefresh: boolean;
  /** Activate the waiting service worker and reload. */
  applyUpdate: () => void;
  /** Dismiss the prompt without updating (it will reappear on the next check). */
  dismiss: () => void;
}

/**
 * Conservative PWA update flow: vite-plugin-pwa's registerType is 'prompt'
 * (see vite.config.ts), so a new service worker installs in the background
 * and waits — it never activates or reloads the page on its own. This hook
 * only surfaces that a refresh is available; the player decides when.
 */
export function useServiceWorkerUpdate(): ServiceWorkerUpdateController {
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const updateRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    updateRef.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedsRefresh(true);
      },
    });
  }, []);

  return {
    needsRefresh: needsRefresh && !dismissed,
    applyUpdate: () => {
      void updateRef.current?.(true);
    },
    dismiss: () => setDismissed(true),
  };
}
