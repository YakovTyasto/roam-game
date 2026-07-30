import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, CloudOff, Play, RotateCcw, Trophy } from 'lucide-react';
import type { Locale } from '../i18n/locale';
import { t } from '../i18n/t';
import type { Preferences } from '../types';
import { formatDistance } from '../utils/distance';
import { Button } from '../components/ui/Button';
import type { DailyLeaderboard, DailyStatus } from '../daily/daily';
import { formatCountdown, formatDuration } from '../daily/daily';
import type { DailyLoadState } from '../daily/useDaily';
import styles from './DailyScreen.module.css';

interface DailyScreenProps {
  locale: Locale;
  units: Preferences['units'];
  state: DailyLoadState;
  status: DailyStatus | null;
  secondsUntilNext: number | null;
  /** True while a start/resume request is in flight. */
  busy: boolean;
  error: string | null;
  onPlay: () => void;
  onPractice: () => void;
  onRefresh: () => void;
  onBack: () => void;
}

/**
 * The Daily Challenge detail screen: today's state, the action, today's
 * leaderboard, and yesterday's result.
 *
 * The leaderboard loads separately from the status and is allowed to fail on its
 * own — a broken leaderboard must not stop a player from taking the challenge, so
 * it renders its own error with its own retry instead of failing the screen.
 */
export function DailyScreen({
  locale,
  units,
  state,
  status,
  secondsUntilNext,
  busy,
  error,
  onPlay,
  onPractice,
  onRefresh,
  onBack,
}: DailyScreenProps) {
  const attempt = status?.attempt ?? null;
  const completed = attempt?.status === 'complete';

  const [board, setBoard] = useState<DailyLeaderboard | null>(null);
  const [boardState, setBoardState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [boardNonce, setBoardNonce] = useState(0);

  useEffect(() => {
    if (state !== 'ready') return;
    let cancelled = false;
    setBoardState('loading');
    void (async () => {
      try {
        const { fetchDailyLeaderboard } = await import('../daily/dailyApi');
        const next = await fetchDailyLeaderboard(undefined, 25);
        if (cancelled) return;
        if (!next) {
          setBoardState('error');
          return;
        }
        setBoard(next);
        setBoardState('ready');
      } catch {
        if (!cancelled) setBoardState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, boardNonce]);

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.topRow}>
          <span className={styles.eyebrow}>
            <CalendarDays size={15} aria-hidden />
            {status?.utcDay ?? ''}
          </span>
          <Button variant="subtle" iconOnly onClick={onBack} aria-label="Back to home">
            <ArrowLeft size={20} aria-hidden />
          </Button>
        </div>

        <h1 className={styles.title}>{t(locale, 'daily.title')}</h1>
        <p className={styles.lede}>{t(locale, 'daily.subtitle')}</p>

        {state === 'unavailable' && (
          <div className={styles.notice} role="status">
            <CloudOff size={18} aria-hidden />
            <span>{t(locale, 'daily.card.unavailable_hint')}</span>
            <Button variant="ghost" onClick={onRefresh}>
              <RotateCcw size={16} aria-hidden />
              {t(locale, 'daily.leaderboard.retry')}
            </Button>
          </div>
        )}

        {error && (
          <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
            <span>{error}</span>
          </div>
        )}

        {state === 'ready' && (
          <>
            {completed ? (
              <section className={styles.result} aria-label={t(locale, 'daily.result.title')}>
                <h2 className={styles.sectionTitle}>{t(locale, 'daily.result.title')}</h2>
                <dl className={styles.stats}>
                  <div className={styles.stat}>
                    <dt>{t(locale, 'daily.result.score')}</dt>
                    <dd>{attempt!.totalScore.toLocaleString()}</dd>
                  </div>
                  <div className={styles.stat}>
                    <dt>{t(locale, 'daily.result.distance')}</dt>
                    <dd>{formatDistance(attempt!.totalDistanceKm, units)}</dd>
                  </div>
                  <div className={styles.stat}>
                    <dt>{t(locale, 'daily.result.duration')}</dt>
                    <dd>{formatDuration(attempt!.durationMs) ?? '—'}</dd>
                  </div>
                  <div className={styles.stat}>
                    <dt>{t(locale, 'daily.result.rank')}</dt>
                    <dd>{attempt!.rank != null ? `#${attempt!.rank}` : '—'}</dd>
                  </div>
                </dl>
                <p className={styles.footNote}>{t(locale, 'daily.already_completed')}</p>
              </section>
            ) : null}

            <div className={styles.actions}>
              {completed ? (
                <>
                  <Button variant="ghost" size="lg" block onClick={onPractice} disabled={busy}>
                    <RotateCcw size={20} aria-hidden />
                    {t(locale, 'daily.practice')}
                  </Button>
                  <p className={styles.footNote}>{t(locale, 'daily.practice_hint')}</p>
                </>
              ) : (
                <Button variant="primary" size="lg" block onClick={onPlay} disabled={busy}>
                  <Play size={20} aria-hidden />
                  {attempt ? t(locale, 'daily.resume') : t(locale, 'daily.play')}
                </Button>
              )}
            </div>

            {secondsUntilNext !== null && (
              <p className={styles.countdown} aria-live="off">
                {t(locale, 'daily.card.next_in', { time: formatCountdown(secondsUntilNext) })}
              </p>
            )}

            <section className={styles.board} aria-label={t(locale, 'daily.leaderboard.title')}>
              <h2 className={styles.sectionTitle}>
                <Trophy size={16} aria-hidden />
                {t(locale, 'daily.leaderboard.title')}
              </h2>

              {boardState === 'loading' && <p className={styles.footNote}>…</p>}

              {boardState === 'error' && (
                <div className={styles.notice} role="status">
                  <span>{t(locale, 'daily.leaderboard.unavailable')}</span>
                  <Button variant="ghost" onClick={() => setBoardNonce((n) => n + 1)}>
                    <RotateCcw size={16} aria-hidden />
                    {t(locale, 'daily.leaderboard.retry')}
                  </Button>
                </div>
              )}

              {boardState === 'ready' && board && board.entries.length === 0 && (
                <p className={styles.footNote}>{t(locale, 'daily.leaderboard.empty')}</p>
              )}

              {boardState === 'ready' && board && board.entries.length > 0 && (
                <>
                  {/* A table, because it is one: it gives screen readers real
                      column headers instead of a soup of divs. */}
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th scope="col">{t(locale, 'daily.leaderboard.header_rank')}</th>
                          <th scope="col">{t(locale, 'daily.leaderboard.header_player')}</th>
                          <th scope="col">{t(locale, 'daily.leaderboard.header_score')}</th>
                          <th scope="col">{t(locale, 'daily.leaderboard.header_distance')}</th>
                          <th scope="col">{t(locale, 'daily.leaderboard.header_time')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {board.entries.map((e) => (
                          <tr
                            key={`${e.rank}-${e.displayName}`}
                            className={e.isSelf ? styles.selfRow : undefined}
                          >
                            <td>{e.rank}</td>
                            <td>
                              {e.displayName}
                              {/* "You" as text, not just a colour. */}
                              {e.isSelf && (
                                <span className={styles.youTag}>
                                  {t(locale, 'daily.leaderboard.you')}
                                </span>
                              )}
                            </td>
                            <td>{e.totalScore.toLocaleString()}</td>
                            <td>{formatDistance(e.totalDistanceKm, units)}</td>
                            <td>{formatDuration(e.durationMs) ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {board.self && !board.entries.some((e) => e.isSelf) && (
                    <p className={styles.footNote}>
                      {t(locale, 'daily.leaderboard.you')}: #{board.self.rank} ·{' '}
                      {board.self.totalScore.toLocaleString()}
                    </p>
                  )}

                  <p className={styles.footNote}>{t(locale, 'daily.leaderboard.tiebreak')}</p>
                </>
              )}
            </section>

            <section className={styles.previous}>
              <h2 className={styles.sectionTitle}>{t(locale, 'daily.previous.title')}</h2>
              {status?.previous ? (
                <p className={styles.footNote}>
                  {status.previous.utcDay} · {status.previous.totalScore.toLocaleString()} ·{' '}
                  {formatDistance(status.previous.totalDistanceKm, units)}
                </p>
              ) : (
                <p className={styles.footNote}>{t(locale, 'daily.previous.none')}</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
