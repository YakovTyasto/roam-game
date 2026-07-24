import { RotateCcw, Home, Trophy } from 'lucide-react';
import type { Preferences, RoundResult } from '../types';
import { MAX_GAME_SCORE } from '../config/app';
import { performanceMessage } from '../utils/score';
import { formatDistance } from '../utils/distance';
import { Button } from '../components/ui/Button';
import styles from './FinalScreen.module.css';

interface FinalScreenProps {
  results: RoundResult[];
  isBest: boolean;
  units: Preferences['units'];
  onPlayAgain: () => void;
  onHome: () => void;
}

export function FinalScreen({
  results,
  isBest,
  units,
  onPlayAgain,
  onHome,
}: FinalScreenProps) {
  const total = results.reduce((sum, r) => sum + r.score, 0);
  const pct = Math.round((total / MAX_GAME_SCORE) * 100);

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.badge}>
            <Trophy size={14} aria-hidden />
            {isBest ? 'New best score' : 'Game complete'}
          </span>
          <div className={styles.total}>
            {total.toLocaleString()}
            <span className={styles.totalMax}>
              {' / '}
              {MAX_GAME_SCORE.toLocaleString()}
            </span>
          </div>
          <p className={styles.message}>
            {performanceMessage(total, MAX_GAME_SCORE)}
          </p>
        </div>

        <div
          className={styles.meter}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Total score"
        >
          <div className={styles.meterFill} style={{ width: `${pct}%` }} />
        </div>

        <ol className={styles.rounds}>
          {results.map((r, i) => (
            <li className={styles.roundRow} key={r.location.id}>
              <span className={styles.roundNum}>{i + 1}</span>
              <span className={styles.roundName}>
                {r.location.label}
                <span className={styles.roundCountry}> · {r.location.country}</span>
              </span>
              <span className={styles.roundDistance}>
                {formatDistance(r.distanceKm, units)}
              </span>
              <span className={styles.roundScore}>
                {r.score.toLocaleString()}
              </span>
            </li>
          ))}
        </ol>

        <div className={styles.actions}>
          <Button variant="primary" size="lg" block onClick={onPlayAgain}>
            <RotateCcw size={18} aria-hidden />
            Play again
          </Button>
          <Button variant="ghost" size="lg" onClick={onHome} aria-label="Home">
            <Home size={18} aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
