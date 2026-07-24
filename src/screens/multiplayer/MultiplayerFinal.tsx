import { RotateCcw, Home, Trophy, Minus, AlertTriangle, LogOut } from 'lucide-react';
import type { Preferences } from '../../types';
import { formatDistance } from '../../utils/distance';
import { Button } from '../../components/ui/Button';
import type { RoomView } from '../../multiplayer/machine';
import { summarizeMatch } from '../../multiplayer/summary';
import { ordinal } from '../../multiplayer/ranking';
import type { RoomSnapshot } from '../../multiplayer/types';
import styles from './multiplayer.module.css';

interface MultiplayerFinalProps {
  view: RoomView;
  snapshot: RoomSnapshot;
  units: Preferences['units'];
  busy: boolean;
  notice: string | null;
  onRematch: () => void;
  onHome: () => void;
}

export function MultiplayerFinal({
  view,
  snapshot,
  units,
  busy,
  notice,
  onRematch,
  onHome,
}: MultiplayerFinalProps) {
  const meUserId = view.me?.userId ?? '';
  const summary = summarizeMatch(snapshot, meUserId);

  const iWon = summary.me?.isWinner ?? false;
  const badge = summary.isTie
    ? { text: iWon ? 'You tied for 1st' : 'It’s a tie', cls: styles.outcomeDraw, icon: <Minus size={16} aria-hidden /> }
    : iWon
      ? { text: 'You win', cls: styles.outcomeWin, icon: <Trophy size={16} aria-hidden /> }
      : {
          text: `You finished ${ordinal(summary.me?.rank ?? summary.standings.length)}`,
          cls: styles.outcomeLoss,
          icon: <AlertTriangle size={16} aria-hidden />,
        };

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.topRow}>
          <span className={styles.eyebrow}>
            <span className={styles.dot} aria-hidden />
            Final results
          </span>
        </div>

        <div style={{ textAlign: 'center' }}>
          <span className={`${styles.outcomeBadge} ${badge.cls}`}>
            {badge.icon}
            {badge.text}
          </span>
        </div>

        {/* ── Final standings (1..N) ─────────────────────────── */}
        <ol className={styles.standings} aria-label="Final standings">
          {summary.standings.map((s) => (
            <li
              key={s.userId}
              className={`${styles.standingRow} ${s.isMe ? styles.standingMe : ''}`}
            >
              <span className={styles.standingRank}>
                {s.rank}
                {s.isWinner && (
                  <Trophy size={13} aria-hidden style={{ marginLeft: 4, color: 'var(--accent)' }} />
                )}
              </span>
              <span className={styles.standingName}>
                {s.displayName}
                {s.isMe && ' (you)'}
                {s.left && (
                  <span className={styles.leftTag}>
                    <LogOut size={11} aria-hidden style={{ verticalAlign: '-1px' }} /> left
                  </span>
                )}
              </span>
              <span className={styles.standingScore}>{s.totalScore.toLocaleString()}</span>
            </li>
          ))}
        </ol>

        {/* ── Round-by-round breakdown ───────────────────────── */}
        <ul className={styles.breakdown} aria-label="Round-by-round breakdown">
          {summary.rounds.map((r) => {
            const best = r.results[0];
            const mine = r.results.find((p) => p.isMe);
            return (
              <li className={styles.roundBreak} key={r.roundNumber}>
                <div className={styles.roundBreakHead}>
                  <span className={styles.breakdownRoundNum}>Round {r.roundNumber}</span>
                  <span className={styles.roundBreakLoc}>
                    {r.label}
                    {r.country ? ` · ${r.country}` : ''}
                  </span>
                </div>
                <div className={styles.roundBreakBody}>
                  <span>
                    Top: <strong>{best.displayName}</strong> ·{' '}
                    {best.score.toLocaleString()}
                  </span>
                  {mine && (
                    <span className={mine.rank === 1 ? styles.cellWin : ''}>
                      You: {mine.score.toLocaleString()}{' '}
                      {mine.distanceKm !== null
                        ? `(${formatDistance(mine.distanceKm, units)})`
                        : '(no guess)'}{' '}
                      · {ordinal(mine.rank)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {notice && (
          <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
            <AlertTriangle size={18} className={styles.noticeIcon} aria-hidden />
            <span>{notice}</span>
          </div>
        )}

        <div className={styles.actions}>
          <Button variant="primary" size="lg" block onClick={onRematch} disabled={busy}>
            <RotateCcw size={18} aria-hidden />
            {busy ? 'Setting up…' : 'Rematch'}
          </Button>
          <Button variant="ghost" size="lg" block onClick={onHome}>
            <Home size={18} aria-hidden />
            Return home
          </Button>
        </div>
      </div>
    </div>
  );
}
