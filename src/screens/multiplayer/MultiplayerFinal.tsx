import { RotateCcw, Home, Trophy, Minus, AlertTriangle } from 'lucide-react';
import type { Preferences } from '../../types';
import { formatDistance } from '../../utils/distance';
import { Button } from '../../components/ui/Button';
import type { RoomView } from '../../multiplayer/machine';
import { summarizeMatch } from '../../multiplayer/summary';
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
  const oppUserId = view.opponent?.userId ?? null;
  const summary = summarizeMatch(snapshot, meUserId, oppUserId);

  const myName = view.me?.displayName ?? 'You';
  const oppName = view.opponent?.displayName ?? 'Opponent';

  const badge =
    summary.result === 'win'
      ? { text: 'You win', cls: styles.outcomeWin, icon: <Trophy size={16} aria-hidden /> }
      : summary.result === 'loss'
        ? { text: 'You lost', cls: styles.outcomeLoss, icon: <AlertTriangle size={16} aria-hidden /> }
        : { text: 'It’s a draw', cls: styles.outcomeDraw, icon: <Minus size={16} aria-hidden /> };

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

        <div className={styles.finalScores}>
          <div className={styles.finalScoreCol}>
            <span className={styles.finalScoreName}>{myName} (you)</span>
            <span className={styles.finalScoreValue} style={{ color: 'var(--accent)' }}>
              {summary.myTotal.toLocaleString()}
            </span>
          </div>
          <span className={styles.finalVs}>vs</span>
          <div className={styles.finalScoreCol}>
            <span className={styles.finalScoreName}>{oppName}</span>
            <span className={styles.finalScoreValue}>{summary.oppTotal.toLocaleString()}</span>
          </div>
        </div>

        <ul className={styles.breakdown} aria-label="Round-by-round breakdown">
          <li className={styles.breakdownHead}>
            <span>Round</span>
            <span>You</span>
            <span>{oppName}</span>
          </li>
          {summary.rounds.map((r) => (
            <li className={styles.breakdownRow} key={r.roundNumber}>
              <span className={styles.breakdownRoundNum}>
                {r.roundNumber}
                {r.result === 'win' && (
                  <Trophy
                    size={12}
                    aria-label="You won this round"
                    style={{ marginLeft: 4, color: 'var(--accent)', verticalAlign: '-1px' }}
                  />
                )}
              </span>
              <span className={`${styles.roundScoreCell} ${r.result === 'win' ? styles.cellWin : ''}`}>
                {r.myScore.toLocaleString()}
                <span className={styles.roundScoreDist}>
                  {r.myDistanceKm !== null ? formatDistance(r.myDistanceKm, units) : 'No guess'}
                </span>
              </span>
              <span className={`${styles.roundScoreCell} ${r.result === 'loss' ? styles.cellWin : ''}`}>
                {r.oppScore.toLocaleString()}
                <span className={styles.roundScoreDist}>
                  {r.oppDistanceKm !== null ? formatDistance(r.oppDistanceKm, units) : 'No guess'}
                </span>
              </span>
            </li>
          ))}
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
