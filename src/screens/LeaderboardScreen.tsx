import { ArrowLeft, RefreshCw, Trophy, Users, User, AlertTriangle, WifiOff } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { DIFFICULTIES, difficultyLabel } from '../config/difficulty';
import { useLeaderboard } from '../leaderboard/useLeaderboard';
import { formatWeekRange, formatCountdown, msUntilWeekEnd } from '../leaderboard/weeks';
import type { LeaderboardEntry, LeaderboardMode } from '../leaderboard/types';
import styles from './LeaderboardScreen.module.css';

interface LeaderboardScreenProps {
  onBack: () => void;
}

const MODES: { id: LeaderboardMode; label: string; icon: typeof User }[] = [
  { id: 'solo', label: 'Solo', icon: User },
  { id: 'multiplayer', label: 'Multiplayer', icon: Users },
];

function Row({ entry, mode }: { entry: LeaderboardEntry; mode: LeaderboardMode }) {
  const withWins = mode === 'multiplayer' ? styles.withWins : '';
  return (
    <li className={`${styles.row} ${withWins} ${entry.isSelf ? styles.rowSelf : ''}`}>
      <span className={styles.rank}>
        {entry.rank}
        {entry.rank === 1 && (
          <Trophy size={13} aria-hidden style={{ marginLeft: 3, color: 'var(--accent)' }} />
        )}
      </span>
      <span className={styles.name}>
        {entry.displayName}
        {entry.isSelf && ' (you)'}
      </span>
      <span className={styles.stat} title="Games completed">
        {entry.gamesCompleted}
      </span>
      {mode === 'multiplayer' && (
        <span className={styles.stat} title="Wins">
          {entry.wins}
        </span>
      )}
      <span className={styles.score}>{entry.bestScore.toLocaleString()}</span>
    </li>
  );
}

export function LeaderboardScreen({ onBack }: LeaderboardScreenProps) {
  const lb = useLeaderboard();
  const now = new Date();

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.head}>
          <Button variant="subtle" iconOnly onClick={onBack} aria-label="Back to home">
            <ArrowLeft size={20} aria-hidden />
          </Button>
          <h1 className={styles.title}>
            <Trophy size={20} aria-hidden /> Weekly leaderboard
          </h1>
          <Button
            variant="subtle"
            iconOnly
            onClick={lb.refresh}
            aria-label="Refresh leaderboard"
            disabled={lb.status === 'offline'}
          >
            <RefreshCw size={18} aria-hidden />
          </Button>
        </div>

        <div className={styles.weekBar}>
          <span>{formatWeekRange(now)}</span>
          <span className={styles.countdown}>
            Resets in {formatCountdown(msUntilWeekEnd(now))}
          </span>
        </div>

        {/* Mode filter */}
        <div className={styles.filters} role="group" aria-label="Mode">
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                className={`${styles.filterBtn} ${lb.mode === m.id ? styles.filterActive : ''}`}
                aria-pressed={lb.mode === m.id}
                onClick={() => lb.setMode(m.id)}
              >
                <Icon size={15} aria-hidden /> {m.label}
              </button>
            );
          })}
        </div>

        {/* Difficulty filter (never mixes difficulties in one ranking) */}
        <div className={styles.filters} role="group" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              className={`${styles.filterBtn} ${lb.difficulty === d ? styles.filterActive : ''}`}
              aria-pressed={lb.difficulty === d}
              onClick={() => lb.setDifficulty(d)}
            >
              {difficultyLabel(d)}
            </button>
          ))}
        </div>

        {/* Body */}
        {lb.status === 'offline' && (
          <div className={styles.state}>
            <WifiOff size={22} aria-hidden />
            <p>The leaderboard needs online services, which aren’t configured.</p>
            <p className={styles.stateHint}>Solo play still works offline.</p>
          </div>
        )}
        {lb.status === 'error' && (
          <div className={styles.state}>
            <AlertTriangle size={22} aria-hidden />
            <p>Couldn’t load the leaderboard.</p>
            <Button variant="ghost" onClick={lb.refresh}>
              <RefreshCw size={16} aria-hidden /> Try again
            </Button>
          </div>
        )}
        {lb.status === 'loading' && (
          <ul className={styles.list} aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <li className={styles.skeleton} key={i} />
            ))}
          </ul>
        )}
        {lb.status === 'empty' && (
          <div className={styles.state}>
            <Trophy size={22} aria-hidden />
            <p>No scores yet this week.</p>
            <p className={styles.stateHint}>
              Finish a {difficultyLabel(lb.difficulty)} {lb.mode} game to claim the top spot.
            </p>
          </div>
        )}
        {lb.status === 'ready' && lb.data && (
          <>
            <div
              className={`${styles.colHead} ${lb.mode === 'multiplayer' ? styles.withWins : ''}`}
            >
              <span className={styles.rank}>#</span>
              <span className={styles.name}>Player</span>
              <span className={styles.stat}>Games</span>
              {lb.mode === 'multiplayer' && <span className={styles.stat}>Wins</span>}
              <span className={styles.score}>Best</span>
            </div>
            <ol className={styles.list}>
              {lb.data.entries.map((e) => (
                <Row key={`${e.rank}-${e.displayName}`} entry={e} mode={lb.mode} />
              ))}
            </ol>
            {/* Own position when outside the visible top N. */}
            {lb.data.self && !lb.data.entries.some((e) => e.isSelf) && (
              <>
                <div className={styles.selfDivider}>Your position</div>
                <ol className={styles.list}>
                  <Row entry={lb.data.self} mode={lb.mode} />
                </ol>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
