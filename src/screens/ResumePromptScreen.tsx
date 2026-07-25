import { History } from 'lucide-react';
import type { Difficulty } from '../config/difficulty';
import { difficultyLabel } from '../config/difficulty';
import { StatusScreen } from '../components/ui/StatusScreen';
import { Button } from '../components/ui/Button';

interface ResumePromptScreenProps {
  difficulty: Difficulty;
  /** 0-based round the player would continue at. */
  roundIndex: number;
  /** null = Endless (no fixed total). */
  roundCount: number | null;
  roundsPlayed: number;
  busy: boolean;
  onResume: () => void;
  onAbandon: () => void;
}

/** Shown on startup when an unfinished solo run (server-tracked or local-only) is found. */
export function ResumePromptScreen({
  difficulty,
  roundIndex,
  roundCount,
  roundsPlayed,
  busy,
  onResume,
  onAbandon,
}: ResumePromptScreenProps) {
  const roundLabel =
    roundCount === null ? `Round ${roundIndex + 1} (Endless)` : `Round ${roundIndex + 1} of ${roundCount}`;
  return (
    <StatusScreen
      icon={<History size={28} aria-hidden />}
      title="Resume your game?"
      description={`${difficultyLabel(difficulty)} · ${roundLabel} · ${roundsPlayed} round${
        roundsPlayed === 1 ? '' : 's'
      } already played.`}
      actions={
        <>
          <Button variant="primary" size="lg" block onClick={onResume} disabled={busy}>
            {busy ? 'Resuming…' : 'Resume game'}
          </Button>
          <Button variant="ghost" size="lg" block onClick={onAbandon} disabled={busy}>
            Abandon
          </Button>
        </>
      }
      note="You have an unfinished game from earlier. Abandoning discards it — it will not be scored."
    />
  );
}
