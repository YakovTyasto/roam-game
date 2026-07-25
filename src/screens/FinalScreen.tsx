import { RotateCcw, Home, Trophy } from 'lucide-react';
import type { Preferences, RoundResult } from '../types';
import { APP } from '../config/app';
import type { EndlessStats } from '../utils/endlessStats';
import { performanceMessage } from '../utils/score';
import { formatDistance } from '../utils/distance';
import { Button } from '../components/ui/Button';
import styles from './FinalScreen.module.css';

interface FinalScreenProps {
  results: RoundResult[];
  isBest: boolean;
  units: Preferences['units'];
  /** Active difficulty label, shown alongside the result badge. */
  difficultyLabel?: string;
  /** Present only for an Endless session — swaps the meter for session stats. */
  endlessStats?: EndlessStats;
  onPlayAgain: () => void;
  onHome: () => void;
}

export function FinalScreen({
  results,
  isBest,
  units,
  difficultyLabel,
  endlessStats,
  onPlayAgain,
  onHome,
}: FinalScreenProps) {
  const total = results.reduce((sum, r) => sum + r.score, 0);
  // Scales with the actual round count played, not a fixed constant — this
  // screen is shared by the classic 5-round game and any custom round count.
  const maxPossible = Math.max(1, results.length) * APP.maxRoundScore;
  const pct = Math.round((total / maxPossible) * 100);

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.badge}>
            <Trophy size={14} aria-hidden />
            {endlessStats ? 'Endless session complete' : isBest ? 'New best score' : 'Game complete'}
            {difficultyLabel ? ` · ${difficultyLabel}` : ''}
          </span>
          <div className={styles.total}>
            {total.toLocaleString()}
            {!endlessStats && (
              <span className={styles.totalMax}>
                {' / '}
                {maxPossible.toLocaleString()}
              </span>
            )}
          </div>
          <p className={styles.message}>
            {endlessStats
              ? `${endlessStats.roundsPlayed} rounds · ${Math.round(endlessStats.avgScorePerRound).toLocaleString()} avg/round`
              : performanceMessage(total, maxPossible)}
          </p>
        </div>

        {endlessStats ? (
          <ol className={styles.rounds}>
            <li className={styles.roundRow}>
              <span className={styles.roundName}>Rounds played</span>
              <span className={styles.roundScore}>{endlessStats.roundsPlayed}</span>
            </li>
            <li className={styles.roundRow}>
              <span className={styles.roundName}>Average distance</span>
              <span className={styles.roundScore}>
                {formatDistance(endlessStats.avgDistanceKm, units)}
              </span>
            </li>
            {endlessStats.bestFiveRoundSegment !== null && (
              <li className={styles.roundRow}>
                <span className={styles.roundName}>Best 5-round stretch</span>
                <span className={styles.roundScore}>
                  {endlessStats.bestFiveRoundSegment.toLocaleString()}
                </span>
              </li>
            )}
          </ol>
        ) : (
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
        )}

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
