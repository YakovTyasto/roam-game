import { useCallback, useState } from 'react';
import { Copy, Check, Share2, Play, LogOut, AlertTriangle, Crown } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { APP } from '../../config/app';
import { difficultyLabel, difficultyRoundSeconds } from '../../config/difficulty';
import { buildInviteUrl } from '../../multiplayer/inviteLink';
import type { RoomView } from '../../multiplayer/machine';
import type { MpRoom } from '../../multiplayer/types';
import { PlayerRow } from './PlayerRow';
import { ExitConfirmDialog } from '../../components/ui/ExitConfirmDialog';
import styles from './multiplayer.module.css';

interface LobbyProps {
  room: MpRoom;
  view: RoomView;
  onlineUserIds: string[];
  busy: boolean;
  notice: string | null;
  onStart: () => void;
  onLeave: () => void;
}

function timerLabel(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
}

export function Lobby({
  room,
  view,
  onlineUserIds,
  busy,
  notice,
  onStart,
  onLeave,
}: LobbyProps) {
  const [copied, setCopied] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const inviteUrl = buildInviteUrl(room.code);
  const online = new Set(onlineUserIds);

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard blocked — code is on screen. */
    }
  }, [room.code]);

  const share = useCallback(async () => {
    const shareData = {
      title: `${APP.name} — private match`,
      text: `Join my ${APP.name} game. Room code: ${room.code}`,
      url: inviteUrl,
    };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* nothing else we can do */
    }
  }, [inviteUrl, room.code]);

  const emptySlots = Math.max(0, room.maxPlayers - view.players.length);

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.topRow}>
          <span className={styles.eyebrow}>
            <span className={styles.dot} aria-hidden />
            Lobby
          </span>
          <Button variant="subtle" onClick={() => setExitOpen(true)} aria-label="Leave room">
            <LogOut size={18} aria-hidden />
            Leave
          </Button>
        </div>

        <h1 className={styles.title}>Invite your friends</h1>

        <div className={styles.settingsSummary} aria-label="Room settings">
          <span className={styles.settingChip}>{difficultyLabel(room.difficulty)}</span>
          <span className={styles.settingChip}>
            {timerLabel(difficultyRoundSeconds(room.difficulty))} / round
          </span>
          <span className={styles.settingChip}>
            {view.players.length} / {room.maxPlayers} players
          </span>
        </div>

        <div className={styles.codeBlock}>
          <span className={styles.label} style={{ textAlign: 'center' }}>
            Room code
          </span>
          <span className={styles.codeValue} aria-label={`Room code ${room.code}`}>
            {room.code}
          </span>
          <div className={styles.codeButtons}>
            <Button variant="ghost" onClick={copyCode} aria-label="Copy room code">
              {copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
              {copied ? 'Copied' : 'Copy code'}
            </Button>
            <Button variant="ghost" onClick={share} aria-label="Share invite link">
              <Share2 size={18} aria-hidden />
              Share invite
            </Button>
          </div>
        </div>

        <div className={styles.players}>
          {view.players.map((p) => (
            <PlayerRow
              key={p.id}
              name={p.displayName}
              score={null}
              isMe={p.userId === view.me?.userId}
              isHost={room.hostId === p.userId}
              connection={
                p.connectionStatus === 'left'
                  ? 'left'
                  : p.userId === view.me?.userId || online.has(p.userId)
                    ? 'online'
                    : 'offline'
              }
            />
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <div className={styles.playerRow} key={`empty-${i}`}>
              <span className={styles.avatar} aria-hidden>
                ?
              </span>
              <div className={styles.playerMain}>
                <div className={styles.playerName} style={{ color: 'var(--text-faint)' }}>
                  Open slot
                </div>
                <div className={styles.playerMeta}>Waiting for a player to join</div>
              </div>
              <span className={styles.spinnerDot} aria-hidden />
            </div>
          ))}
        </div>

        {notice && (
          <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
            <AlertTriangle size={18} className={styles.noticeIcon} aria-hidden />
            <span>{notice}</span>
          </div>
        )}

        {view.isHost ? (
          <div className={styles.actions}>
            <Button
              variant="primary"
              size="lg"
              block
              onClick={onStart}
              disabled={busy || !view.canStart}
            >
              <Play size={20} aria-hidden />
              {busy ? 'Setting up…' : 'Start game'}
            </Button>
            {!view.canStart && (
              <p className={styles.footNote}>
                The Start button unlocks once a second player joins.
              </p>
            )}
          </div>
        ) : (
          <div className={styles.waiting} aria-live="polite">
            <Crown size={16} aria-hidden />
            <span>Waiting for the host to start the match…</span>
          </div>
        )}
      </div>

      <ExitConfirmDialog
        open={exitOpen}
        variant="multiplayer"
        onContinue={() => setExitOpen(false)}
        onAbandon={() => {
          setExitOpen(false);
          onLeave();
        }}
      />
    </div>
  );
}
