import { DoorOpen, Flag, LogOut, Save } from 'lucide-react';
import { DEFAULT_LOCALE, type Locale } from '../../i18n/locale';
import { t } from '../../i18n/t';
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
  /**
   * Defaults to English — the multiplayer call sites don't yet thread the
   * player's locale preference through (see docs on remaining i18n
   * coverage); the solo call site (GameScreen) does.
   */
  locale?: Locale;
}

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
  locale = DEFAULT_LOCALE,
}: ExitConfirmDialogProps) {
  return (
    <Modal open={open} title={t(locale, `exit.${variant}.title`)} onClose={onContinue}>
      <p className={styles.body}>{t(locale, `exit.${variant}.body`)}</p>
      <div className={styles.actions}>
        <Button variant="primary" block onClick={onContinue} disabled={busy}>
          {t(locale, 'common.continue')}
        </Button>
        {variant === 'solo' && onSaveAndExit && (
          <Button variant="subtle" block onClick={onSaveAndExit} disabled={busy}>
            <Save size={18} aria-hidden />
            {t(locale, 'exit.solo.save_and_exit')}
          </Button>
        )}
        {variant === 'endless' && onFinishAndSummary && (
          <Button variant="subtle" block onClick={onFinishAndSummary} disabled={busy}>
            <Flag size={18} aria-hidden />
            {t(locale, 'exit.endless.finish')}
          </Button>
        )}
        <Button variant="ghost" block onClick={onAbandon} disabled={busy}>
          {variant === 'multiplayer' ? (
            <>
              <LogOut size={18} aria-hidden />
              {t(locale, 'exit.multiplayer.leave')}
            </>
          ) : variant === 'endless' ? (
            <>
              <DoorOpen size={18} aria-hidden />
              {t(locale, 'exit.endless.abandon')}
            </>
          ) : (
            <>
              <DoorOpen size={18} aria-hidden />
              {t(locale, 'exit.solo.abandon')}
            </>
          )}
        </Button>
      </div>
    </Modal>
  );
}
