import type { ReactNode } from 'react';
import styles from './StatusScreen.module.css';

interface StatusScreenProps {
  icon: ReactNode;
  title: string;
  description?: string;
  tone?: 'accent' | 'danger';
  children?: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
}

export function StatusScreen({
  icon,
  title,
  description,
  tone = 'accent',
  children,
  actions,
  note,
}: StatusScreenProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div
          className={`${styles.badge} ${
            tone === 'danger' ? styles.badgeDanger : ''
          }`}
          aria-hidden
        >
          {icon}
        </div>
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.text}>{description}</p>}
        {children && <div className={styles.body}>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
        {note && <p className={styles.note}>{note}</p>}
      </div>
    </div>
  );
}
