import { CalendarDays, CheckCircle2, CloudOff, Timer, Trophy } from 'lucide-react';
import type { Locale } from '../../i18n/locale';
import { t } from '../../i18n/t';
import type { DailyStatus } from '../../daily/daily';
import { dailyCardState, formatCountdown } from '../../daily/daily';
import type { DailyLoadState } from '../../daily/useDaily';
import styles from './DailyCard.module.css';

interface DailyCardProps {
  locale: Locale;
  state: DailyLoadState;
  status: DailyStatus | null;
  secondsUntilNext: number | null;
  onOpen: () => void;
}

/**
 * The Daily Challenge entry point on the home screen.
 *
 * It is a single `<button>` on purpose. A card with a nested action button is the
 * shape that produced the original mobile bug (a parent handler and a child
 * control fighting over the same tap), and it also gives screen readers two
 * competing targets for one idea. One button, one label, one tap.
 *
 * The unavailable state is rendered as *disabled but visible* rather than hidden:
 * a card that silently disappears when the backend is down looks like a bug,
 * while a card that says why does not. It never blocks the other modes.
 */
export function DailyCard({
  locale,
  state,
  status,
  secondsUntilNext,
  onOpen,
}: DailyCardProps) {
  const cardState = state === 'ready' ? dailyCardState(status) : 'unavailable';
  const unavailable = state === 'unavailable';
  const loading = state === 'loading' || state === 'idle';

  const headline = (() => {
    if (loading) return t(locale, 'daily.title');
    switch (cardState) {
      case 'completed':
        return t(locale, 'daily.card.completed', {
          score: (status?.attempt?.totalScore ?? 0).toLocaleString(),
        });
      case 'in-progress':
        return t(locale, 'daily.card.in_progress', {
          played: status?.attempt?.roundsPlayed ?? 0,
          total: status?.roundCount ?? 5,
        });
      case 'not-started':
        return t(locale, 'daily.card.not_started');
      default:
        return t(locale, 'daily.card.unavailable');
    }
  })();

  const Icon = unavailable
    ? CloudOff
    : cardState === 'completed'
      ? CheckCircle2
      : cardState === 'in-progress'
        ? Timer
        : CalendarDays;

  return (
    <button
      type="button"
      className={styles.card}
      onClick={onOpen}
      disabled={unavailable}
      // The state is in the label, not only in the icon or colour, so it reads
      // correctly with a screen reader and without colour vision.
      aria-label={`${t(locale, 'daily.title')} — ${headline}`}
    >
      <span className={styles.icon} aria-hidden>
        <Icon size={22} />
      </span>

      <span className={styles.body}>
        <span className={styles.title}>{t(locale, 'daily.title')}</span>
        <span className={styles.headline}>{headline}</span>

        <span className={styles.meta}>
          {unavailable ? (
            t(locale, 'daily.card.unavailable_hint')
          ) : loading ? (
            '…'
          ) : (
            <>
              {cardState === 'completed' && status?.attempt?.rank != null && (
                <span className={styles.chip}>
                  <Trophy size={13} aria-hidden />
                  {t(locale, 'daily.card.rank', { rank: status.attempt.rank })}
                </span>
              )}
              {secondsUntilNext !== null && (
                <span className={styles.chip}>
                  {t(locale, 'daily.card.next_in', { time: formatCountdown(secondsUntilNext) })}
                </span>
              )}
            </>
          )}
        </span>
      </span>
    </button>
  );
}
