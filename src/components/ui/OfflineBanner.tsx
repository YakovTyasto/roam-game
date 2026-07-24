import { WifiOff } from 'lucide-react';
import styles from './OfflineBanner.module.css';

export function OfflineBanner() {
  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <WifiOff size={16} className={styles.icon} aria-hidden />
      You&apos;re offline. Street View and map tiles need a connection.
    </div>
  );
}
