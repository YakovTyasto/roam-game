import { RefreshCw, X } from 'lucide-react';
import { Button } from './Button';
import styles from './UpdateAvailableBanner.module.css';

interface UpdateAvailableBannerProps {
  onUpdate: () => void;
  onDismiss: () => void;
}

/** Visible, opt-in PWA update prompt — never reloads the page on its own. */
export function UpdateAvailableBanner({ onUpdate, onDismiss }: UpdateAvailableBannerProps) {
  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <RefreshCw size={16} className={styles.icon} aria-hidden />
      <span>A new version is available.</span>
      <Button variant="primary" onClick={onUpdate}>
        Update
      </Button>
      <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss update notice">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
