import { Play, Settings, Trophy, AlertTriangle, Users } from 'lucide-react';
import { APP, MAX_GAME_SCORE } from '../config/app';
import { Button } from '../components/ui/Button';
import styles from './WelcomeScreen.module.css';

interface WelcomeScreenProps {
  bestScore: number;
  hasKey: boolean;
  onStart: () => void;
  onStartMultiplayer: () => void;
  onOpenSettings: () => void;
}

const STEPS = [
  'Explore the panorama',
  'Drop a pin on the map',
  'Score by how close you are',
];

export function WelcomeScreen({
  bestScore,
  hasKey,
  onStart,
  onStartMultiplayer,
  onOpenSettings,
}: WelcomeScreenProps) {
  return (
    <div className={styles.screen}>
      <div className={styles.rings} aria-hidden />

      <div className={styles.topbar}>
        <Button
          variant="subtle"
          iconOnly
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <Settings size={20} aria-hidden />
        </Button>
      </div>

      <div className={styles.content}>
        <span className={styles.eyebrow}>
          <span className={styles.dot} aria-hidden />
          {APP.roundsPerGame} rounds · {MAX_GAME_SCORE.toLocaleString()} points
        </span>

        <h1 className={styles.title}>
          <span className={styles.titleAccent}>{APP.name}</span>
          <br />
          {APP.tagline}
        </h1>

        <p className={styles.lede}>{APP.description}</p>

        {!hasKey && (
          <div className={styles.notice} role="status">
            <AlertTriangle size={18} className={styles.noticeIcon} aria-hidden />
            <span>
              Street View needs a Google Maps API key. You can still look around
              the app — tap “Start game” to see setup instructions.
            </span>
          </div>
        )}

        <div className={styles.actions}>
          <Button variant="primary" size="lg" onClick={onStart}>
            <Play size={20} aria-hidden />
            Solo game
          </Button>

          <Button variant="ghost" size="lg" onClick={onStartMultiplayer}>
            <Users size={20} aria-hidden />
            Private multiplayer
          </Button>

          <span className={styles.best}>
            <Trophy size={18} className={styles.bestIcon} aria-hidden />
            Best
            <span className={styles.bestValue}>
              {bestScore > 0
                ? `${bestScore.toLocaleString()} / ${MAX_GAME_SCORE.toLocaleString()}`
                : '—'}
            </span>
          </span>
        </div>

        <div className={styles.steps}>
          {STEPS.map((label, i) => (
            <span className={styles.step} key={label}>
              <span className={styles.stepNum}>{i + 1}</span>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
