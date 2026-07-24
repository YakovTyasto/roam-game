import { Timer } from 'lucide-react';
import type { Difficulty } from '../../config/difficulty';
import { DIFFICULTY_LIST } from '../../config/difficulty';
import styles from './DifficultyCards.module.css';

interface DifficultyCardsProps {
  value: Difficulty;
  onChange: (difficulty: Difficulty) => void;
  /** Optional smaller layout for embedding in the multiplayer create form. */
  compact?: boolean;
  disabled?: boolean;
}

function formatTimer(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds}s`;
}

/**
 * Accessible difficulty picker shared by solo setup and multiplayer room
 * creation, so their choices stay in sync. Renders a radiogroup of cards.
 */
export function DifficultyCards({
  value,
  onChange,
  compact = false,
  disabled = false,
}: DifficultyCardsProps) {
  return (
    <div
      className={`${styles.grid} ${compact ? styles.compact : ''}`}
      role="radiogroup"
      aria-label="Difficulty"
    >
      {DIFFICULTY_LIST.map((preset) => {
        const selected = preset.id === value;
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`${styles.card} ${selected ? styles.selected : ''}`}
            onClick={() => onChange(preset.id)}
            disabled={disabled}
          >
            <span className={styles.name}>{preset.label}</span>
            <span className={styles.timer}>
              <Timer size={13} aria-hidden />
              {formatTimer(preset.roundSeconds)} / round
            </span>
            <span className={styles.desc}>{preset.description}</span>
            <span className={styles.audience}>{preset.audience}</span>
          </button>
        );
      })}
    </div>
  );
}
