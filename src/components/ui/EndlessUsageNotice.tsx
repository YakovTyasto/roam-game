import { Info, X } from 'lucide-react';
import styles from './EndlessUsageNotice.module.css';

interface EndlessUsageNoticeProps {
  roundsPlayed: number;
  onDismiss: () => void;
}

/**
 * Informational (not a dark pattern) reminder that continued Endless play
 * keeps loading new Street View panoramas, which are billable API calls.
 */
export function EndlessUsageNotice({ roundsPlayed, onDismiss }: EndlessUsageNoticeProps) {
  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <Info size={16} aria-hidden />
      <span>{roundsPlayed} rounds played — Endless keeps loading new locations.</span>
      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
