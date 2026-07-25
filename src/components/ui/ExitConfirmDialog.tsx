import { DoorOpen, Flag, LogOut, Save } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import styles from './ExitConfirmDialog.module.css';

export type ExitDialogVariant = 'solo' | 'endless' | 'multiplayer';

interface ExitConfirmDialogProps {
  open: boolean;
  variant: ExitDialogVariant;
  /** "Continue playing" — closes the dialog without leaving. */
  onContinue: () => void;
  /** Solo only: persist resumable state, then leave. */
  onSaveAndExit?: () => void;
  /** Endless only: end the session now and show the summary. */
  onFinishAndSummary?: () => void;
  /** Solo/Endless: abandon without saving. Multiplayer: leave the room. */
  onAbandon: () => void;
  busy?: boolean;
}

const COPY: Record<ExitDialogVariant, { title: string; body: string }> = {
  solo: {
    title: 'Exit this game?',
    body: 'Your progress is only saved if you choose "Save and exit". Abandoning discards this run — it will not be recorded.',
  },
  endless: {
    title: 'Exit Endless session?',
    body: 'You can finish now to see your session summary, or abandon without saving.',
  },
  multiplayer: {
    title: 'Leave this room?',
    body: 'You will leave the room. Other players are notified and the match continues without you.',
  },
};

/**
 * Shared, accessible exit-confirmation dialog for every active gameplay
 * screen. Never a single-tap exit — the trigger button only opens this;
 * leaving always requires a second, explicit choice here.
 */
export function ExitConfirmDialog({
  open,
  variant,
  onContinue,
  onSaveAndExit,
  onFinishAndSummary,
  onAbandon,
  busy = false,
}: ExitConfirmDialogProps) {
  const copy = COPY[variant];
  return (
    <Modal open={open} title={copy.title} onClose={onContinue}>
      <p className={styles.body}>{copy.body}</p>
      <div className={styles.actions}>
        <Button variant="primary" block onClick={onContinue} disabled={busy}>
          Continue playing
        </Button>
        {variant === 'solo' && onSaveAndExit && (
          <Button variant="subtle" block onClick={onSaveAndExit} disabled={busy}>
            <Save size={18} aria-hidden />
            Save and exit
          </Button>
        )}
        {variant === 'endless' && onFinishAndSummary && (
          <Button variant="subtle" block onClick={onFinishAndSummary} disabled={busy}>
            <Flag size={18} aria-hidden />
            Finish and view summary
          </Button>
        )}
        <Button variant="ghost" block onClick={onAbandon} disabled={busy}>
          {variant === 'multiplayer' ? (
            <>
              <LogOut size={18} aria-hidden />
              Leave room
            </>
          ) : (
            <>
              <DoorOpen size={18} aria-hidden />
              Abandon {variant === 'endless' ? 'session' : 'game'}
            </>
          )}
        </Button>
      </div>
    </Modal>
  );
}
