import { Crown } from 'lucide-react';
import styles from './multiplayer.module.css';

type ConnectionKind = 'online' | 'offline' | 'waiting' | 'left';

interface PlayerRowProps {
  name: string;
  score: number | null;
  isMe?: boolean;
  isHost?: boolean;
  connection: ConnectionKind;
  /** Optional gameplay status, e.g. "Exploring" / "Guess submitted". */
  statusLabel?: string;
}

const CONNECTION_TEXT: Record<ConnectionKind, string> = {
  online: 'Online',
  offline: 'Offline',
  waiting: 'Connecting',
  left: 'Left',
};

const CONNECTION_DOT: Record<ConnectionKind, string> = {
  online: styles.chipDotOnline,
  offline: styles.chipDotOffline,
  waiting: styles.chipDotWaiting,
  left: styles.chipDotOffline,
};

export function PlayerRow({
  name,
  score,
  isMe = false,
  isHost = false,
  connection,
  statusLabel,
}: PlayerRowProps) {
  const initial = name.trim().charAt(0) || '?';
  return (
    <div className={`${styles.playerRow} ${isMe ? styles.playerRowMe : ''}`}>
      <span className={`${styles.avatar} ${isMe ? '' : styles.avatarOpp}`} aria-hidden>
        {initial}
      </span>
      <div className={styles.playerMain}>
        <div className={styles.playerName}>
          {name}
          {isMe && ' (you)'}
          {isHost && (
            <span className={styles.hostTag} style={{ marginLeft: 8 }}>
              <Crown size={11} aria-hidden style={{ verticalAlign: '-1px' }} /> Host
            </span>
          )}
        </div>
        <div className={styles.playerMeta}>
          <span className={styles.statusChip}>
            <span className={`${styles.chipDot} ${CONNECTION_DOT[connection]}`} aria-hidden />
            {CONNECTION_TEXT[connection]}
          </span>
          {statusLabel && <span>· {statusLabel}</span>}
        </div>
      </div>
      {score !== null && (
        <span className={styles.playerScore} aria-label={`Score ${score}`}>
          {score.toLocaleString()}
        </span>
      )}
    </div>
  );
}
