import { useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import type { Difficulty } from '../config/difficulty';
import { Button } from '../components/ui/Button';
import { DifficultyCards } from '../components/difficulty/DifficultyCards';
import { APP } from '../config/app';
import styles from './multiplayer/multiplayer.module.css';

interface SoloSetupScreenProps {
  initialDifficulty: Difficulty;
  busy: boolean;
  onStart: (difficulty: Difficulty) => void;
  onBack: () => void;
}

export function SoloSetupScreen({
  initialDifficulty,
  busy,
  onStart,
  onBack,
}: SoloSetupScreenProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.topRow}>
          <span className={styles.eyebrow}>
            <span className={styles.dot} aria-hidden />
            Solo game
          </span>
          <Button variant="subtle" iconOnly onClick={onBack} aria-label="Back to home">
            <ArrowLeft size={20} aria-hidden />
          </Button>
        </div>

        <h1 className={styles.title}>Choose your difficulty</h1>
        <p className={styles.lede}>
          {APP.roundsPerGame} rounds. Pick how tough the locations and how tight
          the clock should be.
        </p>

        <DifficultyCards value={difficulty} onChange={setDifficulty} disabled={busy} />

        <div className={styles.actions}>
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => onStart(difficulty)}
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
