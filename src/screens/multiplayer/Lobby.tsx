import { useCallback, useState } from 'react';
import { Copy, Check, Share2, Play, LogOut, AlertTriangle, Crown } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { APP } from '../../config/app';
import { buildInviteUrl } from '../../multiplayer/inviteLink';
import type { RoomView } from '../../multiplayer/machine';
import type { MpRoom } from '../../multiplayer/types';
import { PlayerRow } from './PlayerRow';
import styles from './multiplayer.module.css';

interface LobbyProps {
  room: MpRoom;
  view: RoomView;
  opponentOnline: boolean;
  busy: boolean;
  notice: string | null;
  onStart: () => void;
  onLeave: () => void;
}

export function Lobby({
  room,
  view,
  opponentOnline,
  busy,
  notice,
  onStart,
  onLeave,
}: LobbyProps) {
  const [copied, setCopied] = useState(false);
  const inviteUrl = buildInviteUrl(room.code);

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (e.g. insecure context) — no-op; code is on screen.
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
        // User cancelled or share failed — fall through to clipboard.
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

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.topRow}>
          <span className={styles.eyebrow}>
            <span className={styles.dot} aria-hidden />
            Lobby
          </span>
          <Button variant="subtle" onClick={onLeave} aria-label="Leave room">
            <LogOut size={18} aria-hidden />
            Leave
          </Button>
        </div>

        <h1 className={styles.title}>Invite your opponent</h1>
        <p className={styles.lede}>
          Share the code or link. The match starts once both players are here.
        </p>

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
          {view.me && (
            <PlayerRow
              name={view.me.displayName}
              score={null}
              isMe
              isHost={room.hostId === view.me.userId}
              connection="online"
            />
          )}
          {view.opponent ? (
            <PlayerRow
              name={view.opponent.displayName}
              score={null}
              isHost={room.hostId === view.opponent.userId}
              connection={opponentOnline ? 'online' : 'offline'}
            />
          ) : (
            <div className={styles.playerRow}>
              <span className={styles.avatar} aria-hidden>
                ?
              </span>
              <div className={styles.playerMain}>
                <div className={styles.playerName} style={{ color: 'var(--text-faint)' }}>
                  Waiting for opponent…
                </div>
                <div className={styles.playerMeta}>They&apos;ll appear here on join</div>
              </div>
              <span className={styles.spinnerDot} aria-hidden />
            </div>
          )}
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
              disabled={busy || !view.bothPlayersPresent}
            >
              <Play size={20} aria-hidden />
              {busy ? 'Setting up…' : 'Start game'}
            </Button>
            {!view.bothPlayersPresent && (
              <p className={styles.footNote}>
                The Start button unlocks when your opponent joins.
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
    </div>
  );
}
