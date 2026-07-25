import { useMemo, useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import type { Difficulty } from '../config/difficulty';
import { difficultyRoundSeconds } from '../config/difficulty';
import type { GameConfig } from '../config/gameConfig';
import {
  MAX_CUSTOM_ROUNDS,
  MAX_TIMER_SECONDS,
  MIN_CUSTOM_ROUNDS,
  MIN_TIMER_SECONDS,
  QUICK_ROUND_COUNTS,
  clampRoundCount,
  clampTimerSeconds,
  quickConfig,
  summarizeGameConfig,
} from '../config/gameConfig';
import { Button } from '../components/ui/Button';
import { DifficultyCards } from '../components/difficulty/DifficultyCards';
import styles from './SoloSetupScreen.module.css';
import multiplayerStyles from './multiplayer/multiplayer.module.css';

interface SoloSetupScreenProps {
  initialDifficulty: Difficulty;
  busy: boolean;
  onStart: (config: GameConfig) => void;
  onBack: () => void;
}

type QuickSelection = number | 'endless' | 'custom';

export function SoloSetupScreen({
  initialDifficulty,
  busy,
  onStart,
  onBack,
}: SoloSetupScreenProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
  const [quick, setQuick] = useState<QuickSelection>(5);
  const [customRounds, setCustomRounds] = useState(5);
  const [customEndless, setCustomEndless] = useState(false);
  const [customTimer, setCustomTimer] = useState(() => difficultyRoundSeconds(initialDifficulty));
  const [customNoTimer, setCustomNoTimer] = useState(false);

  const config: GameConfig = useMemo(() => {
    if (quick === 'custom') {
      return {
        difficulty,
        roundCount: customEndless ? null : clampRoundCount(customRounds),
        timerSeconds: customNoTimer ? null : clampTimerSeconds(customTimer),
        movementRule: 'default',
      };
    }
    return quickConfig(difficulty, quick === 'endless' ? null : quick);
  }, [quick, difficulty, customEndless, customRounds, customNoTimer, customTimer]);

  return (
    <div className={multiplayerStyles.screen}>
      <div className={multiplayerStyles.card}>
        <div className={multiplayerStyles.topRow}>
          <span className={multiplayerStyles.eyebrow}>
            <span className={multiplayerStyles.dot} aria-hidden />
            Solo game
          </span>
          <Button variant="subtle" iconOnly onClick={onBack} aria-label="Back to home">
            <ArrowLeft size={20} aria-hidden />
          </Button>
        </div>

        <h1 className={multiplayerStyles.title}>Set up your game</h1>
        <p className={multiplayerStyles.lede}>
          Pick a difficulty, how many rounds, and a timer — or use the quick presets below.
        </p>

        <DifficultyCards value={difficulty} onChange={setDifficulty} disabled={busy} />

        <div style={{ marginTop: 18 }}>
          <span className={multiplayerStyles.label}>Rounds</span>
          <div className={styles.chipRow} role="radiogroup" aria-label="Rounds">
            {QUICK_ROUND_COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                role="radio"
                aria-checked={quick === count}
                className={`${styles.chip} ${quick === count ? styles.chipSelected : ''}`}
                onClick={() => setQuick(count)}
                disabled={busy}
              >
                {count} rounds
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={quick === 'endless'}
              className={`${styles.chip} ${quick === 'endless' ? styles.chipSelected : ''}`}
              onClick={() => setQuick('endless')}
              disabled={busy}
            >
              Endless
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={quick === 'custom'}
              className={`${styles.chip} ${quick === 'custom' ? styles.chipSelected : ''}`}
              onClick={() => setQuick('custom')}
              disabled={busy}
            >
              Custom
            </button>
          </div>
        </div>

        {quick === 'custom' && (
          <div className={styles.customPanel}>
            <div className={styles.customRow}>
              <label className={styles.checkboxLabel} htmlFor="custom-rounds">
                Round count
              </label>
              <div className={styles.customField}>
                <input
                  id="custom-rounds"
                  type="number"
                  className={styles.numberInput}
                  min={MIN_CUSTOM_ROUNDS}
                  max={MAX_CUSTOM_ROUNDS}
                  value={customRounds}
                  disabled={busy || customEndless}
                  onChange={(e) => setCustomRounds(Number(e.target.value))}
                  aria-label="Custom round count"
                />
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={customEndless}
                    disabled={busy}
                    onChange={(e) => setCustomEndless(e.target.checked)}
                  />
                  Endless
                </label>
              </div>
            </div>

            <div className={styles.customRow}>
              <label className={styles.checkboxLabel} htmlFor="custom-timer">
                Timer (seconds)
              </label>
              <div className={styles.customField}>
                <input
                  id="custom-timer"
                  type="number"
                  className={styles.numberInput}
                  min={MIN_TIMER_SECONDS}
                  max={MAX_TIMER_SECONDS}
                  value={customTimer}
                  disabled={busy || customNoTimer}
                  onChange={(e) => setCustomTimer(Number(e.target.value))}
                  aria-label="Custom timer in seconds"
                />
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={customNoTimer}
                    disabled={busy}
                    onChange={(e) => setCustomNoTimer(e.target.checked)}
                  />
                  No timer
                </label>
              </div>
            </div>
          </div>
        )}

        <div className={styles.summary} aria-live="polite">
          {summarizeGameConfig(config)}
        </div>

        <div className={multiplayerStyles.actions} style={{ marginTop: 18 }}>
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => onStart(config)}
            disabled={busy}
          >
            <Play size={20} aria-hidden />
            {busy ? 'Loading…' : 'Start game'}
          </Button>
        </div>
      </div>
    </div>
  );
}
