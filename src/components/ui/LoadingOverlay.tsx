import styles from './LoadingOverlay.module.css';

export function LoadingOverlay({ label = 'Finding a location…' }: { label?: string }) {
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.inner}>
        <div className={styles.spinner} aria-hidden />
        <span className={styles.label}>{label}</span>
      </div>
    </div>
  );
}
