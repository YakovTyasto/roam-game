import { Compass, MapPin, Timer, Settings, Flag, DoorOpen } from 'lucide-react';
import { APP } from '../../config/app';
import { Button } from '../ui/Button';
import styles from './HUD.module.css';

interface HUDProps {
  round: number;
  /** null = Endless (no fixed total — shown as "∞"). */
  totalRounds: number | null;
  score: number;
  showTimer: boolean;
  secondsLeft: number | null;
  /** Active difficulty label, shown as a small pill during play. */
  difficultyLabel?: string;
  onOpenSettings: () => void;
  /** Endless only: end the session now and view the summary. */
  onFinishEndless?: () => void;
  /** Always-available exit control — opens the exit-confirmation dialog. */
  onExit: () => void;
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function HUD({
  round,
  totalRounds,
  score,
  showTimer,
  secondsLeft,
  difficultyLabel,
  onOpenSettings,
  onFinishEndless,
  onExit,
}: HUDProps) {
  return (
    <div className={styles.hud}>
      <div className={styles.cluster}>
        <Button variant="subtle" iconOnly onClick={onExit} aria-label="Exit game">
          <DoorOpen size={20} aria-hidden />
        </Button>
        <div className={styles.pill}>
          <MapPin size={16} className={styles.icon} aria-hidden />
          <span className={styles.label}>Round</span>
          <span className={styles.value}>
            {round}
            <span aria-hidden> / </span>
            <span className="sr-only"> of </span>
            {totalRounds === null ? <span aria-label="Endless">∞</span> : totalRounds}
          </span>
        </div>
        {difficultyLabel && (
          <div className={styles.pill}>
            <span className={styles.label}>Mode</span>
            <span className={styles.value}>{difficultyLabel}</span>
          </div>
        )}
        <div className={styles.pill}>
          <Compass size={16} className={styles.icon} aria-hidden />
          <span className={styles.label}>Score</span>
          <span className={`${styles.value} ${styles.accent}`}>
            {score.toLocaleString()}
          </span>
        </div>
      </div>

      <div className={styles.cluster}>
        {showTimer && secondsLeft !== null && (
          <div className={styles.pill} role="timer" aria-live="off">
            <Timer size={16} className={styles.icon} aria-hidden />
            <span
              className={`${styles.value} ${styles.timer} ${
                secondsLeft <= 10 ? styles.timerLow : ''
              }`}
            >
              {formatClock(secondsLeft)}
            </span>
          </div>
        )}
        {onFinishEndless && (
          <Button variant="subtle" onClick={onFinishEndless} aria-label="Finish Endless session">
            <Flag size={16} aria-hidden />
            Finish
          </Button>
        )}
        <Button
          variant="subtle"
          iconOnly
          onClick={onOpenSettings}
          aria-label={`${APP.name} settings`}
        >
          <Settings size={20} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
